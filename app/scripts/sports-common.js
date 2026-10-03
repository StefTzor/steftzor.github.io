/**
 * What the sports pages and the home card draw the same way: a game row, a story, a headline.
 * Text only, never innerHTML: every name and title here came from a third party. A headline link
 * is only made for an https address on Expressen, the one feed the API reads.
 */

export function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export const isFav = (favourites, g) => favourites.has(g.home.id) || favourites.has(g.away.id);

/** One game: time (or date), the two teams, score or league, live and overtime marked in words. */
export function gameRow(g, { favourites, leagueName, withDate = false }) {
  const fav = isFav(favourites, g);
  const li = node("li", "dm-field items-center py-1.5");
  li.setAttribute("data-lit", fav ? "true" : "false");
  const d = new Date(g.start);
  li.appendChild(node("span", (withDate ? "w-28" : "w-12") + " shrink-0 text-sm tabular-nums text-brand-muted",
    withDate ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })));
  const mid = node("span", "flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2");
  [g.home, g.away].forEach((t, i) => {
    if (i) mid.appendChild(node("span", "text-brand-muted", "–"));
    mid.appendChild(node("span", favourites.has(t.id) ? "font-semibold text-brand-text" : "text-brand-text", t.name));
  });
  if (leagueName) mid.appendChild(node("span", "text-xs text-brand-muted", leagueName));
  li.appendChild(mid);
  const right = node("span", "shrink-0 text-right text-sm tabular-nums");
  if (g.homeScore !== null && g.awayScore !== null) right.appendChild(node("span", "font-semibold text-brand-text", g.homeScore + "–" + g.awayScore));
  if (g.note) right.appendChild(node("span", "ml-1 text-xs text-brand-muted", g.note));
  if (g.state === "in") {
    const live = node("span", "st-word ml-2 text-xs font-semibold", "Live");
    live.setAttribute("data-state", "up");
    right.appendChild(live);
  }
  li.appendChild(right);
  return li;
}

/** A story from the data; a favourite's story is lit like a favourite's game. */
export function storyRow(s, favourites, leagueName) {
  const fav = s.teams.some((t) => favourites.has(t));
  const li = node("li", "dm-field flex-col items-start py-2");
  li.setAttribute("data-lit", fav ? "true" : "false");
  li.appendChild(node("span", fav ? "text-sm font-semibold text-brand-text" : "text-sm text-brand-text", s.text));
  if (leagueName) li.appendChild(node("span", "text-xs text-brand-muted", leagueName));
  return li;
}

/** A headline: its title as a link to Expressen, its age, and the league. */
export function newsRow(n, { leagueName, mentionsFav = false }) {
  const li = node("li", "text-sm");
  if (typeof n.link === "string" && n.link.startsWith("https://www.expressen.se/")) {
    const a = node("a", (mentionsFav ? "font-semibold " : "") + "text-brand-text underline decoration-brand-border underline-offset-2 hover:decoration-brand-accent", n.title);
    a.href = n.link;
    a.rel = "noopener";
    a.target = "_blank";
    li.appendChild(a);
  } else {
    li.appendChild(node("span", "text-brand-text", n.title));
  }
  const meta = [leagueName, n.at ? new Date(n.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""].filter(Boolean).join(" · ");
  if (meta) li.appendChild(node("span", "block text-xs text-brand-muted", meta));
  return li;
}

/** Does a headline name one of these teams? Plain, accent-blind matching on the team's name. */
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function mentions(title, teams) {
  const t = fold(title);
  return teams.some((tm) => tm.name.length > 2 && t.includes(fold(tm.name.replace(/\s+(IF|IK|HC|BK|FF|AIF|SK)$/i, ""))));
}
