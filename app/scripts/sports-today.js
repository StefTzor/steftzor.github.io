import { api, profile } from "./shell.js";
import { remember } from "./rows.js";
import { gameRow, isFav } from "./sports-common.js";

/**
 * The home card for /sports/: today's matches, favourite teams first and highlighted, at most
 * six. On a day with none it shows the next day that has any, and says which day that is.
 * Text only: team names come from a third party.
 */

const el = (id) => document.getElementById(id);
const MAX = 6;


function render(data, favourites) {
  const byDay = new Map();
  for (const m of data.matches) {
    const k = new Date(m.start).toDateString();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  const today = new Date().toDateString();
  const key = byDay.has(today) ? today : [...byDay.keys()][0];
  if (!key) { el("sportsToday").dataset.card = "absent"; return; }

  const fav = (m) => isFav(favourites, m);
  const day = byDay.get(key).slice().sort((a, b) => (fav(b) - fav(a)) || (a.start < b.start ? -1 : 1));
  const league = Object.fromEntries(data.leagues.map((l) => [l.id, l.name]));

  if (key !== today) {
    el("sportsTitle").textContent = "Next matches, " +
      new Date(day[0].start).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  }

  const list = el("sportsRows");
  list.textContent = "";
  list.removeAttribute("aria-busy");
  day.slice(0, MAX).forEach((m) => list.appendChild(gameRow(m, { favourites, leagueName: league[m.league] })));
  el("sportsMore").textContent = day.length > MAX ? "And " + (day.length - MAX) + " more on the Sports page." : "";
  el("sportsToday").dataset.card = "ready";
  remember("sportsRows", Math.min(day.length, MAX));
}

profile.then(async (me) => {
  if (!el("sportsToday")) return;
  try {
    render(await api("/sports/matches"), new Set(((me && me.favouriteTeams) || []).filter((k) => /^(football|hockey):/.test(k))));
  } catch (err) {
    console.error("sports today:", err.status, err.code);
    el("sportsToday").dataset.card = "absent";
  }
});
