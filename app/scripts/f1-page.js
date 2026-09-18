import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";
import { teamColour } from "./f1-teams.js";
import { createMap, goTo, frame } from "./map.js";

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
 * **The markers are GeoJSON sources and layers, not `maplibregl.Marker` elements.**
 * map.js deliberately does not export the library object, and a DOM marker needs it - but the
 * deeper reason is that a DOM marker is a div that has to be re-projected by hand on every frame
 * of the flight and on every frame of a drag, whereas a layer inside the style is drawn by the
 * same renderer that is already drawing the tiles. The cost is that the dots live in a canvas
 * where no screen reader can reach them, so the canvas is hidden from one outright and the round
 * selector is their text alternative; see the comment on the card in f1.njk.
 *
 * There are two sources, because they answer two different questions. The dots are the season -
 * every round, at globe zoom, one point each. The outlines are the place - the real shape of the
 * tarmac, which is a third of a pixel wide until somebody zooms in and is then the only thing on
 * screen worth looking at.
 */
const SOURCE = "rounds";
const ALL = "round-dots";
const HERE = "round-chosen";
const TRACKS = "circuits";
const TRACK = "circuit-outline";
const TRACK_BED = "circuit-outline-casing";

/**
 * The vendored circuit outlines: bacinger/f1-circuits, MIT, forty tracks as LineStrings.
 *
 * Served from this origin like everything else in /vendor, and fetched rather than bundled
 * because 133 KB of coordinates has no business in a script. The extension is `.json` and not
 * `.geojson` on purpose: nginx's mime map knows the first and not the second, and an unknown
 * extension goes out as application/octet-stream - which `res.json()` would still parse, but
 * which falls outside the server's gzip_types and so ships 133 KB where 34 would do.
 *
 * The geometry is traced from OpenStreetMap, whom the basemap's own attribution control already
 * credits on this very map. Crediting them a second time in the page would be noise, not care.
 */
const OUTLINES = "/vendor/f1-circuits.json";

/**
 * Where the camera lands for a round whose circuit this file has no outline for.
 *
 * **This used to be 4 and it was the wrong answer to the question the map exists to ask.** Four
 * placed a circuit in its country and kept the globe reading as a globe, which sounds right and
 * meant the outline was never once seen: the shape fades in between zoom 8 and 11, so the map
 * opened seven levels short of the thing it had just downloaded 133 KB to draw, and every reader
 * had to find that out by zooming. A round WITH an outline is now framed to the circuit's own
 * box (see aim), which is a different and better number for each one.
 *
 * Eleven is the fallback and it is a locality: close enough to see the streets around wherever
 * the round is, far enough not to imply a precision the API's single coordinate does not have.
 * The flight still shows the world turning either way - flyTo arcs out and back in, so changing
 * round is the same journey it always was, and it now ends somewhere worth arriving at.
 */
const PLACE_ZOOM = 11;

let globe = null;     // the map itself, once it exists and only if it ever does
let located = [];     // the calendar rounds that came back with a coordinate
let tracks = null;    // this season's circuit outlines, once fetched and joined - or never
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

/**
 * Kilometres between two [lon, lat].
 *
 * Flat earth, deliberately. Haversine is the correct formula and over the few tens of kilometres
 * this is ever asked about it would differ by metres - which is nothing next to the twenty-
 * kilometre threshold the answer is immediately compared against.
 */
function apart([alon, alat], [blon, blat]) {
  const east = (alon - blon) * Math.cos(((alat + blat) / 2) * Math.PI / 180);
  return Math.hypot(east, alat - blat) * 111.32;
}

/** A circuit's middle, from the bounding box the vendored file already carries for each one. */
const middle = (f) => [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2];

/**
 * How far a round's coordinate may sit from a circuit's middle and still be that circuit, in km.
 *
 * Both ends of this were measured rather than picked. Across this season the worst any round
 * falls from the outline it belongs to is under a kilometre - the API's coordinate is a point on
 * the track itself, not a nearby town - and the two closest circuits in the whole file, Imola and
 * Mugello, are forty-seven kilometres apart. Twenty is twenty times the first and comfortably
 * under half the second, so no point on earth can be within it of two circuits at once and the
 * first match found is therefore also the only one.
 */
const NEAR = 20;

