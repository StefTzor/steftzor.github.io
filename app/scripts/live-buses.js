import { api } from "./shell.js";
import { stillness } from "./map.js";
import {
  GLIDE_MS, DEBOUNCE_MS, SOURCE, LAYERS, busesQuery, frameAt, onScreen, describe, statusLine,
  debounce, createPoller, ensureBusLayers,
} from "./live-buses-core.js";

/**
 * UL's buses, live, on the /transit/ map.
 *
 * The board above stays the source of truth: this is a picture beside it, and nothing here can
 * touch the board when it fails. It asks /buses every 15 s and only while the tab is visible and
 * the map is on screen, so nobody looking means no requests. The arithmetic (what to ask, the
 * glide, the gate) is in live-buses-core.js, where it is tested; this file is the page and the map.
 *
 * Positions are not a stop countdown: GTFS stop ids do not match ResRobot's, and the board already
 * says when the bus comes. The popup says which bus it is and how old the fix is.
 */

const DIM = 0.4;  // stale positions are drawn this faint, so a frozen bus does not read as live
const Popup = () => import("/vendor/maplibre-gl.mjs").then((m) => m.Popup);
const timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

/**
 * @param {object} o
 * @param {object} o.map - the transit map, already built
 * @param {HTMLElement} o.box - its container, watched for being on screen
 * @param {() => number[]|null} o.stop - the board's stop as [lon, lat], or null
 * @param {() => string[]} o.lines - the line names on the board now
 * @param {(token: string) => string} o.ink - a brand token as a colour MapLibre parses
 * @returns {{ refresh: () => void }} refresh: the board changed, so "Your lines" asks again
 */
export function startLiveBuses({ map, box, stop, lines, ink }) {
  const el = (id) => document.getElementById(id);
  let mode = "lines";
  let shown = new Map();
  let latest = frameAt(new Map(), [], 1);
  let last = null;
  let raf = 0;
  let off = false;

  function draw(collection) {
    latest = collection;
    ensureBusLayers(map, ink, collection);
  }

  /** Glide from what is on screen to `buses` over a second; jump when motion is unwelcome or unseen. */
  function show(buses, dim) {
    cancelAnimationFrame(raf);
    const from = shown;
    const jump = stillness() || document.visibilityState !== "visible";
    const start = performance.now();
    const step = (t) => {
      const p = jump ? 1 : Math.min(1, (t - start) / GLIDE_MS);
      const collection = frameAt(from, buses, p);
      shown = onScreen(collection);
      if (dim) collection.features.forEach((f) => { f.properties.opacity *= DIM; });
      draw(collection);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    step(start);
  }

  function write() {
    el("trBusNote").textContent = last ? statusLine({ ...last, now: Date.now() }) : "";
  }

  /**
   * No realtime key on this deployment: the feature is not there, so neither is its control.
   * The control appears with the map (below) rather than with the first answer, because "Your
   * lines" asks nothing on a board with no lines, and a switch waiting for an answer would then
   * never appear, leaving no way to "All of Uppsala".
   */
  function disable() {
    off = true;
    poller.set({ visible: false });
    el("trBusMode").classList.add("hidden");
    el("trBusNote").textContent = "";
    show([], false);
  }

  async function run() {
    if (off) return;
    const asked = mode;
    const b = map.getBounds();
    const query = busesQuery({
      mode, lines: lines(), stop: stop(),
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    });
    if (!query) {
      last = null;
      show([], false);
      write();
      return;
    }
    try {
      const data = await api("/buses?" + query);
      // A mode switched while this was in the air: the poller has already queued the next ask.
      if (off || asked !== mode) return;
      last = { data };
      show(Array.isArray(data.buses) ? data.buses : [], data.stale);
    } catch (error) {
      if (error.status === 503 && error.code === "not_configured") return disable();
      if (asked !== mode) return;
      console.error("transit: live buses", error.status, error.code);
      last = { error };
      // Say so first: a failure while dimming the old positions must not leave the line blank.
      write();
      show([...shown.values()], true);
      return;
    }
    write();
  }

  const poller = createPoller({ run, timers });

  function setMode(next) {
    if (off || mode === next) return;
    mode = next;
    el("trBusMine").setAttribute("aria-pressed", String(mode === "lines"));
    el("trBusAll").setAttribute("aria-pressed", String(mode === "all"));
    // The one thing announced. The line under the map changes every 15 s and is not a live region.
    el("trBusSay").textContent = mode === "all"
      ? "Showing every bus in view on the map."
      : "Showing buses on your lines near this stop.";
    poller.now();
  }
  el("trBusMode").classList.remove("hidden");
  el("trBusMine").addEventListener("click", () => setMode("lines"));
  el("trBusAll").addEventListener("click", () => setMode("all"));

  map.on("moveend", debounce(() => { if (mode === "all") poller.now(); }, DEBOUNCE_MS, timers));
  map.on("style.load", () => ensureBusLayers(map, ink, latest));
  draw(latest);

  map.on("click", LAYERS[0], async (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const zoom = await map.getSource(SOURCE).getClusterExpansionZoom(f.properties.cluster_id);
    const center = f.geometry.coordinates;
    if (stillness()) map.jumpTo({ center, zoom });
    else map.easeTo({ center, zoom });
  });
  map.on("click", LAYERS[2], async (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    const { strong, text } = describe(f.properties, Date.now());
    const p = document.createElement("p");
    if (strong) {
      const b = document.createElement("strong");
      b.textContent = strong;
      p.appendChild(b);
    }
    p.appendChild(document.createTextNode(text));
    const Pop = await Popup();
    new Pop({ className: "bus-popup", closeButton: false, offset: 12 })
      .setLngLat(f.geometry.coordinates).setDOMContent(p).addTo(map);
  });
  [LAYERS[0], LAYERS[2]].forEach((id) => {
    map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
  });

  new IntersectionObserver(([entry]) => poller.set({ intersecting: entry.isIntersecting })).observe(box);
  document.addEventListener("visibilitychange", () => poller.set({ visible: document.visibilityState === "visible" }));
  poller.set({ visible: document.visibilityState === "visible" });

  return { refresh() { if (mode === "lines") poller.now(); } };
}
