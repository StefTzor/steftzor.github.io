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

/**
 * Satellite, as a style of its own rather than a layer on top of the other two.
 *
 * **Why it is offered on /f1/ and not on /transit/.** A photograph of Spa is a pale ribbon through
 * a forest and a photograph of Monza is an oval nobody could mistake - imagery answers "which
 * circuit is this" better than a map can. A photograph of a bus stop is a roof. Satellite hides
 * exactly what a departure board's map is for: the street name, the stop label, which way the road
 * runs. So the toggle is a per-map option rather than a global one.
 *
 * **It does nothing for a street circuit, and that is not a reason to leave it out.** Monaco, Baku
 * and Singapore are public roads, so from above they are a city and nothing else. What makes them
 * legible is the outline drawn over the photograph - which is why this is a basemap swap and not a
 * separate map: the dots, the circuit and its casing are re-added over whichever basemap is
 * underneath, by the same style.load path a theme change already uses. The casing is what keeps
 * the outline readable over a photograph it knows nothing about, which is the reason it exists.
 *
 * **EOX licence this on a condition, so the condition is met in two places.** The attribution
 * below is required and names the year, and MapLibre renders it into the control already on the
 * map. The other place is /privacy/ and /cookies/, because this is a second host a reader's
 * browser contacts: a request this code cannot make on their behalf is one they can only learn
 * about by being told. The year is interpolated into both the URL and the credit from one
 * constant, so the imagery and the crediting of it cannot come apart.
 *
 * Sentinel-2 is 10 m data and a 256-pixel tile at zoom 14 is 9.55 m a pixel at the equator, which
 * is native - so `maxzoom: 14` is where the imagery stops being measured rather than inferred.
 * Asking for 15 or 16 returns the same pixels upscaled by the server at four and sixteen times the
 * requests; past 14 MapLibre stretches the last real tile instead, which is the same picture for
 * none of the traffic.
 *
 * **`tileSize: 256` also means MapLibre asks for one zoom level deeper than the map is at**, which
 * is worth knowing before comparing these numbers to the framing ones. Observed rather than
 * assumed: a map at zoom 13 requests `/g/14/...`. So the cap bites from map zoom 13 upward, and
 * the circuits - framed between 12.7 and 15.2 - run from native at the far end to about twice
 * stretched at the closest. Which is the right trade for imagery that was 10 m to begin with.
 */
const SATELLITE_YEAR = 2025;
const SATELLITE = {
  version: 8,
  sources: {
    s2cloudless: {
      type: "raster",
      // `{y}` before `{x}` because this is WMTS, whose path is TileRow then TileCol. MapLibre
      // substitutes each placeholder wherever it finds it, so the order here is the server's.
      tiles: [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${SATELLITE_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`],
      tileSize: 256,
      maxzoom: 14,
      attribution:
        '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> '
        + `by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${SATELLITE_YEAR})`,
    },
  },
  layers: [{ id: "s2cloudless", type: "raster", source: "s2cloudless" }],
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
 * The map/satellite switch, as a MapLibre control so it sits with the zoom and fullscreen buttons.
 *
 * A real `<button>` with `aria-pressed`, not a styled div: this is a two-state toggle, that is the
 * attribute that says so, and a screen reader then announces the state change without the label
 * having to be rewritten. The label stays "Satellite" in both states for the same reason - a
 * button whose name changes when you press it is one a voice-control user cannot ask for twice.
 *
 * MapLibre's own control CSS styles `.maplibregl-ctrl button`, so the button inherits the size,
 * the background and the focus ring of the zoom buttons beside it rather than inventing its own.
 */
function basemapToggle(onChange) {
  let button;
  return {
    onAdd() {
      const box = document.createElement("div");
      box.className = "maplibregl-ctrl maplibregl-ctrl-group";
      button = document.createElement("button");
      button.type = "button";
      button.textContent = "Satellite";
      button.setAttribute("aria-pressed", "false");
      // Narrow enough that MapLibre's square button rule would clip the word.
      button.style.width = "auto";
      button.style.padding = "0 8px";
      button.style.font = "inherit";
      button.style.fontSize = "11px";
      button.style.fontWeight = "600";
      // **An explicit colour, because this one is not a brand surface.** MapLibre's controls are
      // its own white in BOTH themes - nothing in this app themes `.maplibregl-ctrl` - while
      // `color` is inherited from the page, which in dark mode is nearly white. The result was a
      // white button with white text, invisible until pressed. A brand token would be the same
      // bug with more steps: brand-text is light in dark mode for exactly the right reason.
      // These two are MapLibre's own control-icon greys, so the button matches the zoom and
      // fullscreen buttons it sits with rather than inventing a third look.
      const ON = "#0b6b4f";   // the pressed state reads as on without a second control
      const OFF = "#333";
      const paint = (on) => {
        button.style.color = on ? ON : OFF;
        button.style.background = on ? "rgba(11,107,79,0.12)" : "";
      };
      paint(false);
      button.addEventListener("click", () => {
        const on = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(on));
        paint(on);
        onChange(on);
      });
      box.appendChild(button);
      return box;
    },
    onRemove() {
      if (button) button.remove();
    },
  };
}

/**
 * A map in `container`, once the library has arrived.
 *
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {boolean} [opts.globe]      globe projection instead of flat
 * @param {boolean} [opts.satellite]  offer a map/satellite toggle
 * @param {[number, number]} [opts.center]  [lon, lat] - MapLibre's order, which is not the order
 *                                          anybody says a coordinate out loud in
 * @param {number} [opts.zoom]
 * @returns {Promise<object>} the MapLibre map, with `.flyTo`/`.jumpTo` as usual
 *
 * Throws if the library cannot be loaded. Callers are expected to catch and say so on the page:
 * a map is an addition to every page that has one, never the thing the page is for.
 */
export async function createMap(container, {
  globe = false, center = [0, 0], zoom = 1, satellite = false,
} = {}) {
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
  // Declared before the control that closes over it. The assignment only happens on a click, so
  // the later `let` would have been safe - but a reader should not have to work that out.
  let showing = "map";
  if (satellite) {
    map.addControl(basemapToggle((on) => {
      showing = on ? "satellite" : "map";
      // setStyle throws away every source and layer the caller added, which is exactly what a
      // theme change already does - so the caller's style.load handler puts them back over the
      // new basemap and there is nothing to coordinate here.
      map.setStyle(on ? SATELLITE : STYLE[theme]);
    }), "top-right");
  }

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
  // **Which basemap is showing, so the theme observer does not undo the toggle.** Re-inking is
  // the right answer for two palettes of one cartography and the wrong answer for a photograph:
  // without this, turning satellite on and then switching theme silently put the vector map back,
  // and the button would have gone on claiming otherwise.
  //
  // **What this knowingly leaves stale.** A caller's own layers are re-inked in its `style.load`
  // handler, and refusing to setStyle means no style.load fires - so with satellite showing, a
  // theme change leaves the dots and the circuit outline in the previous theme's palette until
  // the button is pressed again. Seen rather than missed: it is cosmetic, it heals itself on the
  // next toggle, and the outline and its casing go stale together so the contrast argument they
  // were built for is unaffected. Closing it would need a re-ink hook this file does not have and
  // one caller would use.
  const watch = new MutationObserver(() => {
    const next = isDark() ? "dark" : "light";
    if (next === theme) return;
    theme = next;
    if (showing === "map") map.setStyle(STYLE[theme]);
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
