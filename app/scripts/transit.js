import { api, profile } from "./shell.js";
import { liveSearch } from "./stop-search.js";
import { inWords, shortStop, towardsOf } from "./stop-format.js";
import { remember } from "./rows.js";
import { createMap, goTo, homeTo } from "./map.js";

/**
 * The full board for one stop: departures, arrivals, what lines turn up, and what else is
 * nearby.
 *
 * The card on the home view answers "should I leave now". This page answers the rest, which is
 * why it shows clock times as well as countdowns - a countdown is the right answer at the door
 * and the wrong one when you are planning the afternoon.
 *
 * Like that card, it does NOT poll. The deployment shares 100 requests per 15 minutes and the
 * API caches each board for 45 seconds; a timer here would spend that allowance on a tab nobody
 * is looking at. It loads once, refreshes on return to a stale tab, and refreshes when asked.
 *
 * The stop is the profile's stop, the same one the home card reads. Changing it here changes it
 * there, and the copy on the page says so rather than leaving it to be discovered.
 */

const el = (id) => document.getElementById(id);
const STALE_AFTER_MS = 2 * 60 * 1000;

let arrivals = false;
let fetchedAt = 0;

function say(text, tone) {
  const box = el("status");
  box.textContent = text || "";
  box.className = "mb-6 text-sm " + (tone === "error" ? "text-red-700 dark:text-red-400" : "text-brand-muted");
}

/** "14:32", from ResRobot's "14:32:00". Trimmed rather than parsed: it is already local. */
function clock(time) {
  return String(time || "").slice(0, 5);
}

// --- the board ----------------------------------------------------------------

function renderBoard(data) {
  const list = el("trList");
  list.textContent = "";
  list.removeAttribute("aria-busy");

  // A rebuilt board is a new list of departures, so whatever was chosen on the old one goes with
  // it: after a refresh the third row is a different bus from the one that was there, and keeping
  // the selection would leave the map drawing a journey nobody had asked for twice.
  unpick();

  el("board-heading").textContent = shortStop(data.stop) || "This stop";

  // The operator, reported by the board rather than written here - point this at a stop in Skane
  // and it stops saying UL. It used to be a badge beside the heading, which forced an empty
  // reserved box from first paint so its arrival would not wrap the title; that box was the gap.
  //
  // **It leads this line here and follows one on the home card**, so the separator belongs to
  // whichever of them is second, not to the operator. Written the other way round it rendered
  // an orphan middot with nothing to its left - and, on a stale board, `· ULlast known`, because
  // `trAge` had never needed a separator of its own when it was the only text in the line.
  const operator = data.departures.map((d) => d.operator).find(Boolean);
  el("trOperator").textContent = operator || "";
  el("trAge").textContent = data.stale ? (operator ? " · last known" : "last known") : "";

  if (!data.departures.length) {
    el("trNote").textContent = arrivals
      ? "Nothing arriving in the next hour."
      : "Nothing leaving in the next hour.";
    renderLines([]);
    return;
  }
  el("trNote").textContent = "";

  data.departures.forEach((d) => {
    const li = document.createElement("li");
    li.className = "board-row";

    // The whole row is the button, because the row is what somebody is already pointing at - a
    // separate "show this one" control in each row would be twelve more tab stops for one map.
    // A real button and not a click handler on the <li>: this has to be reachable by keyboard,
    // and everything that makes that true - the tab stop, Enter and Space, the focus ring, being
    // announced as a pressed button - is what the element gives for free.
    //
    // It sits INSIDE the <li> rather than replacing it because `.board-row` carries `first:pt-0
    // last:pb-0`, which are rules about position in the list. On an only child they would match
    // every row and flatten the whole board. The <li> keeps the padding; the button re-declares
    // the three columns and spans them, and `-mx-2 px-2` lets the pressed tint reach past the
    // text without moving a single column.
    const row = document.createElement("button");
    row.type = "button";
    row.className = "col-span-3 -mx-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 " +
      "rounded px-2 text-left hover:bg-brand-bg aria-[pressed=true]:bg-brand-accent/10";
    row.setAttribute("aria-pressed", "false");
    row.addEventListener("click", () => pick(row, d));

    const line = document.createElement("span");
    line.className = "dep-line";
    line.textContent = d.line;

    const where = document.createElement("span");
    where.className = "min-w-0";
    const name = document.createElement("span");
    name.className = "block truncate text-sm text-brand-text";
    name.textContent = towardsOf(d.towards);
    where.appendChild(name);

    // The scheduled time, and the real one when they differ. Both, rather than the later of the
    // two: a bus that is eight minutes late is a different fact from a bus that leaves at 14:40,
    // and only one of them tells you whether to run.
    const sub = document.createElement("span");
    sub.className = "block text-xs text-brand-muted tabular-nums";
    const parts = [`${arrivals ? "Due" : "Scheduled"} ${clock(d.scheduledAt)}`];
    if (d.category) parts.push(d.category);
    sub.textContent = parts.join(" · ");
    where.appendChild(sub);

    const right = document.createElement("span");
    right.className = "flex shrink-0 items-center gap-2";

    if (d.delayMinutes > 0) {
      const late = document.createElement("span");
      late.className = "text-xs font-semibold text-amber-700 dark:text-amber-300";
      late.textContent = `${d.delayMinutes} late`;
      right.appendChild(late);
    }
    if (d.cancelled) {
      const off = document.createElement("span");
      off.className = "text-xs font-semibold text-red-700 dark:text-red-300";
      off.textContent = "cancelled";
      right.appendChild(off);
    }

    const when = document.createElement("span");
    when.className = "w-16 text-right text-sm font-semibold tabular-nums text-brand-text";
    when.textContent = inWords(d.inMinutes);
    right.appendChild(when);

    row.append(line, where, right);
    li.appendChild(row);
    list.appendChild(li);
  });

  renderLines(data.departures);
  // Twelve at eight in the morning, eight at half past ten at night. This is the number
  // the markup could not know.
  remember("trList", data.departures.length);
}

