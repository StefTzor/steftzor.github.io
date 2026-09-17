import { api, profile } from "./shell.js";
import { inWords, shortStop, towardsOf } from "./stop-format.js";
import { remember } from "./rows.js";
import { createMap, goTo } from "./map.js";

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

  el("board-heading").textContent = shortStop(data.stop) || "This stop";
  el("trAge").textContent = data.stale ? "last known" : "";

  const operator = data.departures.map((d) => d.operator).find(Boolean);
  const badge = el("trOperator");
  badge.textContent = operator || "";
  // `invisible`, not `hidden`: the badge holds its box from the first paint, so revealing
  // it adds no width and wraps nothing. display:none would give the space back and put
  // the shift right back in.
  badge.classList.toggle("invisible", !operator);

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

    li.append(line, where, right);
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
 * There are no lines on it, deliberately. ResRobot's departure board carries no geometry and no
 * stop sequence, so a line from this stop towards a destination would be a straight line across
 * whatever is actually in between - a claim about a path the bus does not take. "Lines on this
 * board" above is the honest version of that question.
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

// The board is what this page is for and it is already on screen, so a map that will not load is
// a sentence rather than a hole where a map was going to be.
const FAILED = "The map could not be loaded. Everything above it is unaffected.";

function mapNote(text) { el("trMapNote").textContent = text || ""; }

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

/** What the picture underneath is of. It never claims a dot that is not drawn. */
function caption() {
  mapNote(around.length
    ? `This stop, and the ${around.length} nearest to you. The distances are in the list below.`
    : "This stop. Change stop, then Near me, puts the stops around you on it as well.");
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
  if (points.length < 2) return;

  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  map.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    {
      padding: 48,
      // Or two stops a few metres apart would zoom to the pavement between them.
      maxZoom: ZOOM,
      // Pressing Near me asked for this, so the movement is not unprovoked - but somebody who has
      // asked not to be moved still means it.
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
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
      pickNote(stops.length ? "" : "No stops within a kilometre and a half.");

      const list = el("trNearList");
      list.textContent = "";
      stops.forEach((stop) => {
        const li = document.createElement("li");
        li.className = "card py-2";
        li.appendChild(stopButton(stop, choose));
        list.appendChild(li);
      });
      el("trNearby").classList.toggle("hidden", !stops.length);

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

  el("trPicker").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = el("trSearch").value.trim();
    if (!q) return;
    pickNote("Searching…");
    try {
      const { stops } = await api("/departures/stops?q=" + encodeURIComponent(q));
      renderResults(stops);
    } catch (err) {
      console.error("transit: search failed", err.status, err.code);
      pickNote("The search could not be run.");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - fetchedAt > STALE_AFTER_MS) load();
  });

  load();
});
