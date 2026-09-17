import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin -> Analytics: what the API's own counter has recorded.
 *
 * Everything on this page comes from one call, so no two panels can be describing different
 * windows. The rule the page states about itself is the rule this file follows: a figure that
 * has not been measured is drawn as an em dash, an empty window says it is empty in words, and a
 * panel whose source did not answer says that instead of drawing a nought. A zero on a dashboard
 * is a claim that something was counted and came to nothing, and that is not the same statement
 * as "nothing has been counted".
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const PROPERTY = { site: "Public site", app: "App" };
const PROPERTY_HOST = { site: "tzortzoglou.eu", app: "app.tzortzoglou.eu" };

const count = (n) => n.toLocaleString();

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // textContent, never innerHTML: every string below is a path, a hostname or a date that came
  // out of a request, and none of it has any business being parsed as markup.
  if (text !== undefined) n.textContent = text;
  return n;
}

function only(host, ...kids) {
  host.textContent = "";
  host.append(...kids);
}

const nothing = (host, text) => only(host, node("p", "text-sm text-brand-muted", text));

/** Noon, so a day label cannot slide to the one before it in a zone behind UTC. */
const dayLabel = (day) =>
  new Date(day + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * The range note's two ends, which are the window's boundaries as ISO timestamps.
 *
 * Through dayLabel rather than formatted directly. `range.from` is midnight UTC, and formatting
 * that in a zone behind UTC gives the evening of the day before - so an admin in New York read
 * "17 Aug to 16 Sep" above a chart whose first bar was labelled 18 Aug. The two lines disagreed
 * by a day about the same window. Taking the date part and reading it at noon is what dayLabel
 * already does for every bar; this makes the heading agree with them.
 */
const dateLabel = (iso) => dayLabel(String(iso).slice(0, 10));

/** A figure and the line under it. Takes the dash off once there is something real to say. */
function stat(id, value, note) {
  const box = el(id);
  box.textContent = value;
  box.removeAttribute("data-loading");
  el(id + "Note").textContent = note;
}

/** label · value rows, the shape Health and Messages already use for a list of counts. */
function rowList(rows) {
  const ul = node("ul", "mt-3 divide-y divide-brand-border");
  rows.forEach(([label, value]) => {
    const li = node("li", "flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0");
    li.append(
      node("span", "min-w-0 flex-1 truncate text-sm text-brand-text", label),
      node("span", "shrink-0 text-xs text-brand-muted tabular-nums", count(value)),
    );
    ul.appendChild(li);
  });
  return ul;
}

/**
 * The per-day chart, as inline SVG.
 *
 * There is no chart library in this repository and one bar chart does not justify adding one:
 * the whole drawing is a rect per day and a baseline.
 *
 * `preserveAspectRatio="none"` with a viewBox one unit wide per day, so the bars stretch to fill
 * whatever width the panel has rather than the drawing being letterboxed inside it. That is only
 * safe because every mark here is a stroke-less rect - uniform horizontal scaling cannot make a
 * rect look wrong, where it would visibly thin a stroked line.
 *
 * Colour comes from `currentColor` against a Tailwind text token, which is what makes it legible
 * in both themes without this file knowing anything about either one.
 *
 * The SVG is aria-hidden and the same numbers are repeated as a table for a screen reader. A
 * picture is not an answer to someone who cannot see it, and a bar with an aria-label per day is
 * a list of thirty announcements with no structure holding them together.
 */
function chart(daily) {
  const host = el("chart");

  if (!daily.length) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }

  const max = Math.max(...daily.map((d) => d.views));
  if (!max) {
    nothing(host, "Nothing counted in this window yet. Every day in the range is empty.");
    return;
  }
  // One day is a number, not a shape. A single full-height bar would read as a trend, and the
  // only trend a one-day window contains is the one the reader invents.
  if (daily.length < 2) {
    nothing(host, `${count(daily[0].views)} views on ${dayLabel(daily[0].day)}.`);
    return;
  }

  const H = 100;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${daily.length * 10} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "w-full h-40 text-brand-accent");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  // Drawn even though a bar of zero height is invisible - without it an empty stretch of days
  // is indistinguishable from the panel having failed to draw anything at all.
  const base = document.createElementNS(SVG_NS, "g");
  base.setAttribute("class", "text-brand-border");
  const line = document.createElementNS(SVG_NS, "rect");
  line.setAttribute("x", "0");
  line.setAttribute("y", String(H - 1));
  line.setAttribute("width", String(daily.length * 10));
  line.setAttribute("height", "1");
  line.setAttribute("fill", "currentColor");
  base.appendChild(line);
  svg.appendChild(base);

  daily.forEach((d, i) => {
    if (!d.views) return;
    const height = (d.views / max) * H;
    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", String(i * 10 + 1));
    bar.setAttribute("y", String(H - height));
    bar.setAttribute("width", "8");
    bar.setAttribute("height", String(height));
    bar.setAttribute("fill", "currentColor");
    // A native tooltip for a pointer. The table below is what a screen reader reads.
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${dayLabel(d.day)}: ${count(d.views)}`;
    bar.appendChild(title);
    svg.appendChild(bar);
  });

  const busiest = daily.reduce((a, b) => (b.views > a.views ? b : a));
  const figure = node("figure");
  const caption = node("figcaption", "mt-3 text-sm text-brand-muted",
    `${dayLabel(daily[0].day)} to ${dayLabel(daily[daily.length - 1].day)}. `
    + `Busiest day ${dayLabel(busiest.day)}, ${count(busiest.views)} views.`);

  const table = node("table", "sr-only");
  table.appendChild(node("caption", "", "Views per day"));
  const body = node("tbody");
  daily.forEach((d) => {
    const tr = node("tr");
    const th = node("th", "", dayLabel(d.day));
    th.setAttribute("scope", "row");
    tr.append(th, node("td", "", `${count(d.views)} views`));
    body.appendChild(tr);
  });
  table.appendChild(body);

  figure.append(svg, caption, table);
  only(host, figure);
}

/** One card per property, so a silent property reads as silent rather than as absent. */
function paths(topPaths, byProperty) {
  const grid = node("div", "grid gap-4 sm:grid-cols-2");

  Object.keys(PROPERTY).forEach((key) => {
    const total = byProperty.find((p) => p.property === key);
    const views = total ? total.views : 0;
    const rows = topPaths.filter((p) => p.property === key);

    const card = node("section", "card");
    card.append(
      node("h3", "font-semibold text-brand-text", PROPERTY[key]),
      node("p", "hint mt-1", views
        ? `${count(views)} views · ${PROPERTY_HOST[key]}`
        : `Nothing counted here in this window yet · ${PROPERTY_HOST[key]}`),
    );
    if (rows.length) card.appendChild(rowList(rows.map((r) => [r.path, r.views])));
    grid.appendChild(card);
  });

  only(el("paths"), grid);
}

function referrers(list) {
  const host = el("referrers");
  if (!list.length) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }
  const card = node("section", "card");
  // A null host is a real and common answer - somebody typed the address, or the browser was
  // told not to send a referrer. Calling it "direct" and leaving it at that would claim more
  // than is known, so the row says both.
  card.appendChild(rowList(list.map((r) => [r.host || "Direct, or no referrer sent", r.views])));
  only(host, card);
}

function render(data) {
  const totals = data.totals || {};
  const views = totals.views || 0;
  const previous = totals.previousViews || 0;
  const range = data.range || {};

  stat("views", views ? count(views) : "None yet",
    range.from && range.to ? `${dateLabel(range.from)} to ${dateLabel(range.to)}.`
      : "In this window.");

  // Four different sentences, because a percentage is only meaningful when there is something to
  // be a percentage of. Dividing by a previous window of nought gives Infinity, and "+∞%" of
  // nothing is the kind of figure that ends up in a slide.
  if (!views && !previous) {
    stat("change", "—", "Nothing counted in either window.");
  } else if (!previous) {
    stat("change", "First", "Nothing was counted in the window before this one.");
  } else {
    const pct = Math.round(((views - previous) / previous) * 100);
    stat("change", `${pct > 0 ? "+" : ""}${pct}%`, `${count(previous)} views in the window before.`);
  }

  const linkedin = data.fromLinkedIn || 0;
  stat("linkedin", linkedin ? count(linkedin) : "None yet",
    linkedin && views ? `${Math.round((linkedin / views) * 100)}% of views in this window.`
      : "No view in this window arrived from LinkedIn.");

  chart(data.daily || []);
  paths(data.topPaths || [], data.byProperty || []);
  referrers(data.referrers || []);
}

/** Every panel says why it is empty, rather than each one quietly drawing nothing. */
function unavailable(message) {
  ["views", "change", "linkedin"].forEach((id) => {
    el(id).textContent = "—";
    el(id).setAttribute("data-loading", "");
    el(id + "Note").textContent = "";
  });
  ["chart", "paths", "referrers"].forEach((id) => nothing(el(id), message));
}

// A slow answer for 365 days must not land after a fast answer for 7 and overwrite it. The same
// guard profile.js uses: only the most recent request is allowed to draw.
let sequence = 0;

async function load() {
  const mine = ++sequence;
  say("Loading…");
  try {
    const data = await api("/admin/analytics?days=" + encodeURIComponent(el("range").value));
    if (mine !== sequence) return;
    render(data);
    say("");
  } catch (err) {
    if (mine !== sequence) return;
    console.error("analytics:", err.status, err.code);
    // Two different failures, and they used to be one. This branched on a code of
    // "not_configured", which /admin/analytics has never sent: the API mounts the analytics
    // routes only inside `if (postgres)`, so a deployment with no database answers 404 because
    // the route does not exist, and the only code the route itself sends is `db_unavailable`
    // when the query fails. The old test therefore caught the 404 by its status and never once
    // matched on the code, while a database that was configured and unreachable was reported as
    // "not connected" - which is a different thing and sends whoever reads it looking in the
    // wrong place.
    const missing = err.status === 404;
    const unreachable = err.code === "db_unavailable";
    unavailable(missing
      ? "Analytics needs the database, which is not configured. Nothing is broken; it is simply not connected."
      : unreachable
        ? "The database is configured but did not answer, so the counts could not be read."
        : "This could not be loaded.");
    say(missing ? "Analytics are not connected on this deployment."
      : unreachable ? "The database did not answer."
        : "Analytics could not be loaded.", "error");
  }
}

profile.then(() => {
  el("range").addEventListener("change", load);
  load();
});