/**
 * Every line on the board, with where it goes.
 *
 * Built from what was just fetched rather than asked for separately: ResRobot has no "which
 * lines serve this stop" call, and inventing the answer from a timetable this does not have
 * would be the sort of plausible-looking panel nobody can check. A Map keyed by line, and a Set
 * per line, because the same bus appears on the board three times in an hour.
 */
function renderLines(rows) {
  const list = el("trLines");
  list.textContent = "";
  list.removeAttribute("aria-busy");

  el("trLinesNote").textContent = arrivals
    ? "Every line due in the next hour, and where each one is coming from."
    : "Every line due in the next hour, and where each one is headed.";

  const byLine = new Map();
  rows.forEach((d) => {
    if (!byLine.has(d.line)) byLine.set(d.line, new Set());
    const where = towardsOf(d.towards);
    if (where) byLine.get(d.line).add(where);
  });

  if (!byLine.size) {
    const li = document.createElement("li");
    li.className = "text-sm text-brand-muted";
    li.textContent = "Nothing on the board to summarise.";
    list.appendChild(li);
    return;
  }

  remember("trLines", byLine.size);

  [...byLine.entries()]
    // Numerically where the line is a number, alphabetically where it is not: "2" before "11"
    // before "801", and a replacement service called "X" after all of them.
    .sort((a, b) => (Number(a[0]) || Infinity) - (Number(b[0]) || Infinity) || a[0].localeCompare(b[0]))
    .forEach(([line, wheres]) => {
      const li = document.createElement("li");
      li.className = "card flex items-start gap-3 py-3";

      const badge = document.createElement("span");
      badge.className = "dep-line mt-0.5";
      badge.textContent = line;

      const text = document.createElement("span");
      text.className = "min-w-0 text-sm text-brand-text";
      text.textContent = [...wheres].join(" · ");

      li.append(badge, text);
      list.appendChild(li);
    });
}

// --- the map ------------------------------------------------------------------

/**
 * The stop, as a place.
 *
 * Drawn after the board and never before it. MapLibre is bigger than the rest of this app put
 * together, and a departure board that waited on a map library before showing the next bus would
 * have the priorities backwards - so showMap() is called from load() once renderBoard() has
 * finished, and is never awaited by anything the board depends on. Every way it can fail ends in
 * a sentence where the map would have been, with everything above it untouched.
 *
 * The board carries the stops each row calls at on the far side of this one - ahead of it on a
 * departures board, behind it on an arrivals board - in order, so choosing a row puts that
 * sequence on the map. The ORDER is real data; the shape of the leg between two stops is not -
 * ResRobot sends no geometry - so what is drawn is a dashed chord and the note under the map says
 * in words that it is not the road. See drawRoute().
 */

// Close enough to see which corner of which street the stop is on, wide enough that the next
// stop along is usually on screen with it.
const ZOOM = 15;

// map.js keeps MapLibre off the critical path and hands back a Map; it deliberately re-exports
// nothing else, so the one other class this page needs comes from a second import of the same
// module. By the time anything here asks, the module registry has already resolved it - this
// costs a promise, not a second 300 KB download.
const marker = () => import("/vendor/maplibre-gl.mjs").then((m) => m.Marker);

