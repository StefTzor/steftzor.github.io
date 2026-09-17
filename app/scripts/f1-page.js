import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";
import { teamColour } from "./f1-teams.js";
import { createMap, goTo } from "./map.js";

/**
 * The Formula 1 page: pick a round, see its sessions or its results, and both championships.
 *
 * The round selector drives everything above the championships. Which of the two it shows is
 * decided by the data rather than by the choice: a round that has results shows them, one that
 * has not shows session times, and mid-weekend it shows both — qualifying is a result and the
 * race is still a time.
 *
 * createElement and textContent throughout. Driver names, team names and statuses all come from
 * an upstream nobody here controls.
 */

const RESULTS_PER_PAGE = 10;
let page = 0;
let shown = null;

/** A team's colour as a bar, never as a background behind text. */
function teamBar(constructorId) {
  const bar = document.createElement("span");
  bar.className = "inline-block h-4 w-1 shrink-0 rounded-full";
  bar.style.backgroundColor = teamColour(constructorId);
  bar.setAttribute("aria-hidden", "true");
  return bar;
}

const text = (tag, className, value) => {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = value;
  return n;
};

/** Every time is an ISO instant; the browser renders it where the reader is. */
function when(iso) {
  return new Date(iso).toLocaleString(undefined,
    { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// --- the round ---------------------------------------------------------------

function sessionList(race) {
  const list = document.createElement("ul");
  list.className = "card divide-y divide-brand-border";
  race.sessions.forEach((s) => {
    const li = document.createElement("li");
    li.className = "flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0";
    li.append(text("span", "text-sm text-brand-text", s.label),
      text("time", "shrink-0 text-sm text-brand-muted tabular-nums", when(s.at)));
    list.appendChild(li);
  });
  return list;
}

/**
 * One results table. `rows` is already in finishing order.
 *
 * `paged` is a parameter rather than something read from the module, because two tables use this
 * and only one of them pages. It used to be read from the module-level `page`, and the sprint
 * table worked around that by setting it to 0 and putting it back afterwards - which left the
 * sprint showing its first ten finishers under a pager whose buttons moved the RACE table.
 */
function resultsTable(rows, caption, paged = true) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.appendChild(text("h3", "font-semibold text-brand-text mb-3", caption));

  const list = document.createElement("ul");
  list.className = "divide-y divide-brand-border";
  const start = paged ? page * RESULTS_PER_PAGE : 0;
  (paged ? rows.slice(start, start + RESULTS_PER_PAGE) : rows).forEach((r) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-2 first:pt-0";

    // positionText, not position: a row that is not a finishing position still says what it is.
    li.appendChild(text("span", "w-6 shrink-0 text-sm font-semibold tabular-nums text-brand-muted",
      r.positionText));
    li.appendChild(teamBar(r.constructor.id));

    const who = document.createElement("span");
    who.className = "min-w-0 flex-1";
    who.appendChild(text("span", "block truncate text-sm text-brand-text", r.driver.name));
    who.appendChild(text("span", "block truncate text-xs text-brand-muted", r.constructor.name));
    li.appendChild(who);

    const meta = document.createElement("span");
    meta.className = "shrink-0 text-right";
    // The status upstream gave, unedited. "Retired" and "Lapped" are its words, and translating
    // them into DNF would be asserting something this data does not say.
    const note = r.status && r.status !== "Finished" && !r.status.startsWith("+")
      ? r.status : (r.time || "");
    meta.appendChild(text("span", "block text-sm tabular-nums text-brand-text", note));
    const gained = r.gained;
    meta.appendChild(text("span", "block text-xs tabular-nums " +
      (gained > 0 ? "text-emerald-700 dark:text-emerald-300"
        : gained < 0 ? "text-red-700 dark:text-red-400" : "text-brand-muted"),
      [r.points ? `${r.points} pts` : "", gained ? `${gained > 0 ? "+" : ""}${gained}` : ""]
        .filter(Boolean).join(" · ")));
    li.appendChild(meta);
    list.appendChild(li);
  });
  wrap.appendChild(list);

  if (paged && rows.length > RESULTS_PER_PAGE) {
    const nav = document.createElement("nav");
    nav.className = "mt-4 flex items-center justify-between gap-4";
    nav.setAttribute("aria-label", "Results pages");
    const back = text("button", "btn-secondary text-sm", "Back");
    const fwd = text("button", "btn-secondary text-sm", "More");
    back.type = "button"; fwd.type = "button";
    back.disabled = page === 0;
    fwd.disabled = start + RESULTS_PER_PAGE >= rows.length;
    back.addEventListener("click", () => { page -= 1; renderRound(shown); });
    fwd.addEventListener("click", () => { page += 1; renderRound(shown); });
    nav.append(back, text("p", "text-sm text-brand-muted tabular-nums",
      `${start + 1}–${Math.min(start + RESULTS_PER_PAGE, rows.length)} of ${rows.length}`), fwd);
    wrap.appendChild(nav);
  }
  return wrap;
}

function renderRound(data) {
  shown = data;
  const race = data.race;
  el("round-heading").textContent = `${race.round}. ${race.name}`;
  el("roundWhere").textContent = [race.locality, race.country].filter(Boolean).join(", ") +
    (race.sprint ? " · sprint weekend" : "");
  // Wrapped, and the results are built below regardless. The map is an addition to this page and
  // the results are what it is for, so a throw from the globe - a layer that is not there yet, a
  // style mid-swap - must not be able to leave somebody with a heading and an empty body.
  try { showOnMap(race); } catch (err) { console.error("f1: the globe could not be moved", err); }

  const body = el("roundBody");
  body.textContent = "";

  // Results when there are any, in the order they happened; sessions when there are none.
  // Mid-weekend both are true at once, which is the case the selector exists to make reachable.
  const blocks = [];
  if (data.qualifying) blocks.push(["Qualifying", null, data.qualifying]);
  if (data.sprintResults) blocks.push(["Sprint", "result", data.sprintResults]);
  if (data.raceResults) blocks.push(["Race", "result", data.raceResults]);

  if (!blocks.length) {
    body.appendChild(sessionList(race));
    body.appendChild(text("p", "hint mt-3",
      data.over ? "This weekend has been and gone, but no results were published for it."
        : "Nothing has run yet. Times are in your timezone."));
    return;
  }

  // The race table is the one worth paginating; the others are shown whole.
  blocks.forEach(([label, kind, rows]) => {
    if (label === "Race") {
      body.appendChild(resultsTable(rows, "Race result"));
    } else if (kind === "result") {
      body.appendChild(withSpacing(resultsTableWhole(rows, `${label} result`)));
    } else {
      body.appendChild(withSpacing(qualifyingTable(rows)));
    }
  });

  // Anything still to come keeps its time.
  const done = new Set(blocks.map(([l]) => l === "Race" ? "Race" : l));
  const remaining = race.sessions.filter((s) => !done.has(s.label) &&
    !(s.label === "Qualifying" && data.qualifying) && Date.parse(s.at) > Date.now());
  if (remaining.length) {
    const still = document.createElement("div");
    still.className = "mt-4";
    still.appendChild(text("h3", "font-semibold text-brand-text mb-2", "Still to come"));
    const list = document.createElement("ul");
    list.className = "card divide-y divide-brand-border";
    remaining.forEach((s) => {
      const li = document.createElement("li");
      li.className = "flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0";
      li.append(text("span", "text-sm text-brand-text", s.label),
        text("time", "shrink-0 text-sm text-brand-muted tabular-nums", when(s.at)));
      list.appendChild(li);
    });
    still.appendChild(list);
    body.appendChild(still);
  }
}

const withSpacing = (node) => { node.classList.add("mb-4"); return node; };

/** A sprint, shown whole: it is one short table and a second pager on the page would confuse. */
const resultsTableWhole = (rows, caption) => resultsTable(rows, caption, false);

function qualifyingTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.appendChild(text("h3", "font-semibold text-brand-text mb-3", "Qualifying"));
  const list = document.createElement("ul");
  list.className = "divide-y divide-brand-border";
  rows.slice(0, 10).forEach((r) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-2 first:pt-0";
    li.appendChild(text("span", "w-6 shrink-0 text-sm font-semibold tabular-nums text-brand-muted",
      String(r.position)));
    li.appendChild(teamBar(r.constructor.id));
    const who = document.createElement("span");
    who.className = "min-w-0 flex-1";
    who.appendChild(text("span", "block truncate text-sm text-brand-text", r.driver.name));
    who.appendChild(text("span", "block truncate text-xs text-brand-muted", r.constructor.name));
    li.appendChild(who);
    li.appendChild(text("span", "shrink-0 text-sm tabular-nums text-brand-text",
      r.q3 || r.q2 || r.q1 || ""));
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}

// --- the globe ---------------------------------------------------------------

/**
 * A globe that turns to the chosen circuit, with every round of the season on it.
 *
 * The whole of this section is written so that a MapLibre that is missing, blocked or broken
 * costs the page its globe and nothing else: the results, the sessions and the championships are
 * what the page is for and none of them is downstream of a map.
 *
 * **The markers are a GeoJSON source and two circle layers, not `maplibregl.Marker` elements.**
 * map.js deliberately does not export the library object, and a DOM marker needs it - but the
 * deeper reason is that a DOM marker is a div that has to be re-projected by hand on every frame
 * of the flight and on every frame of a drag, whereas a layer inside the style is drawn by the
 * same renderer that is already drawing the tiles. The cost is that the dots live in a canvas
 * where no screen reader can reach them, so the canvas is hidden from one outright and the round
 * selector is their text alternative; see the comment on the card in f1.njk.
 */
const SOURCE = "rounds";
const ALL = "round-dots";
const HERE = "round-chosen";

// Close enough to place a circuit in its country, far enough that the globe still reads as one.
const CIRCUIT_ZOOM = 4;

let globe = null;     // the map itself, once it exists and only if it ever does
let located = [];     // the calendar rounds that came back with a coordinate
let chosen = null;    // the round number currently shown, as a number
let target = null;    // its [lon, lat], or null when the round has no coordinate

/**
 * A round's position, or null.
 *
 * `[lon, lat]` - MapLibre's order, which is the reverse of how anyone says a coordinate out loud.
 * The API leaves both keys ABSENT rather than null when it could not resolve a circuit, so this
 * tests for a finite number: latitude 0 is the equator and 0,0 is a real place in the Gulf of
 * Guinea that no race has ever been held at.
 */
const at = (r) => (Number.isFinite(r.lat) && Number.isFinite(r.lon) ? [r.lon, r.lat] : null);

/** A brand token as a colour MapLibre will parse; the tokens are stored as bare RGB channels. */
function ink(token) {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${token}`).trim();
  return `rgb(${channels.split(/\s+/).join(",")})`;
}

/** Named for the element it writes, because `note` is already a local in resultsTable. */
function mapNote(message) {
  const n = el("mapNote");
  n.textContent = message || "";
  n.hidden = !message;
}

/**
 * Put the season on the map, and put it back after a theme change.
 *
 * map.js re-inks the basemap by calling setStyle, and a style carries its own sources and layers -
 * so everything added here is thrown away every time the theme is toggled. Listening to
 * `styledata` and re-adding what is missing covers both that and the first style load, and
 * re-reading the tokens each time is what keeps the dots in the palette they are drawn on.
 *
 * **It has to do nothing at all once the season is already there.** Every change to a style fires
 * `styledata` on the next frame, setFilter included - so a handler that reached for setFilter
 * unconditionally would filter, wake itself, filter again, and repaint for as long as the tab
 * was open. Bailing out on the source it just added is what stops that, and it is why the round
 * is re-marked from aim() rather than from here.
 */
function draw() {
  if (!globe.isStyleLoaded() || globe.getSource(SOURCE)) return;
  globe.addSource(SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: located.map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: at(r) },
        // `over` is the calendar's own answer to "has this weekend finished", the same flag the
        // round selector puts a tick against. Carried into the source so the dots can say which
        // part of the season they belong to rather than all reading as one undifferentiated set.
        properties: { round: Number(r.round), over: Boolean(r.over) },
      })),
    },
  });
  // **Three states, because a season has three.** A round that has been raced, a round still to
  // come, and the one being looked at. They used to be two - one grey dot for everything that was
  // not selected - which threw away a fact the calendar was already telling us and made the globe
  // a picture of twenty-four identical places.
  //
  // Past is muted and slightly transparent: done, and not what anyone is scanning for. Future is
  // the accent at full strength. The chosen one is `hover`, a token that exists precisely because
  // it has to stand out from `accent`, and it is nearly twice the radius - colour alone would be
  // a poor way to answer "which one am I looking at", and is no answer at all to a reader who
  // cannot separate those two hues.
  //
  // A ring of surface colour around every dot, because a bare dot disappears into a city on the
  // light basemap and into the sea on the dark one.
  globe.addLayer({
    id: ALL,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": 4.5,
      "circle-color": ["case", ["get", "over"], ink("muted"), ink("accent")],
      "circle-opacity": ["case", ["get", "over"], 0.7, 1],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": ink("surface"),
      "circle-stroke-opacity": ["case", ["get", "over"], 0.7, 1],
    },
  });
  globe.addLayer({
    id: HERE,
    type: "circle",
    source: SOURCE,
    paint: {
      "circle-radius": 8,
      "circle-color": ink("hover"),
      "circle-stroke-width": 3,
      "circle-stroke-color": ink("surface"),
    },
  });
  mark();
}

/** The chosen round is lit and drawn out of the crowd, by filtering one source into two layers. */
function mark() {
  if (!globe || !globe.getLayer(HERE)) return;
  // -1 is no round at all, which is the right answer while nothing is chosen and also the right
  // answer for a round the calendar has no coordinate for: nothing is lit, rather than the
  // previous round staying lit as though it were this one.
  const here = ["==", ["get", "round"], chosen === null ? -1 : chosen];
  globe.setFilter(ALL, ["!", here]);
  globe.setFilter(HERE, here);
}

/**
 * Turn to the chosen round, or say why the globe is not turning.
 *
 * Every path that changes the round ends here, including the one where the map finished loading
 * after the round did - so there is one description of what the globe should be showing rather
 * than one per caller. goTo does the moving: the flight is the point of the globe and it is also
 * the only motion on this page nobody asked for, so honouring prefers-reduced-motion is its job
 * and not something to reimplement with a flag.
 */
function aim() {
  if (!globe) return;  // Either still loading or gone for good; whichever, it aims when it lands.
  mark();
  if (!target) {
    return mapNote("This round came back without a location, so the globe has not turned to it.");
  }
  mapNote("");
  goTo(globe, target, CIRCUIT_ZOOM);
}

/**
 * The map card follows the chosen round. The circuit's own name is rendered nowhere else on the
 * page - the header beside it says only the locality and the country.
 */
function showOnMap(race) {
  chosen = Number(race.round);
  target = at(race);
  el("circuitName").textContent = race.circuit || "";
  aim();
}

/**
 * Build the map, once.
 *
 * Called when the calendar has arrived and the chosen round has already been rendered, rather
 * than from an IntersectionObserver: the map's content IS the calendar, so there is nothing for
 * an observer to reveal any earlier than this except an empty globe - and by this point the page
 * has already painted the round and its results, which is what it is actually for. The ~300 KB
 * import therefore never competes with the two fetches that answer the reader's question.
 */
async function startGlobe(rounds) {
  located = rounds.filter(at);
  try {
    globe = await createMap(el("f1Map"), {
      globe: true,
      center: target || [0, 0],
      zoom: target ? CIRCUIT_ZOOM : 1,
    });
  } catch (err) {
    console.error("f1: map", err);
    // An empty bordered box is a map that looks broken; say so instead and take the box away.
    el("f1Map").hidden = true;
    mapNote("The map could not be loaded. Nothing else on this page depends on it.");
    return;
  }

  // The dots are unreachable inside the canvas, so the canvas is hidden from assistive technology
  // rather than left as an unlabelled graphic - and untabbable with it, since a focus stop that
  // lands on something a screen reader has been told to ignore is the worst of both. MapLibre's
  // attribution control is a sibling of the canvas and stays reachable, which is the one part of
  // this map that has to be.
  const canvas = globe.getCanvas();
  canvas.setAttribute("aria-hidden", "true");
  canvas.tabIndex = -1;

  globe.on("styledata", draw);
  if (globe.isStyleLoaded()) draw();
  aim();
}

// --- championships -----------------------------------------------------------

function renderStandings(data) {
  el("standingsAfter").textContent = data.round
    ? `After round ${data.round}.` : "";

  const drivers = el("driverStandings");
  drivers.textContent = "";
  data.drivers.forEach((d) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-2 first:pt-0 last:pb-0";
    li.appendChild(text("span", "w-6 shrink-0 text-sm font-semibold tabular-nums text-brand-muted",
      String(d.position)));
    li.appendChild(teamBar(d.constructor ? d.constructor.id : ""));
    const who = document.createElement("span");
    who.className = "min-w-0 flex-1";
    who.appendChild(text("span", "block truncate text-sm text-brand-text", d.driver.name));
    who.appendChild(text("span", "block truncate text-xs text-brand-muted",
      d.constructor ? d.constructor.name : ""));
    li.appendChild(who);
    li.appendChild(text("span", "shrink-0 text-sm font-semibold tabular-nums text-brand-text",
      String(d.points)));
    drivers.appendChild(li);
  });

  const teams = el("teamStandings");
  teams.textContent = "";
  data.constructors.forEach((c) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-2 first:pt-0 last:pb-0";
    li.appendChild(text("span", "w-6 shrink-0 text-sm font-semibold tabular-nums text-brand-muted",
      String(c.position)));
    li.appendChild(teamBar(c.constructor.id));
    li.appendChild(text("span", "min-w-0 flex-1 truncate text-sm text-brand-text", c.constructor.name));
    li.appendChild(text("span", "shrink-0 text-sm font-semibold tabular-nums text-brand-text",
      String(c.points)));
    teams.appendChild(li);
  });
}

// --- loading -----------------------------------------------------------------

async function loadRound(n) {
  page = 0;
  say("");
  try {
    renderRound(await api(`/f1/round/${encodeURIComponent(n)}`));
  } catch (err) {
    console.error("f1: round", err.status, err.code);
    say(err.code === "no_such_round" ? "There is no such round this season."
      : "That round could not be loaded.", "error");
  }
}

profile.then(async () => {
  try {
    const cal = await api("/f1/calendar");
    el("f1Season").textContent = String(cal.season);

    const pick = el("roundPick");
    pick.textContent = "";
    cal.rounds.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = String(r.round);
      // The name carries whether it has run, so the list reads as a season rather than as a
      // list of identical-looking options.
      opt.textContent = `${r.round}. ${r.name}${r.over ? " ✓" : ""}`;
      pick.appendChild(opt);
    });
    const start = cal.currentRound || cal.rounds[cal.rounds.length - 1]?.round;
    if (start) { pick.value = String(start); await loadRound(start); }
    pick.addEventListener("change", (e) => loadRound(e.target.value));

    // Deliberately not awaited: the standings below are a fetch this page was going to make
    // anyway, and they have no business queueing behind a map library.
    startGlobe(cal.rounds);
  } catch (err) {
    console.error("f1: calendar", err.status, err.code);
    say("The season could not be loaded.", "error");
    // The globe is plotted from the calendar, so without one there is nothing to draw. An empty
    // rectangle would be the page inventing a view of a season it never got.
    el("f1Map").hidden = true;
    mapNote("The season did not load, so there is nothing to put on the map.");
  }

  try {
    renderStandings(await api("/f1/standings"));
  } catch (err) {
    console.error("f1: standings", err.status, err.code);
  }
});
