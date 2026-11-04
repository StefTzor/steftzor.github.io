import { api, apiBytes, profile } from "./shell.js";
import { createMap, goTo, homeTo, stillness } from "./map.js";
import {
  POLL_MS, TICK_MS, REGIONS, distanceKm, planeFeatures, nearest, sky, groundTrack, buildingFacts, planeLine,
  liveLine, localMatches, placeName, alertFeatures, ago, PLACES, placeCard, airportCard, emptyCard,
  tiltFor, photoCredit, routeLine, routeFacts,
} from "./world-core.js";
import { GLYPHS } from "./world-icons.js";
import { createPano } from "./world-pano.js";
import {
  busesQuery, createPoller, ensureBusLayers, frameAt, LAYERS as BUS_LAYERS,
} from "./live-buses-core.js";

/**
 * The /world/ map: find your street and see what is over it, and what is going on elsewhere.
 *
 * Everything external arrives through the API; the orbits are propagated here so a satellite moves
 * every second for no request at all. The API is asked only while the tab is visible and a layer
 * is on. Keyed layers (cameras, traffic, sharp imagery) appear only when /world/config says so.
 */

const START = { center: [17.6389, 59.8586], zoom: 9.5, title: "Uppsala, Sweden" };
const STREET_ZOOM = 15.5;
const CITY_ZOOM = 11;
const STREET_PITCH = 55;
const SATELLITE_ZOOM = 2.5;
const ALERT_ZOOM = 5;
const CAMERA_MIN_ZOOM = 7;
const CAMERA_MARKER_ZOOM = 8.5;
const PANEL_PLANES = 5;
const PANEL_SATS = 5;
const PANEL_CAMERAS = 4;
const ALERTS_POLL_MS = 5 * 60 * 1000;
const SEARCH_PAUSE_MS = 300;
const WHERE_PAUSE_MS = 500;
const MIN_REMOTE_QUERY = 3;
const WORLD_ZOOM = 3;
const TILES = "https://tiles.openfreemap.org/planet";
const TILE_PATH = /^(traffic|imagery)\/\d+\/\d+\/\d+$/;
const CREDIT = 'Aircraft <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> (ODbL)'
  + ' · Orbits <a href="https://celestrak.org" target="_blank" rel="noopener">CelesTrak</a>'
  + ' · Search <a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a>'
  + ' · Cameras <a href="https://www.trafikverket.se" target="_blank" rel="noopener">Trafikverket</a>'
  + ' · Routes <a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb</a>';
const ESRI_CREDIT = "Powered by Esri · Esri, Maxar, Earthstar Geographics";
const SEVERITY_INK = { high: "#d9534f", warn: "#d9b45f", info: "#8fa097" };
const FILTERS = [
  ["all", "All"], ["quake", "Earthquakes"], ["tsunami", "Tsunami"], ["fire", "Fires"], ["flood", "Floods"],
  ["storm", "Storms"], ["volcano", "Volcanoes"], ["sweden", "Sweden"], ["cyber", "Cyber"],
];
const MARKERS = {
  ...Object.fromEntries(Object.entries(PLACES).map(([name, p]) => [name, p])),
  camera: { glyph: "video", color: "#eef0e6", ink: "#13231d" },
  airport: { glyph: "plane", color: "#d9b45f", ink: "#13231d" },
};
const HIT_PX = 7;
const STREET_DIVE_ZOOM = 18.5;
const STREET_RETURN_ZOOM = 17.5;
const SETTLE_MS = 150;
// Esri has no imagery past this over much of Sweden: asking for more gives 404s and blank tiles.
const IMAGERY_MAX_ZOOM = 18;
const ZOOM_MOVED = 0.01;
const CLICKABLE = ["world-alerts", "world-planes", "world-cameras", "world-airports", "world-sats", "world-places", "world-buildings"];
const AIRPORT_MIN_ZOOM = 6;
// Road and building inks for the map, one pair per theme. The base style is a quiet backdrop for a
// page of text; here the map is the page, so streets have to read at a glance.
const ROADS = { dark: "#7d9a8c", light: "#8d8f83" };
const ROADS_MAJOR = { dark: "#a9c0b3", light: "#6d6f64" };
const BLOCKS = { dark: "#3f5f51", light: "#d9dbcf" };
const KINDS = { plane: "Planes", satellite: "Satellites", alert: "Alerts" };

const el = (id) => document.getElementById(id);
const timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
const EMPTY = { type: "FeatureCollection", features: [] };

function ink(token) {
  const channels = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim();
  return `rgb(${channels.split(/\s+/).join(",")})`;
}

/** A round marker with a glyph on it, drawn at twice its size so it stays sharp. */
function markerImage({ glyph, color, ink: mark = "#ffffff" }) {
  const size = 56;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  c.beginPath();
  c.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = "rgba(19,35,29,.85)";
  c.stroke();
  const [width, path] = GLYPHS[glyph];
  const scale = 28 / Math.max(width, 512);
  c.translate((size - width * scale) / 2, (size - 512 * scale) / 2);
  c.scale(scale, scale);
  c.fillStyle = mark;
  c.fill(new Path2D(path));
  return c.getImageData(0, 0, size, size);
}

