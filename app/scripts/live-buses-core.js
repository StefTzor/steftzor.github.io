/**
 * The parts of the live-bus layer on /transit/ that are arithmetic rather than DOM: what to ask
 * for, when to ask, how a bus moves between two answers, and what the line under the map says.
 *
 * No imports and no globals beyond what is passed in, so scripts/live-buses.test.js can run it in
 * a vm exactly as written. live-buses.js is the half that touches the page and the map.
 */

export const POLL_MS = 15000;
export const GLIDE_MS = 1000;
export const DEBOUNCE_MS = 300;
// The API refuses a box larger than this (src/livebuses.js); a zoomed-out map is cut down to it
// around its centre rather than sent and refused.
export const MAX_SPAN = { lon: 0.6, lat: 0.3 };
// "Your lines": a box this far either side of the stop, roughly 11 km square at Uppsala's
// latitude. Central Uppsala and the approach roads, not the county.
export const NEAR = { lon: 0.1, lat: 0.05 };
const LINE = /^[0-9A-Za-zÅÄÖåäö]{1,6}$/;
const MAX_LINES = 12;

/** [west, south, east, north] no larger than the API accepts, centred where the map is. */
export function clampBox([w, s, e, n]) {
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  // A thousandth of a degree inside the limit, so rounding to five decimals and the float
  // subtraction on the server cannot tip a full-size box over it.
  const hx = Math.min(e - w, MAX_SPAN.lon - 0.001) / 2;
  const hy = Math.min(n - s, MAX_SPAN.lat - 0.001) / 2;
  return [cx - hx, cy - hy, cx + hx, cy + hy];
}

/**
 * The query string for one request, or null when there is nothing to ask.
 *
 * "lines" mode asks about the board's lines around the stop; with no lines on the board (a quiet
 * night) or no stop coordinate, there is nothing to ask and nothing is spent. "all" mode asks
 * about whatever the map shows.
 *
 * @param {{ mode: 'lines'|'all', lines: string[], stop: number[]|null, bounds: number[]|null }} o
 */
export function busesQuery({ mode, lines, stop, bounds }) {
  let box;
  let wanted = null;
  if (mode === "all") {
    if (!bounds) return null;
    box = clampBox(bounds);
  } else {
    if (!stop) return null;
    wanted = [...new Set(lines)].filter((l) => typeof l === "string" && LINE.test(l)).slice(0, MAX_LINES);
    if (!wanted.length) return null;
    box = [stop[0] - NEAR.lon, stop[1] - NEAR.lat, stop[0] + NEAR.lon, stop[1] + NEAR.lat];
  }
  const q = "bbox=" + box.map((x) => x.toFixed(5)).join(",");
  return wanted ? q + "&lines=" + encodeURIComponent(wanted.join(",")) : q;
}

/**
 * One frame of the glide from the buses on screen to the buses in the new answer.
 *
 * `from` is what is drawn now (id -> bus with lon/lat), `to` the new answer's list, `p` 0..1.
 * A bus in both moves in a straight line in lat/lon; a new bus appears where it is; a bus that is
 * gone fades out where it was. At p = 1 the gone ones are gone.
 */
export function frameAt(from, to, p) {
  const features = [];
  const seen = new Set();
  for (const bus of to) {
    seen.add(bus.id);
    const was = from.get(bus.id);
    const lon = was ? was.lon + (bus.lon - was.lon) * p : bus.lon;
    const lat = was ? was.lat + (bus.lat - was.lat) * p : bus.lat;
    features.push(feature(bus, lon, lat, 1));
  }
  if (p < 1) {
    for (const [id, bus] of from) if (!seen.has(id)) features.push(feature(bus, bus.lon, bus.lat, 1 - p));
  }
  return { type: "FeatureCollection", features };
}

function feature(bus, lon, lat, opacity) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { id: bus.id, line: bus.line || "", headsign: bus.headsign || "", at: bus.at || "", opacity },
  };
}

/** What is on screen after a frame, for the next glide to start from: the buses still fully there. */
export function onScreen(collection) {
  const m = new Map();
  for (const f of collection.features) {
    if (f.properties.opacity < 1) continue;
    const [lon, lat] = f.geometry.coordinates;
    m.set(f.properties.id, { ...f.properties, lon, lat });
  }
  return m;
}

/** "8 s ago", "3 min ago". A clock a little ahead of the server's is "0 s", not "-2 s". */
export function ago(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
}

