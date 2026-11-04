/**
 * The arithmetic of the /world/ map, with no map and no page in it, so it can be tested.
 * Orbits are handed in as `orbit`, the vendored satellite.js, which keeps this file import-free.
 */

export const POLL_MS = 15000;
export const TICK_MS = 1000;

const EARTH_KM = 6371;
const KM_PER_DEGREE = 111.195;
const MAX_RECKON_S = 120;
const OVERHEAD_DEGREES = 10;
const TRACK_MINUTES = 90;
const FLOOR_M = 3;
const OVERHEAD_MAX_KM = 2000;
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const rad = (deg) => (deg * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Where a plane has got to `seconds` after its fix, assuming it flew straight on. */
export function advance(plane, seconds) {
  if (plane.ground || plane.track === null || plane.speed === null) return plane;
  const km = (plane.speed / 3600) * Math.min(seconds, MAX_RECKON_S);
  const heading = rad(plane.track);
  const lat = plane.lat + (km * Math.cos(heading)) / KM_PER_DEGREE;
  const lon = plane.lon + (km * Math.sin(heading)) / (KM_PER_DEGREE * Math.cos(rad(plane.lat)));
  return { ...plane, lat, lon };
}

export function planeFeatures(planes, seconds) {
  return {
    type: "FeatureCollection",
    features: planes.map((plane) => {
      const p = advance(plane, seconds);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { id: p.id, label: p.callsign || p.reg || p.id, track: p.track || 0 },
      };
    }),
  };
}

export function nearest(planes, center, limit) {
  return planes
    .map((p) => ({ ...p, km: distanceKm(center, p) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** A satellite's point on the ground and its height, or null when its orbit no longer computes. */
function locate(rec, date, orbit) {
  const state = orbit.propagate(rec.satrec, date);
  if (!state || !state.position) return null;
  const gmst = orbit.gstime(date);
  const geo = orbit.eciToGeodetic(state.position, gmst);
  if (![geo.latitude, geo.longitude, geo.height].every(Number.isFinite)) return null;
  return { ecf: orbit.eciToEcf(state.position, gmst), lat: orbit.degreesLat(geo.latitude), lon: orbit.degreesLong(geo.longitude), altitude: geo.height };
}

/**
 * Every satellite's ground point, and which low-orbit ones are at least 10 degrees above the
 * horizon at `center`, highest first. Ten degrees because anything lower is behind the buildings.
 */
export function sky(records, center, date, orbit) {
  const observer = {
    latitude: orbit.degreesToRadians(center.lat),
    longitude: orbit.degreesToRadians(center.lon),
    height: 0,
  };
  const features = [];
  const overhead = [];
  for (const rec of records) {
    const at = locate(rec, date, orbit);
    if (!at) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [at.lon, at.lat] },
      properties: { id: rec.id, name: rec.name, altitude: at.altitude },
    });
    const look = orbit.ecfToLookAngles(observer, at.ecf);
    const elevation = (look.elevation * 180) / Math.PI;
    if (elevation >= OVERHEAD_DEGREES && at.altitude <= OVERHEAD_MAX_KM) overhead.push({ id: rec.id, name: rec.name, altitude: at.altitude, elevation });
  }
  overhead.sort((a, b) => b.elevation - a.elevation);
  return { points: { type: "FeatureCollection", features }, overhead };
}

/** The next 90 minutes under a satellite, as lines broken wherever it crosses the date line. */
export function groundTrack(rec, date, orbit) {
  const lines = [[]];
  let previous = null;
  for (let minute = 0; minute <= TRACK_MINUTES; minute += 1) {
    const at = locate(rec, new Date(date.getTime() + minute * 60000), orbit);
    if (!at) continue;
    if (previous !== null && Math.abs(at.lon - previous) >= 180) lines.push([]);
    lines[lines.length - 1].push([at.lon, at.lat]);
    previous = at.lon;
  }
  return { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } };
}

export function buildingFacts(properties) {
  const height = properties.render_height;
  if (!Number.isFinite(height)) return ["Height not mapped"];
  return [`${Math.round(height)} m tall`, `About ${Math.max(1, Math.round(height / FLOOR_M))} floors`];
}

export function compass(degrees) {
  return POINTS[Math.round(degrees / 45) % POINTS.length];
}

export function planeLine(plane) {
  if (plane.ground) return "On the ground";
  const parts = [`${plane.altitude.toLocaleString("en-GB")} m`];
  if (plane.speed !== null) parts.push(`${plane.speed} km/h`);
  if (plane.track !== null) parts.push(compass(plane.track));
  return parts.join(" · ");
}