const dark = () => document.documentElement.classList.contains("dark");

/** Lift the roads off the background, on the drawn map only: a photograph has no such layers. */
function brighten() {
  const { map } = state;
  const theme = dark() ? "dark" : "light";
  for (const { id, type } of map.getStyle().layers) {
    if (type !== "line" || !/^highway_/.test(id)) continue;
    map.setPaintProperty(id, "line-color", /major|motorway/.test(id) ? ROADS_MAJOR[theme] : ROADS[theme]);
  }
}

/** The silhouette as a signed-distance image, so a theme change only has to change a paint colour. */
function planeImage() {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  c.translate(size / 2, size / 2);
  c.scale(1.35, 1.35);
  c.fill(new Path2D("M0-15c2 0 3 3 3 6v5l12 7v3L3 2v8l4 3v2l-7-2-7 2v-2l4-3V2L-15 6V3L-3-4v-5c0-3 1-6 3-6z"));
  return c.getImageData(0, 0, size, size);
}

const state = {
  map: null,
  config: { cameras: false, traffic: false, imagery: false },
  planes: [],
  planesAt: 0,
  records: [],
  overhead: [],
  points: EMPTY,
  alerts: [],
  filter: "all",
  cameras: [],
  on: { alerts: true, planes: true, satellites: true, buildings: true, places: true, buses: false, cameras: false, traffic: false },
  picked: EMPTY,
  pickedAt: null,
  pickedPlane: null,
  handZoom: false,
  settled: null,
  ownTilt: false,
  pano: null,
  diveArmed: true,
  track: EMPTY,
  buses: EMPTY,
  history: [],
  named: true,
  photoUrl: null,
};

