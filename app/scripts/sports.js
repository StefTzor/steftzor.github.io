import { api, profile } from "./shell.js";
import { node, gameRow, storyRow, newsRow, isFav, mentions } from "./sports-common.js";

/**
 * /sports/: the bulletin (stories from the data, real headlines), the week's games grouped by day,
 * and the favourites picker. Favourites come first everywhere and are highlighted.
 */

const el = (id) => document.getElementById(id);

let week = null;
let teams = [];
let favourites = new Set();
let sport = "all";
let favOnly = false;
const leagueName = {};
const KEY_RE = /^(football|hockey):[a-z0-9-]{1,60}$/;

function dayLabel(d) {
  const key = (x) => x.toDateString();
  const today = new Date();
  if (key(d) === key(today)) return "Today";
  if (key(d) === key(new Date(today.getTime() + 86400000))) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function drawWeek() {
  const host = el("spDays");
  host.textContent = "";
  const list = week.matches.filter((m) =>
    (sport === "all" || m.sport === sport) && (!favOnly || isFav(favourites, m)));
  if (!list.length) {
    host.appendChild(node("p", "card text-sm text-brand-muted", favOnly
      ? (favourites.size ? "None of your teams plays in the next seven days." : "No favourites chosen yet. Pick some below.")
      : "No games in the next seven days."));
    return;
  }
  const days = new Map();
  for (const m of list) {
    const k = new Date(m.start).toDateString();
    if (!days.has(k)) days.set(k, { date: new Date(m.start), items: [] });
    days.get(k).items.push(m);
  }
  for (const { date, items } of days.values()) {
    const sec = node("section", "card");
    const head = node("div", "an-panel-head");
    head.appendChild(node("h3", "an-panel-title", dayLabel(date)));
    head.appendChild(node("span", "text-xs text-brand-muted", items.length + (items.length === 1 ? " game" : " games")));
    sec.appendChild(head);
    const ul = node("ul", "mt-2 space-y-1");
    items.forEach((m) => ul.appendChild(gameRow(m, { favourites, leagueName: leagueName[m.league] })));
    sec.appendChild(ul);
    host.appendChild(sec);
  }
}

function drawBulletin(o) {
  const favTeams = teams.filter((t) => favourites.has(t.id));
  const stories = el("spStories");
  stories.textContent = "";
  const sorted = o.stories.slice().sort((a, b) =>
    (b.teams.some((t) => favourites.has(t)) - a.teams.some((t) => favourites.has(t))));
  sorted.slice(0, 7).forEach((s) => stories.appendChild(storyRow(s, favourites, leagueName[s.league])));
  if (!sorted.length) stories.appendChild(node("li", "text-sm text-brand-muted", "No stories yet: the leagues are still loading."));

  const news = el("spNews");
  news.textContent = "";
  const items = o.news.map((n) => ({ n, fav: favTeams.length > 0 && mentions(n.title, favTeams) }))
    .sort((a, b) => b.fav - a.fav);
  items.slice(0, 6).forEach(({ n, fav }) => news.appendChild(newsRow(n, { leagueName: leagueName[n.league], mentionsFav: fav })));
  if (!items.length) news.appendChild(node("li", "text-sm text-brand-muted", "No headlines right now."));
}

function drawPicker() {
  const host = el("spTeams");
  const boxes = [...host.querySelectorAll("input[type=checkbox]")];
  const ticked = new Set(boxes.length ? boxes.filter((b) => b.checked).map((b) => b.value) : favourites);
  host.textContent = "";
  week.leagues.forEach((l) => {
    const inLeague = teams.filter((t) => t.league === l.id);
    if (!inLeague.length) return;
    const fs = node("fieldset");
    fs.appendChild(node("legend", "mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted", l.name));
    inLeague.forEach((t) => {
      const label = node("label", "flex items-center gap-2 py-0.5 text-sm text-brand-text");
      const box = node("input", "h-4 w-4");
      box.type = "checkbox";
      box.value = t.id;
      box.checked = ticked.has(t.id);
      label.appendChild(box);
      label.appendChild(document.createTextNode(t.name));
      fs.appendChild(label);
    });
    host.appendChild(fs);
  });
  el("spFavCount").textContent = favourites.size ? "(" + favourites.size + ")" : "";
}

let overviewData = null;

async function save() {
  // A team in two leagues (AIK) has two boxes with one key; a Set keeps it once.
  const chosen = [...new Set([...el("spTeams").querySelectorAll("input[type=checkbox]:checked")].map((b) => b.value))];
  el("spSaveNote").textContent = "Saving…";
  try {
    const res = await api("/me/profile", { method: "POST", body: JSON.stringify({ favouriteTeams: chosen }) });
    favourites = new Set(res.favouriteTeams || chosen);
    el("spSaveNote").textContent = "Saved.";
    el("spFavCount").textContent = favourites.size ? "(" + favourites.size + ")" : "";
    drawWeek();
    if (overviewData) drawBulletin(overviewData);
  } catch (err) {
    console.error("sports: save", err.status, err.code);
    el("spSaveNote").textContent = err.code === "bad_teams" ? "Too many teams; thirty at most." : "That could not be saved.";
  }
}

function controls() {
  const all = [...document.querySelectorAll("[data-sport]")];
  const pick = (b) => {
    sport = b.getAttribute("data-sport");
    all.forEach((x) => { x.setAttribute("aria-selected", x === b ? "true" : "false"); x.tabIndex = x === b ? 0 : -1; });
    if (week) drawWeek();
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
    if (week) drawWeek();
  });
  el("spSave").addEventListener("click", save);
}

controls();
profile.then(async (me) => {
  // Favourites saved in an older format are not team keys any more and are simply not shown.
  favourites = new Set(((me && me.favouriteTeams) || []).filter((k) => KEY_RE.test(k)));
  try {
    week = await api("/sports/matches");
  } catch (err) {
    console.error("sports:", err.status, err.code);
    el("spDays").textContent = "";
    el("spDays").appendChild(node("p", "card text-sm text-brand-muted", "Sports data is unavailable right now."));
    return;
  }
  week.leagues.forEach((l) => { leagueName[l.id] = l.name; });
  const down = week.leagues.filter((l) => l.unavailable).map((l) => l.name);
  el("spNote").textContent = down.length ? "Not available just now: " + down.join(", ") + "." : "";
  drawWeek();
  try { teams = (await api("/sports/teams")).teams; } catch (err) { console.error("sports: teams", err.status, err.code); }
  drawPicker();
  try {
    overviewData = await api("/sports/overview");
    drawBulletin(overviewData);
  } catch (err) {
    console.error("sports: overview", err.status, err.code);
    el("spStories").appendChild(node("li", "text-sm text-brand-muted", "Stories are unavailable right now."));
  }
});
