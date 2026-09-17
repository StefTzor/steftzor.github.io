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
 * middle of the layout. The two styles below are one cartography in two palettes, so switching
 * between them changes nothing but the ink - the same trick the weather skies in input.css use.
 */

const MAPLIBRE = "/vendor/maplibre-gl.mjs";
const STYLESHEET = "/vendor/maplibre-gl.css";

// Required by the tile terms, and all three are true: OpenFreeMap serves the tiles, OpenMapTiles
// is the schema they are cut to, and OpenStreetMap is whose data it all is. MapLibre's own
// attribution control renders whatever the style declares, so this cannot be left behind when a
// map moves - which is why it is not written into the page.

// **Why this provider and not the two obvious ones.** CARTO's basemaps answer without a key and
// then stamp "API KEY REQUIRED" across every tile - a 200 that looks fine to curl and wrong to a
// person, which is exactly the kind of thing only a rendered screenshot catches. OpenStreetMap's
// own tiles are clean and keyless, but their usage policy is explicit that they are not for use
// as an app's basemap, and testing against them here was throttled within a few minutes, which is
// that policy working rather than failing. OpenFreeMap asks for no key, sets no limit, and exists
// for this; positron and dark are one cartography in two palettes, so a theme change re-inks and
// changes nothing else.
const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const isDark = () => document.documentElement.classList.contains("dark");
const stillness = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    style: STYLE[isDark() ? "dark" : "light"],
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

  // The projection is set after the style rather than in it: these styles are fetched from the
  // provider and say nothing about one, and setting it before the style lands is overwritten when
  // the style does. The globe is the whole reason /f1/ has a map instead of a place name; flat
  // everywhere else, because a globe is right for "which corner of the world is this race in" and
  // wrong for "which stops are within a kilometre of me".
  if (globe) map.on("style.load", () => map.setProjection({ type: "globe" }));

  // Re-ink on a theme change. The theme is a class on <html> toggled by scripts/chrome.js, so
  // there is no event to listen for - an observer on that one attribute is the whole mechanism.
  // setStyle replaces the basemap and keeps the camera, so the map does not jump.
  let theme = isDark() ? "dark" : "light";
  const watch = new MutationObserver(() => {
    const next = isDark() ? "dark" : "light";
    if (next === theme) return;
    theme = next;
    map.setStyle(STYLE[theme]);
  });
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  map.once("remove", () => watch.disconnect());

  // **Do not hand back a map whose basemap never arrived.** Importing the library only proves the
  // library loaded, and it is served from this origin, so it succeeds in exactly the cases the
  // basemap does not: a content blocker, a proxy that allows first-party requests and no others,
  // a reader offline after /vendor has been cached. `new Map()` still returns an object and
  // `createMap` still resolved, so both callers' catch blocks sat idle while the page showed an
  // empty rectangle where a map was announced - which is the thing /docs/ names as a rule.
  //
  // Waiting for `style.load` moves that into the throw the callers already handle. It is the
  // style specifically and not every error: a single tile failing to arrive is a gap in a picture
  // that is otherwise correct, while a style that never loads means there is no picture at all.
  await new Promise((resolve, reject) => {
    if (map.isStyleLoaded()) return resolve();
    // Long enough that a slow connection is not called a failure, short enough that nobody is
    // left watching a blank card decide. A reader on a bad train connection sees the message and
    // still has the board, which is the trade this whole file is built around.
    const giveUp = setTimeout(() => finish(new Error("the basemap did not load in time")), 15000);
    function finish(err) {
      clearTimeout(giveUp);
      map.off("style.load", ok);
      map.off("error", bad);
      if (!err) return resolve();
      // The half-built map is torn down rather than left holding a WebGL context and a worker for
      // a picture nobody will see.
      try { map.remove(); } catch (e) { /* already gone */ }
      reject(err);
    }
    const ok = () => finish(null);
    const bad = (e) => finish((e && e.error) || new Error("the basemap could not be loaded"));
    map.once("style.load", ok);
    map.once("error", bad);
  });

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