function addLayers() {
  const { map } = state;
  const shown = (name) => (state.on[name] ? "visible" : "none");
  if (!map.hasImage("plane")) map.addImage("plane", planeImage(), { sdf: true });
  for (const [name, spec] of Object.entries(MARKERS)) {
    if (!map.hasImage(`wd-${name}`)) map.addImage(`wd-${name}`, markerImage(spec), { pixelRatio: 2 });
  }
  brighten();
  map.addSource("world-vector", { type: "vector", url: TILES });
  if (state.config.traffic) {
    map.addSource("world-traffic", { type: "raster", tiles: ["wd://traffic/{z}/{x}/{y}"], tileSize: 256, minzoom: 6, maxzoom: 20, attribution: "Traffic © TomTom" });
    map.addLayer({ id: "world-traffic", type: "raster", source: "world-traffic", layout: { visibility: shown("traffic") } });
  }
  map.addLayer({
    id: "world-buildings", type: "fill-extrusion", source: "world-vector", "source-layer": "building", minzoom: 13,
    layout: { visibility: shown("buildings") },
    paint: {
      "fill-extrusion-color": BLOCKS[dark() ? "dark" : "light"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      // Over a photograph the blocks would hide the very roofs the photograph shows.
      "fill-extrusion-opacity": map.getSource("s2cloudless") ? 0.2 : 0.85,
    },
  });
  const label = {
    "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11,
    "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true,
  };
  const halo = { "text-color": ink("text"), "text-halo-color": ink("bg"), "text-halo-width": 1.5 };
  map.addLayer({
    id: "world-places", type: "symbol", source: "world-vector", "source-layer": "poi", minzoom: 12,
    filter: ["all",
      ["match", ["get", "class"], Object.keys(PLACES), true, false],
      ["any", ["!=", ["get", "class"], "railway"], ["match", ["get", "subclass"], ["station", "halt"], true, false]],
      // The class also holds every community room and club hall, and those are not town halls.
      ["any", ["!=", ["get", "class"], "town_hall"], ["==", ["get", "subclass"], "townhall"]]],
    layout: {
      visibility: shown("places"), "icon-image": ["concat", "wd-", ["get", "class"]], "icon-size": 1,
      "icon-allow-overlap": true, ...label, "text-field": ["step", ["zoom"], "", 14, ["get", "name"]],
    },
    paint: halo,
  });
  // No "military" here on purpose: the layer carries it as a class, and it stays off this map.
  map.addLayer({
    id: "world-airports", type: "symbol", source: "world-vector", "source-layer": "aerodrome_label",
    minzoom: AIRPORT_MIN_ZOOM, filter: ["!=", ["get", "class"], "military"],
    layout: { visibility: shown("places"), "icon-image": "wd-airport", "icon-allow-overlap": true, ...label },
    paint: halo,
  });
  map.addSource("world-track", { type: "geojson", data: state.track });
  map.addLayer({
    id: "world-track", type: "line", source: "world-track",
    paint: { "line-color": "#d9b45f", "line-width": 2, "line-dasharray": [1, 2] },
  });
  map.addSource("world-picked", { type: "geojson", data: state.picked });
  map.addLayer({
    id: "world-picked", type: "circle", source: "world-picked",
    paint: { "circle-radius": 20, "circle-opacity": 0, "circle-stroke-width": 3, "circle-stroke-color": "#d9b45f" },
  });
  map.addSource("world-cameras", { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "world-cameras", type: "symbol", source: "world-cameras", minzoom: CAMERA_MARKER_ZOOM,
    layout: { visibility: shown("cameras"), "icon-image": "wd-camera", "icon-allow-overlap": true },
  });
  map.addSource("world-alerts", { type: "geojson", data: alertFeatures(state.alerts) });
  map.addLayer({
    id: "world-alerts", type: "circle", source: "world-alerts",
    layout: { visibility: shown("alerts") },
    paint: {
      "circle-radius": ["match", ["get", "severity"], "high", 9, "warn", 7, 5],
      "circle-color": ["match", ["get", "severity"], "high", SEVERITY_INK.high, "warn", SEVERITY_INK.warn, SEVERITY_INK.info],
      "circle-opacity": 0.85, "circle-stroke-width": 2, "circle-stroke-color": ink("bg"),
    },
  });
  map.addSource("world-sats", { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "world-sats", type: "circle", source: "world-sats",
    layout: { visibility: shown("satellites") },
    paint: { "circle-radius": 3.5, "circle-color": ink("text"), "circle-stroke-width": 1, "circle-stroke-color": ink("bg") },
  });
  map.addSource("world-planes", { type: "geojson", data: EMPTY, attribution: CREDIT });
  map.addLayer({
    id: "world-planes", type: "symbol", source: "world-planes",
    layout: {
      visibility: shown("planes"),
      "icon-image": "plane", "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 8, 0.7],
      "icon-rotate": ["get", "track"], "icon-rotation-alignment": "map", "icon-allow-overlap": true,
      "text-field": ["step", ["zoom"], "", 8, ["get", "label"]], "text-font": ["Noto Sans Bold"],
      "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top", "text-optional": true,
    },
    paint: {
      "icon-color": ink("brass"), "icon-halo-color": ink("bg"), "icon-halo-width": 1.5,
      "text-color": ink("text"), "text-halo-color": ink("bg"), "text-halo-width": 1.5,
    },
  });
  ensureBusLayers(map, ink, state.buses);
  showBuses();
  drawCameras();
  paint();
}

function showBuses() {
  for (const id of BUS_LAYERS) {
    if (state.map.getLayer(id)) state.map.setLayoutProperty(id, "visibility", state.on.buses ? "visible" : "none");
  }
}

function makeRow({ primary, secondary, press, severity }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "world-row";
  const left = document.createElement("span");
  left.className = "flex min-w-0 items-baseline text-brand-text";
  if (severity) {
    const dot = document.createElement("span");
    dot.className = "world-dot";
    dot.dataset.severity = severity;
    left.append(dot);
  }
  const words = document.createElement("span");
  words.className = "truncate";
  words.textContent = primary;
  left.append(words);
  const right = document.createElement("span");
  right.className = "shrink-0 text-xs text-brand-muted tabular-nums";
  right.textContent = secondary;
  row.append(left, right);
  row.press = press;
  row.addEventListener("click", () => row.press());
  const li = document.createElement("li");
  li.append(row);
  return li;
}

/**
 * Draw rows in `ul`. Called every second, so an unchanged list is updated in place: replacing the
 * buttons would lose a click between press and release, and keyboard focus along with it.
 */
function list(ul, rows, empty) {
  const key = rows.map((r) => r.key).join("|");
  if (key === ul.dataset.key && rows.length) {
    rows.forEach((r, i) => {
      const button = ul.children[i].firstChild;
      button.lastChild.textContent = r.secondary;
      button.press = r.press;
    });
    return;
  }
  ul.dataset.key = key;
  if (rows.length) {
    ul.replaceChildren(...rows.map(makeRow));
    return;
  }
  const li = document.createElement("li");
  li.className = "hint py-1";
  li.textContent = empty;
  ul.replaceChildren(li);
}

// --- navigation ------------------------------------------------------------------------------

const setTitle = (text) => { el("wdTitle").textContent = text; };

function remember() {
  const { map } = state;
  state.history.push({
    center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), title: el("wdTitle").textContent,
  });
  el("wdBack").disabled = false;
}

function travel({ center, zoom, pitch = 0 }, title) {
  const { map } = state;
  remember();
  state.ownTilt = false;
  state.named = Boolean(title);
  if (title) setTitle(title);
  const to = { center, zoom, pitch };
  homeTo(map, () => (stillness() ? map.jumpTo(to) : map.flyTo({ ...to, speed: 1.2, curve: 1.6, essential: false })));
}

