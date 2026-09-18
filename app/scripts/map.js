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
// for this.
//
// **The two styles are one cartography, because we built the second one.** OpenFreeMap serves
// five styles and none of them is a dark positron: `dark` paints a background of rgb(12,12,12),
// darker than this app's own page at #0f172a, so it reads as a hole punched through the layout,
// and `fiord` - which this shipped before - draws 48 layers to positron's 55 and 14 layers of
// labels to its 16, which is why the light map looked like the better-made one rather than merely
// the brighter one. So the dark style here is positron itself, re-inked to this app's palette and
// nothing else: same layers, same filters, same zoom stops, same tile source. Its provenance and
// every colour substitution are in vendor/positron-dark.build.mjs, which regenerates it from the
// URL above and refuses to if anything but a colour has moved.
//
// It being local changes nothing about where the map comes from. The style document is the only
// part that was ever fetched from the provider as a document; the tiles, glyphs and sprite are
// still requested from tiles.openfreemap.org because the sources block is copied verbatim, so the
// CSP in eleventy.app.js is unchanged and the attribution - which MapLibre reads from the
// TileJSON at the source URL, not from the style - arrives with them exactly as before.
const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "/vendor/positron-dark.json",
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
    attributionControl: { compact: true },
    // **Zoom has to be reachable, and the page's scroll has to stay the page's.** The first cut of
    // this turned scroll-zoom off and added no controls, which left a map nobody could zoom at
    // all. `cooperativeGestures` is the setting that serves both: an ordinary wheel scrolls the
    // document past the map, ctrl/cmd + wheel zooms it, and MapLibre shows that instruction over
    // the map the first time somebody tries. On touch, one finger pans the page and two zoom the
    // map.
    cooperativeGestures: true,
    // Tilting and spinning are not useful for either of these and a stray two-finger twist is an
    // easy way to end up looking at a horizon nobody asked for. Zoom survives; rotation does not.
    pitchWithRotate: false,
    dragRotate: false,
  });

  // Buttons as well as gestures, because a gesture nobody discovers is not a control. Compass off
  // for the same reason rotation is: there is no bearing here worth resetting.
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
    "top-right");
  // Fullscreen, because both of these maps are a card in a column on a phone and the thing anybody
  // wants next is more of it. MapLibre's control handles the resize itself, so there is nothing to
  // wire up on the way in or the way out.
  //
  // **The card, not the map container.** Given no `container`, the control fullscreens the element
  // the map was built in - which on /f1/ is the box that EXCLUDES the key and the note under it,
  // and that key is the only text the dots and the outlines have. Going fullscreen therefore
  // dropped the words and kept the picture, on the one screen size where the words matter most.
  //
  // `closest` rather than a new option, because both callers already wrap their map in `.card` and
  // neither has anything to say about it that the markup does not already say. On /transit/ the map
  // container IS the card, so `closest` returns that same element and that map fullscreens exactly
  // as it did before - including while the box is still `hidden`, since nothing here reads its
  // layout. An option would have been a second way to state a fact the DOM already holds, and the
  // next caller to forget it would quietly get this bug back.
  map.addControl(
    new maplibregl.FullscreenControl({ container: container.closest(".card") || container }),
    "top-right");
  // Pinch to zoom, but never to rotate.
  map.touchZoomRotate.disableRotation();

  // The projection is set after the style rather than in it: neither style declares one - the dark
  // one is positron copied layer for layer, so it says no more about projection than positron does
  // - and setting it before the style lands is overwritten when the style does. The globe is the whole reason /f1/ has a map instead of a place name; flat
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

/**
 * Move so that a bounding box fills the map, honouring somebody who asked not to be moved.
 *
 * **A zoom number cannot answer "show me this circuit".** The thing being framed has a size, and
 * on this calendar that size varies by more than two to one - Monaco is 3.3 km of street and Spa
 * is 7 km through a forest - so any single zoom is too close for one and too far for the other.
 * A box is the honest input: fitBounds solves for the zoom that makes it fit, which is a
 * different number for every circuit and the right one for each.
 *
 * `padding` is what stops the shape touching the edges, and it is the difference between a
 * circuit and a circuit somewhere: at 56px the track fills most of the card and still sits in
 * enough of its surroundings to be recognisably at a place rather than floating.
 *
 * `maxZoom` is a guard rather than a preference. A degenerate box - two identical corners, which
 * a malformed outline would give - solves to the maximum zoom the projection has, and the result
 * is a reader staring at four grey pixels wondering what broke.
 *
 * @param {object} map
 * @param {number[]} bbox - [west, south, east, north]
 * @returns {boolean} whether the box was usable. **False means fall back** - unlike goTo above,
 *   which returns the map, this answers a question, because the caller has somewhere else to go.
 */
export function frame(map, bbox) {
  // **Checked before it is destructured, which is this codebase's rule and not defensiveness for
  // its own sake.** GeoJSON permits a six-element bbox - `[w, s, minElevation, e, n, maxElevation]`
  // - and positional destructuring reads that as east = the minimum elevation, which is a finite
  // number, so nothing throws and the map frames a box reaching from the circuit to a longitude
  // somewhere near sea level in metres. Every other malformed shape makes MapLibre throw from
  // LngLat's own constructor, which is survivable; this one is silent and wrong, which is not.
  //
  // `false` rather than a throw, because the caller already has the right answer to "no usable
  // box" three lines further down and it is the same answer an absent outline gets.
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  const bounds = [[west, south], [east, north]];
  const fit = { padding: 56, maxZoom: 15 };
  // Both branches written the same plain way. The first draft returned `map.fitBounds(...), true`
  // here and a bare `true` below, which is the cleverer line hiding in the branch a test running
  // with prefers-reduced-motion off never executes - and losing the `true` from it costs exactly
  // the readers who cannot see a flight: aim() reads false, falls through, and moves the camera a
  // second time on top of the framing it just did.
  if (stillness()) map.fitBounds(bounds, { ...fit, duration: 0 });
  else map.fitBounds(bounds, { ...fit, speed: 0.8, curve: 1.4, essential: false });
  return true;
}
