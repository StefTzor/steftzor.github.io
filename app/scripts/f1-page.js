import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";
import { teamColour } from "./f1-teams.js";

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
  } catch (err) {
    console.error("f1: calendar", err.status, err.code);
    say("The season could not be loaded.", "error");
  }

  try {
    renderStandings(await api("/f1/standings"));
  } catch (err) {
    console.error("f1: standings", err.status, err.code);
  }
});