function goBack() {
  const last = state.history.pop();
  el("wdBack").disabled = state.history.length === 0;
  if (!last) return;
  state.named = true;
  setTitle(last.title);
  const { title, ...to } = last;
  homeTo(state.map, () => (stillness() ? state.map.jumpTo(to) : state.map.flyTo({ ...to, speed: 1.2, essential: false })));
}

function nearMe() {
  const note = el("wdNote");
  if (!navigator.geolocation) { note.textContent = "This browser cannot share a location."; return; }
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => travel({ center: [coords.longitude, coords.latitude], zoom: STREET_ZOOM, pitch: STREET_PITCH }),
    () => { note.textContent = "Location was not shared."; },
    { maximumAge: 60000, timeout: 10000 },
  );
}

/** Name the panel after wherever the reader has moved the map to. Last answer wins. */
let whereTimer = null;
let whereAsked = 0;
function nameTheView() {
  clearTimeout(whereTimer);
  if (state.named) return;
  whereTimer = setTimeout(async () => {
    const { map } = state;
    const zoom = map.getZoom();
    if (zoom < WORLD_ZOOM) { setTitle("World"); return; }
    const asked = ++whereAsked;
    const c = map.getCenter();
    try {
      const where = await api(`/world/where?lat=${c.lat.toFixed(2)}&lon=${c.lng.toFixed(2)}`);
      if (asked === whereAsked && !state.named) setTitle(placeName(where, zoom));
    } catch (err) { /* the title keeps the last name it had */ }
  }, WHERE_PAUSE_MS);
}

// --- the panel -------------------------------------------------------------------------------

function showTab(name) {
  const here = name === "here";
  el("wdHere").hidden = !here;
  el("wdAlerts").hidden = here;
  for (const [id, on] of [["wdTabHere", here], ["wdTabAlerts", !here]]) {
    el(id).setAttribute("aria-selected", String(on));
    el(id).tabIndex = on ? 0 : -1;
  }
}

function clearPhoto() {
  el("wdPhoto").hidden = true;
  el("wdPhoto").removeAttribute("src");
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = null;
}

function ringAround(at) {
  state.picked = at
    ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } }
    : EMPTY;
  state.map.getSource("world-picked")?.setData(state.picked);
}

