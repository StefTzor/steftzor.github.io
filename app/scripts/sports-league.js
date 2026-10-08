import { api, profile } from "./shell.js";
import { node, gameRow, newsRow, mentions } from "./sports-common.js";

/**
 * /sports/<league>/: the table, live games, what is next, the last results and the headlines.
 * Football and hockey tables have different columns; the sport comes from the page itself.
 */

const el = (id) => document.getElementById(id);
const root = el("league");
const SLUG = root.dataset.league;
const KEY_RE = /^(football|hockey):[a-z0-9-]{1,60}$/;

// Column key, heading, what a screen reader hears. On a phone only played, +/- and points show.
const NARROW = new Set(["played", "gd", "points"]);
const COLS = {
  football: [["played", "P", "Played"], ["won", "W", "Won"], ["drawn", "D", "Drawn"], ["lost", "L", "Lost"],
    ["gd", "+/-", "Goal difference"], ["points", "Pts", "Points"]],
  hockey: [["played", "GP", "Games played"], ["won", "W", "Won in regulation"], ["otw", "OTW", "Won in overtime"],
    ["otl", "OTL", "Lost in overtime"], ["lost", "L", "Lost in regulation"], ["gd", "+/-", "Goal difference"], ["points", "Pts", "Points"]],
};

function table(rows, sport, favourites) {
  const cols = COLS[sport] || COLS.football;
  const head = el("lgHead");
  head.textContent = "";
  const hr = node("tr");
  hr.appendChild(node("th", "py-1 pr-2 text-left font-normal", "#"));
  hr.appendChild(node("th", "py-1 text-left font-normal", "Team"));
  cols.forEach(([k, short, long]) => {
    const th = node("th", "py-1 pl-2 text-right font-normal" + (NARROW.has(k) ? "" : " hidden sm:table-cell"));
    const abbr = node("abbr", "no-underline", short);
    abbr.title = long;
    th.appendChild(abbr);
    hr.appendChild(th);
  });
  head.appendChild(hr);

  const body = el("lgTable");
  body.textContent = "";
  rows.forEach((r) => {
    const fav = favourites.has(r.team.id);
    const tr = node("tr", fav ? "lg-fav font-semibold" : "");
    tr.appendChild(node("td", "py-1.5 pr-2 text-brand-muted", String(r.rank)));
    tr.appendChild(node("td", "py-1.5 text-brand-text", r.team.name));
    cols.forEach(([k]) => {
      const v = r[k];
      tr.appendChild(node("td", "py-1.5 pl-2 text-right " + (k === "points" ? "font-semibold text-brand-text" : "text-brand-muted") + (NARROW.has(k) ? "" : " hidden sm:table-cell"),
        v === null || v === undefined ? "—" : (k === "gd" && v > 0 ? "+" + v : String(v))));
    });
    body.appendChild(tr);
  });
  if (!rows.length) {
    const tr = node("tr");
    tr.appendChild(node("td", "py-2 text-brand-muted", "No table yet."));
    body.appendChild(tr);
  }
}

function list(id, games, favourites, withDate, empty) {
  const ul = el(id);
  ul.textContent = "";
  games.forEach((g) => ul.appendChild(gameRow(g, { favourites, withDate })));
  if (!games.length) ul.appendChild(node("li", "text-sm text-brand-muted", empty));
}

profile.then(async (me) => {
  const favourites = new Set(((me && me.favouriteTeams) || []).filter((k) => KEY_RE.test(k)));
  let d;
  try {
    d = await api("/sports/league/" + encodeURIComponent(SLUG));
  } catch (err) {
    console.error("league:", err.status, err.code);
    el("status").textContent = "This league could not be loaded just now.";
    return;
  }
  const leader = d.table[0];
  el("lgMeta").textContent = [d.league.country, leader ? leader.team.name + " lead" : ""].filter(Boolean).join(" · ");
  table(d.table, d.league.sport, favourites);
  if (d.live.length) {
    el("lgLiveWrap").classList.remove("hidden");
    list("lgLive", d.live, favourites, false, "");
  }
  list("lgNext", d.upcoming, favourites, true, "No games scheduled.");
  list("lgResults", d.results, favourites, true, "No results yet this season.");
  const favTeams = d.table.map((r) => r.team).filter((t) => favourites.has(t.id));
  const news = el("lgNews");
  news.textContent = "";
  d.news.slice(0, 6).forEach((n) => news.appendChild(newsRow(n, { mentionsFav: favTeams.length > 0 && mentions(n.title, favTeams) })));
  if (!d.news.length) news.appendChild(node("li", "text-sm text-brand-muted", "No headlines right now."));
  el("lgSource").textContent = "Data from " + d.league.source + ", updated " +
    new Date(d.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) + ". Headlines from Expressen and Aftonbladet.";
});