let map = null;
let here = null;     // the single marker for the stop on the board, moved rather than replaced
let around = [];     // a marker per nearby stop, once this browser has said where it is
let nearby = [];     // and the stops themselves, for a "Near me" that beat the board back
let at = null;       // the centre currently drawn, so a refresh is told apart from a new stop
let drawing = false; // a createMap() in flight, so a refresh underneath it cannot start a second
let want = null;     // the newest board, which gets the last word if the stop changed mid-import
let blocked = false; // the library refused once, so it is missing or blocked rather than slow
let picked = null;   // the chosen departure itself, so a rebuilt board cannot match it by index
let route = [];      // its stops as [lon, lat] in call order, already down to the placeable ones

// The board is what this page is for and it is already on screen, so a map that will not load is
// a sentence rather than a hole where a map was going to be.
const FAILED = "The map could not be loaded. Everything above it is unaffected.";

function mapNote(text) { el("trMapNote").textContent = text || ""; }

/**
 * What pressing a row on the board just did to the picture.
 *
 * Its own element, and a polite live region, which the caption above deliberately is not: that
 * one is rewritten on every board load, mostly with the sentence it already had, and three
 * announcements a refresh is how a live region stops being listened to. This one changes only
 * when somebody presses a row - and the thing it changes with is a canvas full of dots, which
 * says nothing whatever to a screen reader. Without it the route is a picture with no description.
 */
function routeNote(text) { el("trRouteNote").textContent = text || ""; }

/**
 * Both are attributes rather than markup, so a stop name from an upstream stays text.
 *
 * `role="img"` is what makes the aria-label real. MapLibre sets a role on its OWN default marker
 * and returns early for a custom element, so without this these are plain divs - and an aria-label
 * on a generic element is not exposed at all, which is worse than no label because the code reads
 * as though it has one.
 */
function nameDot(node, text) {
  node.title = text;
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", text);
}

/**
 * A dot.
 *
 * Tailwind classes on an element of our own rather than MapLibre's `color` option, which takes a
 * fixed string: the accent is Emerald 800 in light and Emerald 500 in dark, so a colour read once
 * at draw time would still be the light one on the dark basemap after a theme toggle. A class
 * follows the theme for nothing, the same way the basemap under it does.
 */
function dot(classes, label) {
  const node = document.createElement("div");
  node.className = classes;
  nameDot(node, label);
  return node;
}

/**
 * What the picture underneath is of. It never claims a dot, or a line, that is not drawn.
 *
 * The one writer of these notes that describes a map, rather than explaining the absence of one:
 * showMap() writes the no-coordinate and could-not-load sentences, and those are better answers
 * than anything composable from state here, so a hidden or unbuilt map is left holding its own
 * reason rather than having it painted over with a description of nothing.
 *
 * It writes two elements rather than one, and the split is about what gets announced aloud: the
 * board-load half goes in the quiet caption, the pressed-row half in the live one. See routeNote().
 *
 * **Every sentence below turns round with the board.** On an arrivals board ResRobot's passlist is
 * where the vehicle has BEEN, not where it is going, so a caption saying "after this one" over a
 * line of stops the bus left twenty minutes ago is simply false - and this page does not get to
 * say a thing the data underneath it does not say. renderLines() already flips its own wording on
 * the same flag; this is that, applied to the picture.
 */