function pick(kind, name, facts, { record = null, url = null, at = null } = {}) {
  state.pickedPlane = null;
  clearPhoto();
  showTab("here");
  ringAround(at);
  state.pickedAt = kind === "Satellite" ? null : at;
  el("wdStreetBtn").hidden = !state.pickedAt;
  el("wdHere").closest(".world-panel").scrollTop = 0;
  el("wdPicked").hidden = false;
  el("wdPickedKind").textContent = kind;
  el("wdPickedName").textContent = name;
  el("wdPickedFacts").replaceChildren(...facts.filter(Boolean).map((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  const link = el("wdPickedLink");
  const linked = Boolean(url && url.startsWith("https://"));
  link.classList.toggle("hidden", !linked);
  if (linked) link.href = url;
  state.track = record ? groundTrack(record, new Date(), state.orbit) : EMPTY;
  state.map.getSource("world-track")?.setData(state.track);
}

/** The card straight away, then the route when it arrives, if this plane is still the one picked. */
async function pickPlane(plane) {
  const facts = [planeLine(plane), [plane.type, plane.reg].filter(Boolean).join(" · ")];
  const name = plane.callsign || plane.reg || plane.id;
  pick("Plane", name, facts, { at: [plane.lon, plane.lat] });
  state.pickedPlane = plane.id;
  if (!plane.callsign) return;
  try {
    const { route } = await api(`/world/route?callsign=${encodeURIComponent(plane.callsign)}`);
    if (!route || state.pickedPlane !== plane.id) return;
    pick("Plane", name, [...facts, ...routeFacts(route)], { at: [plane.lon, plane.lat] });
    state.pickedPlane = plane.id;
    state.track = routeLine(route.from, plane, route.to);
    state.map.getSource("world-track")?.setData(state.track);
  } catch (err) { /* the card keeps what the plane itself reported */ }
}

function pickSatellite(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  const now = state.overhead.find((o) => o.id === id);
  pick("Satellite", record.name, [
    ...(now ? [`${Math.round(now.altitude)} km up`, `${Math.round(now.elevation)}° above the horizon`] : []),
    "Dotted line: its next 90 minutes",
  ], { record });
  const point = state.points.features.find((f) => f.properties.id === id);
  if (point) travel({ center: point.geometry.coordinates, zoom: SATELLITE_ZOOM });
}

function pickAlert(alert) {
  pick("Alert", alert.title, [alert.detail, ago(alert.at, Date.now())], {
    url: alert.url, at: alert.lat === null ? null : [alert.lon, alert.lat],
  });
  if (alert.lat !== null) travel({ center: [alert.lon, alert.lat], zoom: ALERT_ZOOM });
}

async function pickCamera(camera) {
  pick("Camera", camera.name, [`${camera.km} km away`, camera.at ? ago(camera.at, Date.now()) : ""], { at: [camera.lon, camera.lat] });
  try {
    const bytes = await apiBytes(`/world/camera/${encodeURIComponent(camera.id)}`);
    clearPhoto();
    state.photoUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    el("wdPhoto").src = state.photoUrl;
    el("wdPhoto").alt = `Latest photo from ${camera.name}`;
    el("wdPhoto").hidden = false;
  } catch (err) {
    el("wdNote").textContent = "That camera's photo is unavailable right now.";
  }
}

function drawAlerts() {
  const shown = state.alerts.filter((a) => state.filter === "all" || a.kind === state.filter || a.hazard === state.filter);
  const now = Date.now();
  list(el("wdAlertList"), shown.map((a) => ({
    key: a.id, primary: a.title, secondary: ago(a.at, now), severity: a.severity, press: () => pickAlert(a),
  })), "Nothing to report in this category.");
  const urgent = state.alerts.filter((a) => a.severity !== "info").length;
  el("wdAlertTab").textContent = urgent || "";
  el("wdAlertCount").textContent = state.alerts.length || "";
}

function drawCameras() {
  const { map } = state;
  map.getSource("world-cameras")?.setData({
    type: "FeatureCollection",
    features: state.cameras.map((c) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { id: c.id },
    })),
  });
  list(el("wdCams"), state.cameras.slice(0, PANEL_CAMERAS).map((c) => ({
    key: c.id, primary: c.name, secondary: `${c.km} km`, press: () => pickCamera(c),
  })), "None within 60 km");
}

/** Once a second: move what can move without asking anybody. */
function paint() {
  const { map } = state;
  const center = map.getCenter();
  const here = { lat: center.lat, lon: center.lng };
  const seconds = (Date.now() - state.planesAt) / 1000;
  map.getSource("world-planes")?.setData(state.on.planes ? planeFeatures(state.planes, seconds) : EMPTY);
  list(el("wdPlanes"), nearest(state.planes, here, PANEL_PLANES).map((p) => ({
    key: p.id,
    primary: p.callsign || p.reg || p.id,
    secondary: `${Math.round(p.km)} km`,
    press: () => {
      pickPlane(p);
      travel({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 9) });
    },
  })), "None reported near here");
  el("wdPlaneCount").textContent = state.planes.length || "";

  if (state.orbit) {
    const seen = sky(state.records, here, new Date(), state.orbit);
    state.overhead = seen.overhead;
    state.points = seen.points;
    map.getSource("world-sats")?.setData(state.on.satellites ? seen.points : EMPTY);
    list(el("wdSats"), seen.overhead.slice(0, PANEL_SATS).map((s) => ({
      key: s.id,
      primary: s.name,
      secondary: `${Math.round(s.altitude)} km`,
      press: () => pickSatellite(s.id),
    })), "None overhead right now");
    el("wdSatCount").textContent = seen.overhead.length || "";
  }
}

// --- asking the API --------------------------------------------------------------------------

async function pollPlanes() {
  const c = state.map.getCenter();
  let data = null;
  let error = null;
  try {
    data = await api(`/world/planes?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`);
    state.planes = data.planes;
    state.planesAt = Date.now();
  } catch (err) {
    error = err;
  }
  el("wdLive").textContent = liveLine({ data, error, now: Date.now() });
  paint();
}

