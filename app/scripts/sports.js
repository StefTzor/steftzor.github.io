import { api, profile } from "./shell.js";

/**
 * /sports/: matches from today to a week ahead, grouped by day, favourites highlighted.
 *
 * Text only, never innerHTML: team names come from a third party. A league the API could not
 * read, or one cut short by the free key, is said in words above the list rather than left to
 * look like a quiet week.
 */

const el = (id) => document.getElementById(id);

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const STATUS = { FT: "Full time", AOT: "After overtime", AP: "After penalties", AET: "After extra time", PST: "Postponed", CANC: "Cancelled" };
const NOT_LIVE = new Set(["NS", "TBD", "PST", "CANC", "FT", "AOT", "AP", "AET", "ABD", "AWD", "WO"]);

let data = null;
let favourites = new Set();
let sport = "all";
let favOnly = false;
const leagueName = {};

function dayLabel(d) {
  const today = new Date();
  const key = (x) => x.toDateString();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (key(d) === key(today)) return "Today";
  if (key(d) === key(tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function team(t) {
  const fav = favourites.has(t.id);
  const span = node("span", fav ? "font-semibold text-brand-text" : "text-brand-text", t.name);
  if (fav) span.setAttribute("data-fav", "true");
  return span;
}

function row(m) {
  const fav = favourites.has(m.home.id) || favourites.has(m.away.id);
  const li = node("li", "dm-field items-center py-2");
  li.setAttribute("data-lit", fav ? "true" : "false");

  const start = new Date(m.start);
  li.appendChild(node("span", "w-12 shrink-0 text-sm tabular-nums text-brand-muted",
    start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })));

  const mid = node("span", "flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2");
  mid.appendChild(team(m.home));
  mid.appendChild(node("span", "text-brand-muted", "–"));
  mid.appendChild(team(m.away));
  mid.appendChild(node("span", "text-xs text-brand-muted", leagueName[m.league] || ""));
  li.appendChild(mid);

  const live = m.status && !NOT_LIVE.has(m.status);
  const hasScore = m.homeScore !== null && m.awayScore !== null;
  const right = node("span", "shrink-0 text-right text-sm tabular-nums");
  if (hasScore) right.appendChild(node("span", "font-semibold text-brand-text", m.homeScore + "–" + m.awayScore));
  const word = live ? "Live" : STATUS[m.status];
  if (word) right.appendChild(node("span", live ? "ml-2 text-xs font-semibold st-word" : "ml-2 text-xs text-brand-muted", word));
  if (live) right.lastChild.setAttribute("data-state", "up");
  li.appendChild(right);

  if (fav) li.setAttribute("aria-label", "Favourite: " + m.home.name + " against " + m.away.name);
  return li;
}

function draw() {
  const host = el("spDays");
  host.textContent = "";
  const list = data.matches.filter((m) =>
    (sport === "all" || m.sport === sport) &&
    (!favOnly || favourites.has(m.home.id) || favourites.has(m.away.id)));

  if (!list.length) {
    host.appendChild(node("p", "card text-sm text-brand-muted", favOnly
      ? (favourites.size ? "None of your favourite teams plays in the next seven days." : "No favourites chosen yet. Pick some below.")
      : "No matches in the next seven days."));
    return;
  }
  const days = new Map();
  for (const m of list) {
    const d = new Date(m.start);
    const k = d.toDateString();
    if (!days.has(k)) days.set(k, { date: d, items: [] });
    days.get(k).items.push(m);
  }
  for (const { date, items } of days.values()) {
    const sec = node("section", "card");
    const head = node("div", "an-panel-head");
    head.appendChild(node("h2", "an-panel-title", dayLabel(date)));
    head.appendChild(node("span", "text-xs text-brand-muted", items.length + (items.length === 1 ? " match" : " matches")));
    sec.appendChild(head);
    const ul = node("ul", "mt-2 space-y-1");
    items.forEach((m) => ul.appendChild(row(m)));
    sec.appendChild(ul);
    host.appendChild(sec);
  }
}

function notes() {
  const partial = data.leagues.filter((l) => l.partial).map((l) => l.name);
  const down = data.leagues.filter((l) => l.unavailable).map((l) => l.name);
  const parts = [];
  if (partial.length) parts.push("The free data plan lists at most three games a day per league, so some days may be incomplete for " + partial.join(", ") + ".");
  if (down.length) parts.push("Not available yet for " + down.join(", ") + "; try again in a minute.");
  el("spNote").textContent = parts.join(" ");
  el("spLeagues").textContent = data.leagues.map((l) => l.name).join(", ") + ". Today to a week ahead.";
}

function pickerTeams(teamsData) {
  // The league lists, plus every team seen in the fixtures: on the free key a list stops at ten,
  // and a team that plays this week should never be impossible to pick.
  const byId = new Map();
  (teamsData ? teamsData.teams : []).forEach((t) => byId.set(t.id, t));
  data.matches.forEach((m) => [m.home, m.away].forEach((t) => {
    if (!byId.has(t.id)) byId.set(t.id, { id: t.id, name: t.name, league: m.league });
  }));
  const host = el("spTeams");
  host.textContent = "";
  data.leagues.forEach((l) => {
    const teams = [...byId.values()].filter((t) => t.league === l.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!teams.length) return;
    const fs = node("fieldset");
    fs.appendChild(node("legend", "mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted", l.name));
    teams.forEach((t) => {
      const label = node("label", "flex items-center gap-2 py-0.5 text-sm text-brand-text");
      const box = node("input", "h-4 w-4");
      box.type = "checkbox";
      box.value = t.id;
      box.checked = favourites.has(t.id);
      label.appendChild(box);
      label.appendChild(document.createTextNode(t.name));
      fs.appendChild(label);
    });
    host.appendChild(fs);
  });
  el("spFavCount").textContent = favourites.size ? "(" + favourites.size + ")" : "";
}

async function save() {
  const chosen = [...el("spTeams").querySelectorAll("input[type=checkbox]:checked")].map((b) => b.value);
  el("spSaveNote").textContent = "Saving…";
  try {
    const res = await api("/me/profile", { method: "POST", body: JSON.stringify({ favouriteTeams: chosen }) });
    favourites = new Set(res.favouriteTeams || chosen);
    el("spSaveNote").textContent = "Saved.";
    el("spFavCount").textContent = favourites.size ? "(" + favourites.size + ")" : "";
    draw();
  } catch (err) {
    console.error("sports: save", err.status, err.code);
    el("spSaveNote").textContent = err.code === "bad_teams" ? "Too many teams; thirty at most." : "That could not be saved.";
  }
}

function tabs() {
  const all = [...document.querySelectorAll("[data-sport]")];
  const pick = (b) => {
    sport = b.getAttribute("data-sport");
    all.forEach((x) => {
      x.setAttribute("aria-selected", x === b ? "true" : "false");
      x.tabIndex = x === b ? 0 : -1;
    });
    if (data) draw();
  };
  all.forEach((b, i) => {
    b.addEventListener("click", () => pick(b));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      next.focus();
      pick(next);
    });
  });
  el("spFavOnly").addEventListener("click", (e) => {
    favOnly = !favOnly;
    e.currentTarget.setAttribute("aria-pressed", favOnly ? "true" : "false");
    if (data) draw();
  });
  el("spSave").addEventListener("click", save);
}

tabs();
profile.then(async (me) => {
  favourites = new Set((me && me.favouriteTeams) || []);
  try {
    data = await api("/sports/matches");
  } catch (err) {
    console.error("sports:", err.status, err.code);
    el("spDays").textContent = "";
    el("spDays").appendChild(node("p", "card text-sm text-brand-muted", "Fixtures are unavailable right now."));
    return;
  }
  data.leagues.forEach((l) => { leagueName[l.id] = l.name; });
  notes();
  draw();
  let teamsData = null;
  try { teamsData = await api("/sports/teams"); } catch (err) { console.error("sports: teams", err.status, err.code); }
  pickerTeams(teamsData);
});