/** The popup for one bus: the line (shown bold), and the rest. No line: "Bus". */
export function describe(bus, now) {
  const when = ago(bus.at, now);
  if (!bus.line) return { strong: "", text: `Bus · ${when}` };
  return { strong: bus.line, text: `${bus.headsign ? ` → ${bus.headsign}` : ""} · ${when}` };
}

/**
 * The line under the map, from the last answer or the last error.
 * @param {{ data?: object, error?: object, now: number }} o
 */
export function statusLine({ data, error, now }) {
  if (error) return "Live positions unavailable right now.";
  if (!data) return "";
  if (data.stale && data.reason === "budget") {
    return "Live positions paused for today (daily limit). Times on the board are still live.";
  }
  if (data.stale) return "Live positions unavailable right now.";
  return `Live · updated ${ago(data.updatedAt, now)}`;
}

/** Call `fn` once, `ms` after the last of a burst of calls. */
export function debounce(fn, ms, timers) {
  let t = null;
  return () => {
    timers.clear(t);
    t = timers.set(fn, ms);
  };
}

/**
 * Polls `run` every `every` ms, only while the page is visible AND the map is on screen.
 *
 * Opening the gate (tab shown again, map scrolled back into view) runs at once. Closing it
 * cancels the next run; a run already in flight finishes, but schedules nothing. `now()` asks for
 * a run outside the rhythm (a mode switch, a pan) and, during a run, queues exactly one more.
 *
 * @param {{ run: () => Promise<any>, every?: number, timers: { set: Function, clear: Function } }} o
 */
export function createPoller({ run, every = POLL_MS, timers }) {
  let visible = false;
  let intersecting = false;
  let timer = null;
  let busy = false;
  let again = false;
  const open = () => visible && intersecting;

  async function tick() {
    timers.clear(timer);
    timer = null;
    if (!open()) return;
    if (busy) { again = true; return; }
    busy = true;
    try { await run(); } catch (e) { /* run reports its own failures */ }
    busy = false;
    if (again) { again = false; return tick(); }
    if (open()) timer = timers.set(tick, every);
  }

  return {
    set(state) {
      const was = open();
      if (typeof state.visible === "boolean") visible = state.visible;
      if (typeof state.intersecting === "boolean") intersecting = state.intersecting;
      if (!open()) { timers.clear(timer); timer = null; again = false; }
      else if (!was) tick();
    },
    now: tick,
    get open() { return open(); },
  };
}

export const SOURCE = "buses";
export const LAYERS = ["bus-clusters", "bus-cluster-count", "bus-dots", "bus-lines"];

/**
 * The bus source and its four layers, added to the map's current style or refreshed in it.
 *
 * Called on every `style.load`, because map.js re-inks the basemap with setStyle and a style
 * carries its own sources and layers: a theme change throws the buses away with everything else.
 * Clusters below zoom 14; a bus is an accent dot with its line number on it.
 *
 * @param {object} map - a MapLibre map
 * @param {(token: string) => string} ink - a brand token as a colour MapLibre parses
 * @param {object} data - the FeatureCollection to show
 */
export function ensureBusLayers(map, ink, data) {
  const source = map.getSource(SOURCE);
  if (source) { source.setData(data); return; }
  try {
    map.addSource(SOURCE, { type: "geojson", data, cluster: true, clusterMaxZoom: 13, clusterRadius: 40 });
    map.addLayer({
      id: LAYERS[0], type: "circle", source: SOURCE, filter: ["has", "point_count"],
      paint: {
        "circle-color": ink("accent"),
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 22],
        "circle-stroke-width": 2,
        "circle-stroke-color": ink("bg"),
      },
    });
    map.addLayer({
      id: LAYERS[1], type: "symbol", source: SOURCE, filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
      paint: { "text-color": ink("bg") },
    });
    map.addLayer({
      id: LAYERS[2], type: "circle", source: SOURCE, filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ink("accent"),
        "circle-radius": 10,
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-width": 2,
        "circle-stroke-color": ink("bg"),
        "circle-stroke-opacity": ["get", "opacity"],
      },
    });
    map.addLayer({
      id: LAYERS[3], type: "symbol", source: SOURCE, filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "line"], "text-font": ["Noto Sans Bold"], "text-size": 11,
        "text-allow-overlap": true, "text-ignore-placement": true,
      },
      paint: { "text-color": ink("bg"), "text-opacity": ["get", "opacity"] },
    });
  } catch (err) {
    // Layers before the source: MapLibre will not remove a source a layer still uses. Half-built
    // would otherwise stay half-built, because the getSource check above keeps finding it.
    console.error("transit: the buses could not be drawn", err);
    for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }
}