async function pollBuses() {
  const b = state.map.getBounds();
  const query = busesQuery({ mode: "all", bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
  if (!query) return;
  try {
    const data = await api(`/buses?${query}`);
    state.buses = frameAt(new Map(), data.buses, 1);
    ensureBusLayers(state.map, ink, state.buses);
    showBuses();
  } catch (err) { /* the bus layer simply stays where it was */ }
}

async function pollAlerts() {
  try {
    const { alerts, sources } = await api("/world/alerts");
    state.alerts = alerts;
    state.map.getSource("world-alerts")?.setData(alertFeatures(alerts));
    const live = sources.filter((s) => s.ok).length;
    el("wdFeeds").textContent = live === sources.length
      ? `All ${live} feeds live`
      : `${live} of ${sources.length} feeds live. Down: ${sources.filter((s) => !s.ok).map((s) => s.name).join(", ")}`;
  } catch (err) {
    el("wdFeeds").textContent = "Alerts are unavailable right now.";
  }
  drawAlerts();
}

async function pollCameras() {
  const { map } = state;
  if (map.getZoom() < CAMERA_MIN_ZOOM) return;
  const c = map.getCenter();
  try {
    state.cameras = (await api(`/world/cameras?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`)).cameras;
  } catch (err) {
    state.cameras = [];
  }
  drawCameras();
}

async function loadSatellites() {
  try {
    const [orbit, data] = await Promise.all([import("/vendor/satellite.mjs"), api("/world/satellites")]);
    state.orbit = orbit;
    state.records = data.satellites.map((s) => ({ id: s.NORAD_CAT_ID, name: s.OBJECT_NAME, satrec: orbit.json2satrec(s) }));
    paint();
  } catch (err) {
    el("wdNote").textContent = "Satellites are unavailable right now.";
  }
}

// --- street view -----------------------------------------------------------------------------

/** Leaving lifts the map clear of the dive level, so zooming back in opens the street again. */
function closeStreet() {
  if (el("wdStreet").hidden) return;
  state.pano?.stop();
  el("wdStreet").hidden = true;
  el("wdMap").focus?.();
  if (state.map.getZoom() >= STREET_DIVE_ZOOM) {
    if (stillness()) state.map.jumpTo({ zoom: STREET_RETURN_ZOOM });
    else state.map.easeTo({ zoom: STREET_RETURN_ZOOM, duration: 500 });
  }
}

async function showPhoto(photo, keepView) {
  const blob = new Blob([await apiBytes(`/world/photo/${photo.id}`)], { type: "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  el("wdStreet").hidden = false;
  state.pano = state.pano || createPano(el("wdPano"), { onExit: closeStreet, still: stillness });
  state.pano.show(bitmap, keepView);
  bitmap.close();
  state.photo = photo;
  el("wdStreetCredit").textContent = photoCredit(photo);
  drawSteps();
  ringAround([photo.lon, photo.lat]);
}

/** Forward is the way you are facing, so turning round swaps which neighbour it means. */
function neighbour(forward) {
  const { photo, pano } = state;
  if (!photo) return null;
  return forward === pano.facingForward() ? photo.next : photo.prev;
}

function drawSteps() {
  el("wdStreetForward").disabled = !neighbour(true);
  el("wdStreetBack").disabled = !neighbour(false);
}

async function step(forward) {
  const id = neighbour(forward);
  if (!id || state.stepping) return;
  state.stepping = true;
  try {
    const { photo } = await api(`/world/photo/${id}/details`);
    if (photo) await showPhoto(photo, true);
  } catch (err) {
    el("wdStreetCredit").textContent = "That photo is unavailable right now.";
  }
  state.stepping = false;
}

/** The nearest 360 photo to a point. No photo is a note, and the map stays where it is. */
async function openStreet([lon, lat]) {
  const note = el("wdNote");
  note.textContent = "Looking for a street photo…";
  try {
    const { photo } = await api(`/world/photo?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    if (!photo) { note.textContent = "No street photo near here."; return; }
    await showPhoto(photo, false);
    el("wdPano").focus();
    note.textContent = "";
  } catch (err) {
    closeStreet();
    note.textContent = "Street photos are unavailable right now.";
  }
}

/**
 * Once the map settles after a zoom by hand: tilt with the zoom, and past the closest level drop
 * into the street. Compared with the last settled view rather than watched from zoomstart, because
 * the first wheel event of a gesture does not say it came from a wheel.
 */
function followZoom() {
  const { map } = state;
  const zoom = map.getZoom();
  const from = state.settled;
  state.settled = { zoom, pitch: map.getPitch() };
  if (zoom < STREET_DIVE_ZOOM) state.diveArmed = true;
  const byHand = state.handZoom && Math.abs(zoom - from.zoom) > ZOOM_MOVED;
  state.handZoom = false;
  if (!byHand) return;
  if (!state.ownTilt) {
    const pitch = tiltFor(zoom);
    if (stillness()) map.jumpTo({ pitch });
    else map.easeTo({ pitch, duration: 400 });
  }
  if (zoom >= STREET_DIVE_ZOOM && state.diveArmed) {
    state.diveArmed = false;
    const c = map.getCenter();
    openStreet([c.lng, c.lat]);
  }
}

// --- search ----------------------------------------------------------------------------------

function closeResults() {
  el("wdResults").replaceChildren();
  el("wdSearchNote").textContent = "";
}

function choosePlace(place) {
  closeResults();
  el("wdQuery").value = "";
  const zoom = place.kind === "place" ? CITY_ZOOM : STREET_ZOOM;
  travel({ center: [place.lon, place.lat], zoom, pitch: place.kind === "place" ? 0 : STREET_PITCH }, place.label);
}

function chooseLocal({ type, item }) {
  closeResults();
  el("wdQuery").value = "";
  if (type === "plane") {
    pickPlane(item);
    travel({ center: [item.lon, item.lat], zoom: Math.max(state.map.getZoom(), 9) });
  } else if (type === "satellite") pickSatellite(item.id);
  else pickAlert(item);
}

function drawResults(places, local) {
  const box = el("wdResults");
  const groups = [];
  const group = (label, rows) => {
    if (!rows.length) return;
    const title = document.createElement("p");
    title.className = "world-group";
    title.textContent = label;
    groups.push(title, ...rows);
  };
  group("Places", places.map((p) => makeRow({ primary: p.label, secondary: "", press: () => choosePlace(p) })));
  for (const type of Object.keys(KINDS)) {
    group(KINDS[type], local.filter((m) => m.type === type)
      .map((m) => makeRow({ primary: m.label, secondary: "", press: () => chooseLocal(m) })));
  }
  box.replaceChildren(...groups);
}

let searchAsked = 0;
let searchTimer = null;
function typed() {
  clearTimeout(searchTimer);
  const q = el("wdQuery").value.trim();
  const note = el("wdSearchNote");
  const asked = ++searchAsked;
  if (q.length < 2) { closeResults(); return; }
  const local = localMatches(q, { planes: state.planes, satellites: state.records, alerts: state.alerts });
  drawResults([], local);
  note.textContent = "";
  if (q.length < MIN_REMOTE_QUERY) return;
  searchTimer = setTimeout(async () => {
    try {
      const { results } = await api(`/world/search?q=${encodeURIComponent(q)}`);
      if (asked !== searchAsked) return;
      drawResults(results, local);
      note.textContent = results.length || local.length ? "" : "Nothing found.";
    } catch (err) {
      if (asked === searchAsked) note.textContent = "Place search is unavailable right now.";
    }
  }, SEARCH_PAUSE_MS);
}

function searchKeys(event) {
  const rows = [...el("wdResults").querySelectorAll("button")];
  const at = rows.indexOf(document.activeElement);
  if (event.key === "Escape") { closeResults(); el("wdQuery").focus(); }
  else if (event.key === "ArrowDown" && rows.length) { event.preventDefault(); rows[Math.min(at + 1, rows.length - 1)].focus(); }
  else if (event.key === "ArrowUp" && at >= 0) { event.preventDefault(); (at === 0 ? el("wdQuery") : rows[at - 1]).focus(); }
}

// --- layers and clicks -----------------------------------------------------------------------

const LAYER_IDS = {
  alerts: ["world-alerts"], planes: ["world-planes"], satellites: ["world-sats"], buildings: ["world-buildings"],
  places: ["world-places", "world-airports"], cameras: ["world-cameras"], traffic: ["world-traffic"],
};

function setLayer(name, on) {
  state.on[name] = on;
  const { map } = state;
  if (name === "buses") {
    showBuses();
    busPoller.set({ intersecting: on });
    return;
  }
  for (const id of LAYER_IDS[name]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  if (name === "planes") planePoller.set({ intersecting: on });
  if (name === "cameras") {
    el("wdCamBlock").hidden = !on;
    if (on) pollCameras();
  }
  paint();
}

function hitAt({ x, y }) {
  const { map } = state;
  const layers = CLICKABLE.filter((id) => map.getLayer(id));
  const box = [[x - HIT_PX, y - HIT_PX], [x + HIT_PX, y + HIT_PX]];
  return map.queryRenderedFeatures(box, { layers })[0] || null;
}

/** Nothing was hit, so say where this is. The nearest camera comes from what is already loaded. */
async function clickEmpty({ lat, lng }) {
  const here = { lat, lon: lng };
  const near = state.cameras.map((c) => ({ ...c, km: Math.round(distanceKm(here, c)) })).sort((a, b) => a.km - b.km)[0] || null;
  let where = {};
  try {
    where = await api(`/world/where?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`);
  } catch (err) { /* the card still has its coordinates */ }
  const card = emptyCard(here, where, near);
  pick(card.kind, card.name, card.facts, { at: [lng, lat] });
}

function clickMap(e) {
  const hit = hitAt(e.point);
  if (!hit) { clickEmpty(e.lngLat); return; }
  const { id } = hit.properties;
  const at = [e.lngLat.lng, e.lngLat.lat];
  const layer = hit.layer.id;
  if (layer === "world-planes") {
    const plane = state.planes.find((p) => p.id === id);
    if (plane) pickPlane(plane);
  } else if (layer === "world-sats") pickSatellite(id);
  else if (layer === "world-alerts") {
    const alert = state.alerts.find((a) => a.id === id);
    if (alert) pickAlert(alert);
  } else if (layer === "world-cameras") {
    const camera = state.cameras.find((c) => c.id === id);
    if (camera) pickCamera(camera);
  } else if (layer === "world-places" || layer === "world-airports") {
    const card = layer === "world-places" ? placeCard(hit.properties) : airportCard(hit.properties);
    pick(card.kind, card.name, card.facts, { at: hit.geometry.coordinates });
  } else pick("Building", "Building", buildingFacts(hit.properties), { at });
}

const planePoller = createPoller({ run: pollPlanes, every: POLL_MS, timers });
const busPoller = createPoller({ run: pollBuses, every: POLL_MS, timers });
const alertPoller = createPoller({ run: pollAlerts, every: ALERTS_POLL_MS, timers });

function buildControls() {
  const nav = el("wdNav");
  for (const region of REGIONS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "world-chip";
    chip.textContent = region.name;
    chip.addEventListener("click", () => travel(region, region.name));
    nav.append(chip);
  }
  el("wdBack").addEventListener("click", goBack);
  el("wdStreetBtn").addEventListener("click", () => { if (state.pickedAt) openStreet(state.pickedAt); });
  el("wdStreetClose").addEventListener("click", closeStreet);
  el("wdStreetForward").addEventListener("click", () => step(true));
  el("wdStreetBack").addEventListener("click", () => step(false));
  el("wdPano").addEventListener("pointerup", drawSteps);
  el("wdPano").addEventListener("keyup", drawSteps);
  window.addEventListener("resize", () => { if (!el("wdStreet").hidden) state.pano?.resize(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeStreet(); });
  el("wdNear").addEventListener("click", nearMe);

  const filters = el("wdFilters");
  for (const [value, label] of FILTERS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "world-chip";
    chip.textContent = label;
    chip.setAttribute("aria-pressed", String(value === state.filter));
    chip.addEventListener("click", () => {
      state.filter = value;
      filters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === chip)));
      drawAlerts();
    });
    filters.append(chip);
  }

  el("wdTabHere").addEventListener("click", () => showTab("here"));
  el("wdTabAlerts").addEventListener("click", () => showTab("alerts"));
  for (const [id, other, name] of [["wdTabHere", "wdTabAlerts", "alerts"], ["wdTabAlerts", "wdTabHere", "here"]]) {
    el(id).addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      showTab(name);
      el(other).focus();
    });
  }

  const search = el("wdSearch");
  search.addEventListener("submit", (e) => {
    e.preventDefault();
    el("wdResults").querySelector("button")?.click();
  });
  el("wdQuery").addEventListener("input", typed);
  search.addEventListener("keydown", searchKeys);
  document.addEventListener("click", (e) => { if (!search.contains(e.target)) closeResults(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      el("wdQuery").focus();
    }
  });

  const cameras = document.querySelector('[data-layer="cameras"]');
  cameras.hidden = !state.config.cameras;
  if (state.config.cameras) {
    cameras.setAttribute("aria-pressed", "true");
    setLayer("cameras", true);
  }
  document.querySelector('[data-layer="traffic"]').hidden = !state.config.traffic;
  document.querySelectorAll("[data-layer]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const on = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", String(on));
      setLayer(chip.dataset.layer, on);
    });
  });
}

async function start(me) {
  const home = me && me.homeLocation;
  const view = home ? { ...START, center: [home.lon, home.lat], title: home.name || START.title } : START;
  try { state.config = await api("/world/config"); } catch (err) { /* keyed layers stay off */ }
  const lib = await import("/vendor/maplibre-gl.mjs").catch(() => null);
  lib?.addProtocol("wd", async (params) => {
    const path = params.url.slice("wd://".length);
    if (!TILE_PATH.test(path)) throw new Error("not a tile");
    return { data: await apiBytes(`/world/tile/${path}`) };
  });
  const imagery = state.config.imagery
    ? { tiles: ["wd://imagery/{z}/{x}/{y}"], tileSize: 256, maxzoom: IMAGERY_MAX_ZOOM, attribution: ESRI_CREDIT }
    : null;
  try {
    state.map = await createMap(el("wdMap"), { ...view, globe: true, satellite: true, explore: true, imagery });
  } catch (err) {
    el("wdNote").textContent = "The map could not be loaded.";
    return;
  }
  const { map } = state;
  setTitle(view.title);
  addLayers();
  map.on("style.load", addLayers);
  map.on("click", clickMap);
  map.on("mousemove", (e) => {
    map.getCanvas().classList.toggle("world-hot", Boolean(hitAt(e.point)));
  });
  map.on("movestart", (e) => { if (e.originalEvent) state.named = false; });
  state.settled = { zoom: map.getZoom(), pitch: map.getPitch() };
  // A tilt by hand is a choice: the zoom leaves it alone until the map is flat again or travels.
  map.on("pitch", (e) => { if (e.originalEvent) state.ownTilt = map.getPitch() > 1; });
  map.on("moveend", (e) => {
    if (e.originalEvent) state.handZoom = true;
    // After the event, not in it: a wheel's own ending would otherwise cancel the tilt it started.
    clearTimeout(state.settle);
    state.settle = setTimeout(() => { if (!map.isMoving()) followZoom(); }, SETTLE_MS);
    planePoller.now();
    if (state.on.cameras) pollCameras();
    nameTheView();
  });
  buildControls();
  const visible = () => document.visibilityState === "visible";
  for (const poller of [planePoller, alertPoller]) poller.set({ visible: visible(), intersecting: true });
  busPoller.set({ visible: visible(), intersecting: false });
  document.addEventListener("visibilitychange", () => {
    for (const poller of [planePoller, alertPoller, busPoller]) poller.set({ visible: visible() });
  });
  setInterval(() => { if (visible()) { paint(); } }, TICK_MS);
  loadSatellites();
}

profile.then(start);