/**
 * This season's rounds, each carrying the real shape of the circuit it is raced on.
 *
 * **Matched on where they are, not on what they are called.** The two sources name the same
 * places differently - the API says "Albert Park Grand Prix Circuit" where the outlines say
 * "Albert Park Circuit", and "Kuala Lumpur" where they say "Sepang" - and the outline ids are
 * country-and-year strings like `au-1953` that the API has never heard of. A name table would
 * need a new exception every time either side renamed something, and would fail silently when it
 * did. A coordinate does not get renamed, and we are already given one per round.
 *
 * A round with no outline within NEAR is simply left out, which is not a failure: the dots are a
 * separate source and every located round is in it, so a circuit this file has never seen keeps
 * its dot and loses only a shape that was never there to draw.
 */
async function circuitOutlines(rounds) {
  const res = await fetch(OUTLINES);
  if (!res.ok) throw new Error(`the circuit outlines answered ${res.status}`);
  const circuits = (await res.json()).features;
  const features = [];
  rounds.forEach((r) => {
    const here = at(r);
    const shape = circuits.find((f) => apart(here, middle(f)) < NEAR);
    // `over` replaces the file's own properties, none of which this page reads. It is the same
    // flag the dots carry, so an outline is painted by the same expression as the dot it sits
    // under and the key below the map goes on describing both. `round` rides along so that aim()
    // can find the shape belonging to the chosen round and frame the map to it - the spread keeps
    // the file's own `bbox`, which is the box being framed and the reason none of this needs a
    // second pass over the geometry.
    if (shape) features.push({ ...shape, properties: { over: Boolean(r.over), round: Number(r.round) } });
  });
  return { type: "FeatureCollection", features };
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
 * so everything added here is thrown away every time the theme is toggled. Re-adding it on every
 * `style.load` covers both that and the first one, and re-reading the tokens each time is what
 * keeps the dots and the outlines in the palette they are drawn on.
 *
 * **It has to do nothing at all once the season is already there**, because it is also called
 * directly and would otherwise add a second copy of everything. One guard and not two: the dot
 * source is the one addRounds always adds and always adds first, so its presence is the answer to
 * "has this style been drawn on yet" whether or not the outlines ever arrived.
 *
 * Wrapped, and the wrapping matters: the same guard means a throw *after* the first source was
 * added would block every future attempt while leaving the layers missing - a half-built style
 * that can never repair itself. On a throw everything added here is taken back out, so the next
 * `style.load` starts clean.
 */
function draw() {
  if (!globe || globe.getSource(SOURCE)) return;
  try {
    addRounds();
  } catch (err) {
    console.error("f1: the globe's markers could not be drawn", err);
    // Layers first, then sources: MapLibre refuses to remove a source that a layer still points
    // at, so the obvious order leaves exactly the wreckage this is here to clear.
    try {
      [TRACK, TRACK_BED, HERE, ALL].forEach((id) => {
        if (globe.getLayer(id)) globe.removeLayer(id);
      });
      [TRACKS, SOURCE].forEach((id) => { if (globe.getSource(id)) globe.removeSource(id); });
    } catch (e) { /* nothing left to tidy */ }
  }
}

function addRounds() {
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

  // **The real shape of the track, once there is room to draw one.** This is the answer to a
  // globe of twenty-three identical dots: a dot says a race happens somewhere near here, and
  // Monaco's hairpins, Spa's climb through Eau Rouge and Zandvoort's banking say which race it
  // is. A circuit is about five kilometres of tarmac, which at the zoom this globe opens at is a
  // third of a pixel - so the outline is not drawn away, it is simply not visible until the map
  // is close enough for it to mean something, and the dots carry the season until then.
  //
  // The two zoom stops are where those two facts change hands. Nothing below 8, full by 11:
  // around 11 a lap is a few hundred pixels across, which is the first zoom at which the shape
  // reads as a circuit rather than as a smudge. Width grows with zoom for the same reason a
  // hairline would vanish on a phone and a fat line would bury the pit straight.
  //
  // Skipped entirely when the outlines did not arrive, which is the whole of the fallback: the
  // dots are a different source and every located round is still in it.
  if (tracks) {
    globe.addSource(TRACKS, { type: "geojson", data: tracks });

    // **A casing under the outline, so its contrast stops depending on what it lands on.**
    //
    // WCAG 1.4.11 asks 3:1 of a graphical object, and the outline is drawn at the zooms where the
    // dark basemap is at its lightest. Measured against the inks in vendor/positron-dark.json:
    // over bare land #334155 accent #10b981 holds 4.08:1 and muted #94a3b8 4.04:1, which passes -
    // but half this calendar is street circuits, and Monaco, Baku, Singapore and Albert Park are
    // ordinary public roads in OpenStreetMap, so the shape is drawn directly along the road the
    // style has already painted. On the major-road ink #5c6b85 that is 2.12:1 and 2.10:1; on the
    // minor-road #4a5871, 2.83:1 and 2.80:1; on a pit complex's buildings #40526c, 3.13:1 and
    // 3.10:1, which clears the bar by nothing at all. So the outline passes or fails according to
    // which circuit was chosen, which is not a state to ship.
    //
    // Two pixels of --color-bg on each side makes the outline's neighbour one known colour
    // instead of whatever the tile holds. Against it accent is 7.04:1 and muted 6.96:1 in dark,
    // and 6.83:1 / 6.74:1 in light, where --color-bg #eef2f7 sits at 1.08:1 against positron's
    // near-white land - invisible and load-bearing at once, which is what a halo is, and the same
    // trick both styles already use under every label they draw.
    //
    // Same source, same zoom ramp, same join and cap, so it fades in with the outline instead of
    // appearing as a bare dark worm at the zoom where the outline is still transparent.
    globe.addLayer({
      id: TRACK_BED,
      type: "line",
      source: TRACKS,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ink("bg"),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 1],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 7],
      },
    });

    // Added last so the line draws over its own dot. The same `over` expression as the dots
    // above, from the same flag, so zooming in changes the shape of what is drawn and not what
    // its colour means.
    globe.addLayer({
      id: TRACK,
      type: "line",
      source: TRACKS,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["case", ["get", "over"], ink("muted"), ink("accent")],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 1],
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 14, 3],
      },
    });
  }
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
  // The circuit's own box when there is one, so Monaco and Spa each fill the card rather than
  // sharing a zoom that suits neither. Falling back to a coordinate and a zoom is the same
  // fallback the outline itself has: a round this file could not match keeps its dot and loses
  // only the shape, and that is exactly the case where a box does not exist to frame.
  const shape = tracks && tracks.features.find((f) => f.properties.round === chosen);
  // `frame` answers false for a box it will not use, which is the same outcome as having no
  // outline at all - so there is one fallback here rather than one per way of failing.
  if (shape && frame(globe, shape.bbox)) return;
  goTo(globe, target, PLACE_ZOOM);
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

  // Started here and awaited below rather than awaited here, so 133 KB of circuit outlines
  // downloads alongside the ~300 KB of library instead of after it. Both are static files on this
  // origin and neither waits on the other, so adding the smaller wait to the larger would buy
  // nothing. `located` and not `rounds`, because a round the API could not place has no
  // coordinate to match on.
  //
  // Caught here and not at the call site: a failure has to cost the outlines and nothing else.
  // `tracks` stays null, addRounds skips the line layer, and the globe is exactly the globe it
  // was before any of this - which is the same fallback an unmatched circuit gets.
  const outlines = circuitOutlines(located).catch((err) => {
    console.error("f1: the circuit outlines could not be loaded", err);
    return null;
  });

  try {
    globe = await createMap(el("f1Map"), {
      globe: true,
      center: target || [0, 0],
      zoom: target ? PLACE_ZOOM : 1,
      // Offered here and not on /transit/: a photograph answers "which circuit is this" and hides
      // everything a departure board's map is for. map.js says the whole of it.
      satellite: true,
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

  // **`style.load`, not `styledata`, and draw once immediately.**
  //
  // This is where the markers were lost. `createMap` awaits `style.load` before it hands the map
  // back, so by the time this line runs the only `styledata` of the initial load has already been
  // dispatched - the listener was attached to an event that was never coming again. The guard
  // below it did not save it either: `isStyleLoaded()` is true only once every tile source has
  // loaded as well, which one microtask after `style.load` it is not. So `draw()` returned early
  // every time it was called and the source was never added, for the life of the page.
  //
  // `style.load` is the right event because it fires again on `setStyle`, which is how map.js
  // re-inks on a theme change - and a new style discards the source and both layers, so that is
  // exactly when they need re-adding. The direct call covers the first draw, since the style this
  // map was built with is already loaded.
  //
  // Awaited immediately before the first draw, so both sources go in together on every style this
  // map ever has - including the very first one. A draw that ran before the outlines landed would
  // leave the line layer missing until the next theme toggle, which is a bug that only shows up
  // on a slow connection.
  tracks = await outlines;
  globe.on("style.load", draw);
  draw();
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
