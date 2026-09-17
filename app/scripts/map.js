/**
 * Maps, for the two pages that have somewhere to show.
 *
 * MapLibre is ~300 KB gzipped, which is more than the rest of this app put together, so it is
 * NEVER on the critical path: `createMap()` imports it at the moment a map is actually wanted and
 * the page has already painted everything it can answer without one. A board of departures that
 * waited for a map library before showing the next bus would have the priorities backwards.
 *
 * It is self-hosted in /vendor for the same reason the fonts and the icons are. A CDN would put a
 * third party in script-src on every page with a map on it, and this repo spent a whole pass
 * taking the last of those out.
 *
 * **The basemap follows the theme, because a map that does not is the one thing on the page that
 * looks broken.** A single-tone basemap under a dark page is a white rectangle with a hole in the
 * middle of the layout; the two CARTO styles are the same cartography in two palettes, so
 * switching between them changes nothing but the ink - which is the same trick the weather skies
 * in input.css use.
 */

const MAPLIBRE = "/vendor/maplibre-gl.mjs";
const STYLESHEET = "/vendor/maplibre-gl.css";

// Both required by the tile terms, and both true: CARTO draws these from OpenStreetMap's data.
// Rendered by MapLibre's own attribution control rather than written into the page, so it cannot
// be left behind when a map moves.
const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" rel="noopener">© OpenStreetMap</a> · ' +
  '<a href="https://carto.com/attributions" rel="noopener">© CARTO</a>';

const BASEMAP = {
  // Subdomains because a browser limits connections per host and a map asks for a lot of tiles at
  // once. `{ratio}` is MapLibre's hook for a retina tile; CARTO serves @2x at the same paths.
  light: "https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{ratio}.png",
  dark: "https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{ratio}.png",
};

const isDark = () => document.documentElement.classList.contains("dark");
const stillness = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Expands MapLibre's {a-d} into the four URLs it wants, since the spec takes a list. */
function tiles(template) {
  const ratio = window.devicePixelRatio > 1.5 ? "@2x" : "";
  return ["a", "b", "c", "d"].map((sub) =>
    template.replace("{a-d}", sub).replace("{ratio}", ratio));
}

function styleFor(theme, { globe }) {
  return {
    version: 8,
    // A raster basemap rather than vector: vector needs a style server or a bundled glyph and
    // sprite set, and this draws a circuit and a bus stop - the cartography is a backdrop, not
    // the content. Raster also means the tiles are plain images, which is one CSP directive.
    sources: {
      basemap: {
        type: "raster",
        tiles: tiles(BASEMAP[theme]),
        tileSize: 256,
        attribution: ATTRIBUTION,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    // The globe is the whole reason the F1 page has a map rather than a place name. Flat
    // everywhere else: a globe is the right projection for "which corner of the world is this
    // race in" and the wrong one for "which bus stops are within a kilometre of me".
    projection: { type: globe ? "globe" : "mercator" },
  };
}

// The stylesheet is injected once per document rather than declared in each page's front matter,
// so a page pays for it only if it draws a map. Local, so style-src-elem 'self' covers it; a
// third-party stylesheet would fail the build, which is the check working as intended.
let styled = false;
function stylesheet() {
  if (styled || document.querySelector(`link[href="${STYLESHEET}"]`)) return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET;
  document.head.appendChild(link);
}

// One import for the whole page however many maps ask for it, and the promise itself is the lock:
// two simultaneous callers await the same fetch rather than starting two.
let loading = null;
const maplibre = () => (loading || (loading = import(MAPLIBRE).then((m) => m.default || m)));

/**
 * A map in `container`, once the library has arrived.
 *
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {boolean} [opts.globe]      globe projection instead of flat
 * @param {[number, number]} [opts.center]  [lon, lat] - MapLibre's order, which is not the order
 *                                          anybody says a coordinate out loud in
 * @param {number} [opts.zoom]
 * @returns {Promise<object>} the MapLibre map, with `.flyTo`/`.jumpTo` as usual
 *
 * Throws if the library cannot be loaded. Callers are expected to catch and say so on the page:
 * a map is an addition to every page that has one, never the thing the page is for.
 */
export async function createMap(container, { globe = false, center = [0, 0], zoom = 1 } = {}) {
  stylesheet();
  const maplibregl = await maplibre();

  const map = new maplibregl.Map({
    container,
    style: styleFor(isDark() ? "dark" : "light", { globe }),
    center,
    zoom,
    // Nothing here is a navigation surface. The F1 globe is a picture of where a race is and the
    // transit map is a picture of where a stop is; both are read at a glance and neither is
    // explored, so the controls that invite exploring are off and the keyboard is left alone.
    attributionControl: { compact: true },
    // A map that scrolls the page past it must not swallow the scroll. Dragging still works, so
    // it can be moved deliberately - it simply does not grab a gesture aimed at the document.
    scrollZoom: false,
    // The globe has no business being tilted or spun by a stray two-finger drag.
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: globe ? false : undefined,
  });

  // Re-ink on a theme change. The theme is a class on <html> toggled by scripts/chrome.js, so
  // there is no event to listen for - an observer on that one attribute is the whole mechanism.
  // setStyle replaces the basemap and keeps the camera, so the map does not jump.
  let theme = isDark() ? "dark" : "light";
  const watch = new MutationObserver(() => {
    const next = isDark() ? "dark" : "light";
    if (next === theme) return;
    theme = next;
    map.setStyle(styleFor(theme, { globe }));
  });
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  map.once("remove", () => watch.disconnect());

  return map;
}

/**
 * Move to a place, honouring somebody who asked not to be moved.
 *
 * The flight between two circuits is the one piece of non-user-triggered motion in this app and
 * it is the point of the globe - so it is also exactly the kind of thing prefers-reduced-motion
 * exists for. Reduced motion gets the destination, immediately, with nothing lost but the journey.
 */
export function goTo(map, center, zoom) {
  if (stillness()) return map.jumpTo({ center, zoom });
  return map.flyTo({ center, zoom, speed: 0.8, curve: 1.4, essential: false });
}