function caption() {
  if (!map || el("trMap").classList.contains("hidden")) return;

  mapNote(around.length
    ? `This stop, and the ${around.length} nearest to you. The distances are in the list below.`
    : "This stop. Change stop, then Near me, puts the stops around you on it as well.");

  // **The unpicked state names the action.** The route drawing shipped working and undiscovered:
  // nothing on the map said a departure could be pressed, the hint lived in the section's
  // description two paragraphs up, and there is no hover on a phone to suggest a row is a
  // button. Saying it here puts it where somebody is already looking - and it says it only while
  // nothing is picked, so it disappears the moment it has been acted on.
  //
  // **Board-agnostic, deliberately.** Every other sentence in this function turns round with the
  // board because each makes a claim about direction, and on an arrivals board the passlist is
  // where the vehicle has BEEN. "Press a departure to see where it goes" would be the exact
  // falsehood the rest of this function exists to avoid. A sentence that names no direction does
  // not need a second branch to keep it true.
  if (!picked) {
    return routeNote(el("trList").querySelector("button[aria-pressed]")
      ? "Press a row on the board above to see its route."
      : "");
  }

  // The same name the row shows, so the sentence and the row somebody just pressed agree. Both
  // halves are filtered because a board row can arrive without a destination on it, and the word
  // between them follows the board, because an arrival's `towards` is where the bus came FROM.
  const name = [picked.line, towardsOf(picked.towards)]
    .filter(Boolean).join(arrivals ? " from " : " towards ");

  // Three different facts, so three different numbers, and only one of them is a claim about the
  // timetable. `stopCount` is how many stops the line actually calls at; `stops` is how many the
  // API sent, which is capped; `route` is how many of those had a position to draw. Reading the
  // count off the array states the CAP as a fact - a forty-five stop trip would be described as
  // calling at twenty - which is the same shape of falsehood as captioning an arrival's route as
  // the way ahead, arriving by a different road.
  const sent = (picked.stops || []).length;
  const all = Number.isFinite(picked.stopCount) ? picked.stopCount : sent;
  const drawn = route.length;
  // Said only when the list was actually shortened, so the ordinary case stays one clean sentence.
  const capped = all > sent ? ` The map shows the nearest ${sent}.` : "";

  // Three outcomes and three different sentences. "Nothing is drawn" and "the stops are known
  // but none of them could be placed" are not the same fact, and a single vague sentence
  // covering both would be this page guessing on the reader's behalf.
  if (!all) {
    return routeNote(arrivals
      ? `The board does not say where line ${name} called before this stop, so nothing is drawn for it.`
      : `The board does not say where line ${name} goes after this stop, so nothing is drawn for it.`);
  }

  const calls = arrivals
    ? `Line ${name} called at ${all} stop${all === 1 ? "" : "s"} before this one.`
    : `Line ${name} calls at ${all} more stop${all === 1 ? "" : "s"} after this one.`;

  if (!drawn) {
    return routeNote(`${calls} None of them came back with a position, so none of them is on the map.`);
  }

  const dashes = arrivals
    ? "The dashes are the order it called at them, not the roads it drove: the board carries no " +
      "shape for a route, only the sequence."
    : "The dashes are the order it calls at them, not the roads it drives: the board carries no " +
      "shape for a route, only the sequence.";

  // Two different reasons a stop is not on the map, and they must not be said with one sentence.
  // A capped list is the API declining to send the rest; a missing position is the upstream not
  // knowing where a stop it DID send is. Blaming the cap on missing coordinates would be this page
  // inventing a fact about the data, which is the thing it is least allowed to do.
  const unplaced = sent - drawn;

  routeNote([
    calls,
    capped,
    unplaced > 0
      ? `${unplaced === 1 ? "One of them" : `${unplaced} of them`} came back with no position, so ` +
        `${unplaced === 1 ? "it is" : "they are"} not drawn.`
      : "",
    dashes,
  ].filter(Boolean).join(" "));
}