export function liveLine({ data, error, now }) {
  if (error) return "Planes unavailable right now";
  if (!data) return "";
  if (data.reason === "daily_limit") return "Planes paused for today (daily limit)";
  if (data.stale) return "Planes unavailable right now";
  return `Updated ${Math.max(0, Math.round((now - Date.parse(data.updatedAt)) / 1000))} s ago`;
}

export const REGIONS = [
  { name: "World", center: [10, 25], zoom: 1.6 },
  { name: "Europe", center: [14, 52], zoom: 3.6 },
  { name: "Nordics", center: [17, 63], zoom: 4.2 },
  { name: "Americas", center: [-85, 18], zoom: 2.2 },
  { name: "Asia", center: [95, 30], zoom: 2.8 },
  { name: "Africa", center: [20, 3], zoom: 2.9 },
  { name: "Oceania", center: [145, -25], zoom: 3.2 },
];

const plain = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** 0 for no match, higher for better: a prefix, then a contained word, then a close typo. */
export function fuzzyScore(query, text) {
  const q = plain(query).trim();
  const t = plain(text);
  if (!q) return 0;
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 80;
  const allowed = Math.floor(q.length / 4) + (q.length >= 3 ? 1 : 0);
  const best = Math.min(...t.split(/[^a-z0-9]+/).filter(Boolean).map((word) => editDistance(q, word.slice(0, q.length + 1))));
  return best <= allowed ? 60 - best : 0;
}

/** What is already on the map that matches: found here, so no request is spent. */
export function localMatches(query, { planes, satellites, alerts }, limit = 6) {
  const rows = [
    ...planes.map((p) => ({ type: "plane", label: p.callsign || p.reg || p.id, item: p })),
    ...satellites.map((s) => ({ type: "satellite", label: s.name, item: s })),
    ...alerts.map((a) => ({ type: "alert", label: a.title, item: a })),
  ];
  return rows
    .map((r) => ({ ...r, score: fuzzyScore(query, r.label) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const WORLD_BELOW_ZOOM = 3;
const COUNTRY_BELOW_ZOOM = 6;

export function placeName({ city, county, country }, zoom) {
  if (zoom < WORLD_BELOW_ZOOM) return "World";
  if (!country) return "Open water";
  if (zoom < COUNTRY_BELOW_ZOOM) return country;
  const local = city || county;
  return local ? `${local}, ${country}` : country;
}

export function alertFeatures(alerts) {
  return {
    type: "FeatureCollection",
    features: alerts.filter((a) => a.lat !== null && a.lon !== null).map((a) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: { id: a.id, severity: a.severity, title: a.title },
    })),
  };
}

export function ago(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

export const PLACES = {
  hospital: { label: "Hospital", glyph: "hospital", color: "#d9534f" },
  fire_station: { label: "Fire station", glyph: "fire", color: "#e8833a" },
  police: { label: "Police", glyph: "police", color: "#3f7fd1" },
  town_hall: { label: "Town hall", glyph: "hall", color: "#8a78c9" },
  railway: { label: "Station", glyph: "train", color: "#4f8a8b" },
  ferry_terminal: { label: "Ferry terminal", glyph: "port", color: "#4f8a8b" },
  harbor: { label: "Harbour", glyph: "port", color: "#4f8a8b" },
};

/** The card for a place from the map's own data, which knows a class and usually a name. */
export function placeCard({ class: kind, subclass, name }) {
  const label = subclass === "clinic" ? "Clinic" : (PLACES[kind] || { label: "Place" }).label;
  return { kind: label, name: name || label, facts: [] };
}

const AIRPORT_KINDS = { international: "International airport", public: "Public airport", regional: "Regional airport" };

export function airportCard({ name, iata, icao, ele, class: kind }) {
  const codes = [iata, icao].filter(Boolean).join(" · ");
  return {
    kind: AIRPORT_KINDS[kind] || "Airfield",
    name: name || "Airfield",
    facts: [codes, Number.isFinite(ele) ? `Elevation ${Math.round(ele)} m` : ""].filter(Boolean),
  };
}

/** Clicking nothing still says something: where this is, and the nearest camera. */
export function emptyCard({ lat, lon }, where, camera) {
  return {
    kind: "Here",
    name: where.country ? placeName(where, Infinity) : "Open water",
    facts: [
      `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      camera ? `Nearest camera: ${camera.name}, ${camera.km} km` : "",
    ].filter(Boolean),
  };
}