/** A brand token as a colour MapLibre will parse; the tokens are stored as bare RGB channels. */
function ink(token) {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${token}`).trim();
  return `rgb(${channels.split(/\s+/).join(",")})`;
}

// One GeoJSON source and two layers, the way the globe on /f1/ does it, and for the same reason:
// a line has to be drawn inside the style, and putting the stops in the same source as the line
// is what stops a dot and the line through it disagreeing about where a stop is. The two layers
// are told apart by geometry rather than by a flag, because that is what actually distinguishes
// them.
const ROUTE = "route";
const ROUTE_LINE = "route-line";
const ROUTE_STOPS = "route-stops";

/** The line, from the stop being watched through everywhere the chosen departure calls next. */
function routeShape() {
  const features = route.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: point },
    properties: {},
  }));
  // Anchored at the stop itself, because the path has to meet the marker it belongs to - a
  // sequence that began at the NEXT stop would float away from it. `here` is the source of that
  // coordinate rather than a second copy of it, so the two cannot drift.
  //
  // WHICH END it is anchored at is the difference between the two boards, and it is the whole of
  // that difference. A departure's stops are where the vehicle is going, so the path leaves this
  // stop; an arrival's are where it has already been, so the path arrives at it. Anchored the
  // departure way on an arrivals board, the first segment ran backwards in time: out of this stop
  // and into one the bus had called at twenty minutes before it got here.
  const from = here && here.getLngLat().toArray();
  const path = !from ? route : arrivals ? [...route, from] : [from, ...route];
  if (path.length > 1) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: path }, properties: {} });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Put the chosen departure on the map, and put it back after a theme change.
 *
 * map.js re-inks the basemap by calling setStyle, and a style carries its own sources and layers,
 * so everything added here is thrown away every time the theme is toggled. Re-adding on
 * `style.load` covers that; the direct call from showMap() covers the first draw, because
 * createMap() waits for the initial `style.load` before handing the map back and that one is
 * therefore never coming again. The same lesson the globe on /f1/ is commented with.
 *
 * Re-reading the tokens on each of those re-adds is also what keeps the route in the palette it
 * is drawn on. A layer takes a colour string rather than a class, so unlike the dots above it
 * cannot follow the theme by itself - but it is rebuilt at exactly the moment the theme changes,
 * which comes to the same thing.
 *
 * Existing source means an existing style, so the data is swapped rather than the layers rebuilt.
 */
function drawRoute() {
  if (!map) return;
  const data = routeShape();
  const source = map.getSource(ROUTE);
  if (source) return source.setData(data);

  try {
    map.addSource(ROUTE, { type: "geojson", data });
    map.addLayer({
      id: ROUTE_LINE,
      type: "line",
      source: ROUTE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      // **Dashed, and that is the whole argument.** A solid line between two places on a map is
      // read as a road, and this one is not a road - it is a chord across whatever the bus
      // actually drives around. A dash is the cartographic word for "the ends are known and the
      // middle is not", which is exactly what the board gave us. The note underneath says it in
      // English as well, because a convention is not a sentence.
      paint: {
        "line-color": ink("accent"),
        "line-width": 3,
        "line-dasharray": [2, 1.5],
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: ROUTE_STOPS,
      type: "circle",
      source: ROUTE,
      filter: ["==", ["geometry-type"], "Point"],
      // Smaller than the stop's own marker and ringed, for the reason every dot on every map here
      // is ringed: at this size a bare dot disappears into whatever is underneath it.
      //
      // The ring is the page's background and not the card's, and that is a measurement rather
      // than a preference. The vendored dark basemap paints water #1e293b, which is
      // --color-surface in dark mode to the byte, so a surface ring was precisely the colour of
      // the thing it was supposed to separate the dot from and vanished on every dot over water -
      // the one case its comment named. --color-bg is a step darker than that water and than the
      // land beside it, which reads as an edge the same way the border token does at 1.7:1, and
      // in light mode it is the tinted page against positron's paler ground.
      paint: {
        "circle-radius": 5,
        "circle-color": ink("accent"),
        "circle-stroke-width": 2,
        "circle-stroke-color": ink("bg"),
      },
    });
  } catch (err) {
    console.error("transit: the route could not be drawn", err);
    // Layers first: MapLibre refuses to remove a source a layer still points at, so the obvious
    // order leaves exactly the wreckage this is here to clear. Half-built matters more than it
    // looks - the getSource check above would keep finding the source and the style would never
    // repair itself, for the life of the page.
    try {
      [ROUTE_STOPS, ROUTE_LINE].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
      if (map.getSource(ROUTE)) map.removeSource(ROUTE);
    } catch (e) { /* nothing left to tidy */ }
  }
}

/** Widen the camera to hold a set of points, or leave it alone when there is nothing to hold. */
function fit(points) {
  if (!map || points.length < 2) return;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  // Through homeTo, like every goTo on this page, so the Reset button goes back to the route or
  // the cluster of nearby stops rather than to the last thing that happened to be a single point.
  homeTo(map, () => map.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    {
      padding: 48,
      // Or two stops a few metres apart would zoom to the pavement between them.
      maxZoom: ZOOM,
      // Pressing a row or Near me asked for this, so the movement is not unprovoked - but
      // somebody who has asked not to be moved still means it.
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    }));
}

/** Forget the chosen departure without touching the board, which is being rebuilt around it. */
function unpick() {
  picked = null;
  route = [];
  // The description of the picture goes with the choice it described, rather than being left
  // under a board it no longer belongs to.
  routeNote("");
  drawRoute();
}

/**
 * Choose a departure from the board, or press the chosen one again to put the map back.
 *
 * Matched by identity rather than by index: the row objects come straight from the response the
 * board was drawn from, so there is nothing to keep in step and nothing to go stale.
 */
function pick(row, departure) {
  // Every line below this either moves the map or describes it. With no map and none on its way,
  // the row would show itself as pressed and then nothing whatever would happen - so it does not
  // show itself as pressed. The caption under the map already says WHICH of the two reasons there
  // is no map, and is left alone to say it; this says what the press did, which is nothing.
  //
  // `drawing` is the one case that has to be let through. MapLibre takes longer to arrive than the
  // board does, and a row pressed in that second is a real choice: drawRoute() runs again the
  // moment the map lands, and caption() with it, so the choice is honoured rather than refused.
  if (!drawing && (!map || el("trMap").classList.contains("hidden"))) {
    routeNote("There is no map on this page to draw that route on.");
    return;
  }

  const same = picked === departure;
  picked = same ? null : departure;

  // `stops` may be absent entirely, and a stop ResRobot could not place comes back with no lat
  // and no lon keys rather than null ones - so this asks whether they are finite, never whether
  // they are truthy: latitude 0 is the equator, and it is a real place a coordinate can be at.
  route = ((picked && picked.stops) || [])
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => [s.lon, s.lat]);

  // The board is one control with twelve states rather than twelve independent toggles, so the
  // row being pressed is also the eleven rows being released.
  el("trList").querySelectorAll("button[aria-pressed]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b === row && !same)));

  drawRoute();

  const home = here && here.getLngLat().toArray();
  // Whatever is on the map now: the route if one was just drawn, the stops around you if that is
  // all there is, and failing both the stop on its own - which is the view this map is of, and
  // where releasing a row should put it back.
  const frame = route.length && home ? [home, ...route]
    : around.length ? [...around.map((m) => m.getLngLat().toArray()), home].filter(Boolean)
    : [];
  if (frame.length > 1) fit(frame);
  else if (home) goTo(map, home, ZOOM);

  caption();
}

/**
 * A different stop: move the map, move its marker, and drop the dots that were around the old one.
 *
 * Those were found around YOU rather than around the stop, for the purpose of choosing one. Once
 * one is chosen the map is a picture of it, and keeping them would caption a picture of one place
 * with a count belonging to another.
 */
function moveTo(center, label) {
  around.forEach((m) => m.remove());
  around = [];
  nearby = [];
  goTo(map, center, ZOOM);
  if (here) {
    here.setLngLat(center);
    nameDot(here.getElement(), label);
  }
  caption();
}

async function showMap(data) {
  const box = el("trMap");
  if (!box) return;
  want = data;
  const label = shortStop(data.stop) || "This stop";

  // [lon, lat] - MapLibre's order, which is the reverse of the order anybody says a coordinate
  // out loud in. The API leaves both keys ABSENT rather than null when the coordinate did not
  // resolve, so this asks whether they are finite rather than whether they are there: latitude 0
  // is the equator and a perfectly good value, and 0,0 is a real place in the Gulf of Guinea that
  // no bus stop in this app is at.
  const center = [data.lon, data.lat];
  if (!center.every(Number.isFinite)) {
    box.classList.add("hidden");
    // A dashboard does not invent what it was not given, and an empty ocean at 0,0 is the
    // invented version of this.
    mapNote("There is no coordinate for this stop, so there is no map of it.");
    return;
  }

  // Asked once and refused. Trying again on every refresh and on every board toggle would only
  // rewrite this sentence over itself every two minutes for a library that is not coming.
  if (blocked) {
    box.classList.add("hidden");
    mapNote(FAILED);
    return;
  }

  box.classList.remove("hidden");
  const key = center.join(",");

  if (map) {
    // The box may have been hidden since the map was built, by a stop that had no coordinate,
    // and MapLibre measures its container when it is told to and not otherwise.
    map.resize();
    if (key !== at) {
      at = key;
      moveTo(center, label);
    } else {
      // The same stop as last time, so nothing moves - but the note underneath may still be the
      // one a DIFFERENT stop left behind. Coming back to a stop that has a coordinate, from one
      // that did not, showed the map again under "There is no coordinate for this stop". The
      // caption belongs to whether a map is visible, not to whether it just changed.
      caption();
    }
    return;
  }
  if (drawing) return;

  drawing = true;
  mapNote("Drawing the map…");
  try {
    map = await createMap(box, { center, zoom: ZOOM });
    const Marker = await marker();
    here = new Marker({
      element: dot("h-4 w-4 rounded-full border-2 border-brand-surface bg-brand-accent", label),
    }).setLngLat(center).addTo(map);
    at = key;
    // See drawRoute(): `style.load` re-adds the route after every theme change, and the direct
    // call is the first draw, because the initial one has already been and gone inside createMap.
    // Anyone who chose a departure while the library was still arriving is drawn by this too.
    map.on("style.load", drawRoute);
    drawRoute();
    // Anyone who asked for nearby stops before the board came back has them waiting here; with
    // nothing waiting this is just the caption.
    await drawNearby(nearby);
  } catch (err) {
    console.error("transit: the map could not be drawn", err);
    blocked = true;
    box.classList.add("hidden");
    mapNote(FAILED);
  } finally {
    drawing = false;
    // The stop changed while the library was in the air: that board was turned away by the guard
    // above, and the map it would have drawn was built around a board that is no longer showing.
    if (want !== data) showMap(want);
  }
}

/**
 * The stops around this browser, as dots on the same map.
 *
 * Drawn from the response the list beside it is drawn from, so the two cannot disagree. The list
 * stays rather than being replaced by this: it carries the distance in metres, and "how far away
 * is it" is a question a number answers better than a picture.
 */
async function drawNearby(stops) {
  around.forEach((m) => m.remove());
  around = [];
  // Not just "is there a map" but "is it being shown". A board whose stop has no coordinate hides
  // the box and keeps the map object; without this, sharing a location then wrote "This stop, and
  // the 6 nearest to you" underneath a map nobody could see.
  if (!map || el("trMap").classList.contains("hidden")) return;

  const Marker = await marker();
  around = stops
    // Same rule as the board's own coordinate: absent rather than null, so finite rather than
    // truthy. A stop ResRobot could not place is in the list with its distance and not on the map.
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => new Marker({
      element: dot("h-3 w-3 rounded-full border-2 border-brand-surface bg-brand-muted", shortStop(s.name)),
    }).setLngLat([s.lon, s.lat]).addTo(map));
  caption();

  // Widen to hold what was just drawn AND the stop itself. These stops are near YOU, so somebody
  // watching a stop on the other side of town would otherwise be told there are four of them and
  // shown none of them.
  const points = around.map((m) => m.getLngLat().toArray());
  if (here) points.push(here.getLngLat().toArray());
  fit(points);
}

async function load(button) {
  if (button) button.disabled = true;
  say("Loading the board…");
  try {
    const data = await api("/departures" + (arrivals ? "?arrivals=1" : ""));
    fetchedAt = Date.now();
    say("");
    renderBoard(data);
    // Not awaited. The map is an addition to this page, and Refresh must come back the moment
    // the board does rather than when a 300 KB library has finished arriving.
    showMap(data);
  } catch (err) {
    console.error("transit:", err.status, err.code);
    // Both lists are filled by renderBoard() and by nothing else, so a first load that never
    // reaches it leaves placeholders pulsing under the error - content that reads as still
    // arriving, above a sentence saying it never will.
    //
    // Only content that never arrived, though. load() also runs on the Departures/Arrivals
    // toggle, on Refresh, and unasked on returning to the tab; clearing unconditionally would
    // wipe twelve real departures because an unattended refresh hit a 429. Stale numbers under a
    // sentence saying so beat an empty card, which is the rule departures.js already states.
    //
    // Each list is asked about its OWN aria-busy rather than one standing in for both: they are
    // released at different points in renderBoard(), so a throw between them leaves one cleared
    // and the other not, and a shared flag would then answer for the wrong element.
    ["trList", "trLines"].forEach((id) => {
      const box = el(id);
      if (!box.hasAttribute("aria-busy")) return;
      box.textContent = "";
      box.removeAttribute("aria-busy");
    });
    say(err.code === "no_such_stop" ? "That stop could not be found."
      : err.code === "not_configured" ? "This deployment has no transit key."
      : "The board could not be loaded.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// --- choosing a stop ----------------------------------------------------------

function pickNote(text) { el("trPickNote").textContent = text || ""; }

/** One stop, as a button. `distance` is only there for the nearby list. */
function stopButton(stop, onPick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg";
  const name = document.createElement("span");
  name.className = "min-w-0 truncate";
  name.textContent = shortStop(stop.name);
  btn.appendChild(name);
  if (Number.isFinite(stop.distance)) {
    const far = document.createElement("span");
    far.className = "shrink-0 text-xs text-brand-muted tabular-nums";
    far.textContent = `${stop.distance} m`;
    btn.appendChild(far);
  }
  btn.addEventListener("click", () => onPick(stop));
  return btn;
}

function renderResults(stops) {
  const list = el("trResults");
  list.textContent = "";
  if (!stops.length) { pickNote("No stop matches that."); return; }
  pickNote("");
  stops.forEach((stop) => {
    const li = document.createElement("li");
    li.appendChild(stopButton(stop, choose));
    list.appendChild(li);
  });
}

/** Saved to the profile, not to this browser: the board is drawn from the profile on the server. */
async function choose(stop) {
  pickNote("Saving…");
  try {
    await api("/me/profile", {
      method: "POST",
      body: JSON.stringify({ homeStop: { id: stop.id, name: stop.name } }),
    });
    closePicker();
    await load();
  } catch (err) {
    console.error("transit: could not save the stop", err.status, err.code);
    pickNote(err.code === "bad_stop" ? "That stop could not be saved." : "That could not be saved.");
  }
}

/**
 * Stops around where you are standing.
 *
 * The browser asks before answering, and the asking is the reason this is a button rather than
 * something the page does on load: a permission prompt that appears without being provoked is
 * the one people click Block on, and Block is remembered.
 */
function near() {
  if (!navigator.geolocation) { pickNote("This browser cannot share a location."); return; }
  pickNote("Asking this browser where you are…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    pickNote("Looking for stops…");
    try {
      const { latitude, longitude } = pos.coords;
      const { stops } = await api(`/departures/nearby?lat=${latitude}&lon=${longitude}`);
      // Never the empty string on success. This note is the only thing in view when the button is
      // pressed, and blanking it was the page's way of saying nothing happened.
      pickNote(stops.length
        ? `${stops.length} stop${stops.length === 1 ? "" : "s"} near you, listed below.`
        : "No stops within a kilometre and a half.");

      const list = el("trNearList");
      list.textContent = "";
      stops.forEach((stop) => {
        const li = document.createElement("li");
        li.className = "card py-2";
        li.appendChild(stopButton(stop, choose));
        list.appendChild(li);
      });
      el("trNearby").classList.toggle("hidden", !stops.length);

      /**
       * Go to the list that was just filled.
       *
       * **"Stops near you" is at the bottom of the page and the button that fills it is at the
       * top.** The board, the lines and a 28rem map sit in between, so on a phone this shipped as
       * a button that did nothing whatsoever: the note cleared, the picker stayed open, and the
       * answer arrived three screens below the fold. Filling a list is not telling anyone about
       * it, and the list is where it is for a good reason - it carries distances and sits beside
       * the map plotting the same stops - so the reader is moved to it rather than it to them.
       *
       * Focus and not only a scroll, because the answer is a list of buttons and a button is what
       * was pressed to get it: the keyboard and the screen reader have to arrive as well.
       *
       * Instant rather than smooth, and so no prefers-reduced-motion branch: three screens of
       * animated scrolling is exactly the motion that setting exists to refuse, and nothing here
       * is worth watching on the way past. `preventScroll` so the focus does not then scroll a
       * second time to a different place than the one just chosen.
       */
      const first = list.querySelector("button");
      if (first) {
        el("trNearby").scrollIntoView({ block: "start" });
        first.focus({ preventScroll: true });
      }

      // The same stops as dots, best effort. The list above is already right and does not depend
      // on this; a map that could not be drawn has already said so underneath itself.
      nearby = stops;
      drawNearby(stops).catch((err) => console.error("transit: nearby markers", err));
    } catch (err) {
      console.error("transit: nearby failed", err.status, err.code);
      pickNote("Nearby stops could not be loaded.");
    }
  }, (err) => {
    // Refusing is a choice, not a failure, and is worth a different sentence from a GPS that
    // could not get a fix.
    console.error("transit: geolocation", err.code);
    pickNote(err.code === err.PERMISSION_DENIED
      ? "This browser is not sharing your location. Search by name instead."
      : "Your location could not be worked out. Search by name instead.");
  }, { timeout: 10000, maximumAge: 5 * 60 * 1000 });
}

function openPicker() {
  el("trPicker").classList.remove("hidden");
  el("trResults").textContent = "";
  pickNote("");
  el("trSearch").focus();
}

function closePicker() {
  el("trPicker").classList.add("hidden");
  el("trSearch").value = "";
  el("trChange").focus();
}

function setBoard(wantArrivals) {
  if (arrivals === wantArrivals) return;
  arrivals = wantArrivals;
  el("trDep").setAttribute("aria-pressed", String(!arrivals));
  el("trArr").setAttribute("aria-pressed", String(arrivals));
  // Dropped here rather than in renderBoard, because `arrivals` changes on this line and the
  // selection belongs to the board it was made on. renderBoard is the only other place that
  // clears it, and it does not run when the load that follows fails - so a 429 or a dropped
  // connection would leave a route drawn from the departures board with `arrivals` already true,
  // which is the caption describing one direction over a picture of the other.
  unpick();
  load();
}

profile.then(() => {
  if (!el("trList")) return;

  el("trDep").addEventListener("click", () => setBoard(false));
  el("trArr").addEventListener("click", () => setBoard(true));
  el("trRefresh").addEventListener("click", (e) => load(e.currentTarget));
  el("trChange").addEventListener("click", openPicker);
  el("trCancel").addEventListener("click", closePicker);
  el("trNear").addEventListener("click", near);

  // Results as you type (stop-search.js); Enter still searches at once.
  const search = liveSearch({
    input: el("trSearch"),
    list: el("trResults"),
    fetchStops: async (q) => (await api("/departures/stops?q=" + encodeURIComponent(q))).stops,
    render: renderResults,
    note: pickNote,
  });
  el("trPicker").addEventListener("submit", (e) => {
    e.preventDefault();
    search.now();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - fetchedAt > STALE_AFTER_MS) load();
  });

  load();
});
