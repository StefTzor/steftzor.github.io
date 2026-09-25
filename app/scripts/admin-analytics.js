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

// Maps rather than object literals, for the reason shell.js states beside its own RANK: a plain
// object answers `obj["constructor"]` with an inherited function, and a lookup that falls back to
// the key would then render a function's source as a label. Nothing here is caller-chosen - the
// property is a server-side enum and the bracket names come from a closed list - so this is
// consistency rather than a fix, and the shape that caused a real escalation once should not
// survive anywhere in this codebase. Raised as a sub-threshold note in this commit's review.
const PROPERTY = new Map([["site", "Public site"], ["app", "App"]]);
const PROPERTY_HOST = new Map([["site", "tzortzoglou.eu"], ["app", "app.tzortzoglou.eu"]]);
const label = (map, key) => map.get(key) || key;

const count = (n) => n.toLocaleString();
const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * A duration, in the units somebody would say it in.
 *
 * Seconds under a minute, m:ss above it. Not "0.68 minutes", and not a bare seconds count for
 * anything long enough that nobody can read it at a glance.
 */
function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** A time of day and the date, for the last-visits list. */
const stamp = (iso) => new Date(iso).toLocaleString(undefined, {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DIMENSIONS = [
  ["byBrowser", "Browser"],
  ["byOs", "Operating system"],
  ["byDevice", "Device"],
  ["byScreen", "Window width"],
];

/** What the chart draws, chosen by the Visitors and Views figures in the headline strip. */
let metric = "visitors";
let lastData = null;

/** A flag from two letters: each letter's regional-indicator symbol. Nothing for "unknown". */
const flag = (code) => (/^[A-Z]{2}$/.test(code)
  ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "");

// The API stores two letters (SE); the browser already knows every country's name in English.
// "unknown" is a view with no country: the lookup had no data, or the file had not loaded yet.
const REGION = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; }
})();
const countryName = (code) => {
  if (code === "unknown") return "Unknown";
  try { return (REGION && REGION.of(code)) || code; } catch { return code; }
};

// The width brackets, said as a person would. The API stores the bracket name; this is the only
// place that turns it into something with a number in it, so the boundaries live in one file on
// each side rather than being repeated as prose in the template.
const SCREEN = new Map([
  ["phone", "Phone (under 640px)"],
  ["tablet", "Tablet (640-1023px)"],
  ["laptop", "Laptop (1024-1279px)"],
  ["desktop", "Desktop (1280px and up)"],
  ["unknown", "Not sent"],
]);

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

/**
 * The table that says in words what a picture says in ink.
 *
 * Every chart on this page is aria-hidden and paired with one of these. A picture is not an
 * answer to somebody who cannot see it, and an aria-label per bar is thirty announcements with
 * no structure holding them together - a table has a caption, headers and rows, which is the
 * structure the numbers already have.
 */
function srTable(caption, rows, headers) {
  const table = node("table", "sr-only");
  table.appendChild(node("caption", "", caption));
  if (headers) {
    const head = node("thead");
    const tr = node("tr");
    headers.forEach((h) => {
      const th = node("th", "", h);
      th.setAttribute("scope", "col");
      tr.appendChild(th);
    });
    head.appendChild(tr);
    table.appendChild(head);
  }
  const body = node("tbody");
  rows.forEach((cells) => {
    const tr = node("tr");
    const th = node("th", "", String(cells[0]));
    th.setAttribute("scope", "row");
    tr.appendChild(th);
    cells.slice(1).forEach((c) => tr.appendChild(node("td", "", String(c))));
    body.appendChild(tr);
  });
  table.appendChild(body);
  return table;
}

/**
 * A list of label/value rows with the value drawn as a bar behind the label.
 *
 * The bar is a background on the row rather than a second element beside it, so the label sits
 * on top of its own measurement and the list stays one column wide on a phone. Proportional to
 * the largest row, not to the total: the question these lists answer is "which of these is the
 * big one", and against a total the small ones become invisible lines.
 */
function barList(rows, unit) {
  const ul = node("ul", "mt-3 space-y-1");
  const max = Math.max(...rows.map((r) => r[1]), 1);
  rows.forEach(([name, value, tag]) => {
    const li = node("li", "relative overflow-hidden rounded");
    const fill = node("div", "absolute inset-y-0 left-0 bg-brand-accent/15");
    fill.style.width = `${Math.max(2, (value / max) * 100)}%`;
    fill.setAttribute("aria-hidden", "true");
    const line = node("div", "relative flex items-baseline justify-between gap-4 px-2 py-1.5");
    const left = node("span", "min-w-0 flex-1 truncate text-sm text-brand-text", name);
    if (tag) left.appendChild(node("span", "ml-2 text-[11px] text-brand-muted", tag));
    line.append(left,
      node("span", "shrink-0 text-xs text-brand-muted tabular-nums",
        `${count(value)}${unit ? " " + unit : ""}`),
    );
    li.append(fill, line);
    ul.appendChild(li);
  });
  return ul;
}

/**
 * The first ten rows, and a button for the rest. A panel that grows to fifty rows pushes its
 * neighbour's row of the grid apart; the whole list is still one click away, and still in the
 * table a screen reader gets.
 */
const CAP = 10;
function capped(rows, unit) {
  if (rows.length <= CAP + 2) return barList(rows, unit);
  const wrap = node("div", "");
  const short = barList(rows.slice(0, CAP), unit);
  const full = barList(rows, unit);
  full.hidden = true;
  const more = node("button", "mt-2 text-xs font-semibold text-brand-accent hover:underline",
    `Show all ${count(rows.length)}`);
  more.setAttribute("type", "button");
  more.addEventListener("click", () => {
    const open = full.hidden;
    full.hidden = !open;
    short.hidden = open;
    more.textContent = open ? "Show fewer" : `Show all ${count(rows.length)}`;
  });
  wrap.append(short, full, more);
  return wrap;
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
  // An API that predates visitors-per-day sends no such field. That is not a count of nought,
  // and drawing it as one would print "nothing counted" over a window full of views - so an
  // ABSENT field falls back to views, while a present zero is still drawn as the zero it is.
  const shown = daily.some((d) => d[metric] !== undefined) ? metric : "views";
  const noun = shown === "visitors" ? "visitors" : "views";
  const head = node("div", "an-panel-head");
  head.append(
    node("h2", "an-panel-title", shown === "visitors" ? "Unique visitors per day" : "Views per day"),
    node("p", "text-xs text-brand-muted", "Every day in the range, including the empty ones."),
  );

  const values = daily.map((d) => Number(d[shown]) || 0);
  if (!daily.length) {
    only(host, head, node("p", "mt-3 text-sm text-brand-muted", "Nothing counted in this window yet."));
    return;
  }
  const max = Math.max(...values);
  if (!max) {
    only(host, head, node("p", "mt-3 text-sm text-brand-muted",
      "Nothing counted in this window yet. Every day in the range is empty."));
    return;
  }
  // One day is a number, not a shape. A single point would read as a trend, and the only trend a
  // one-day window contains is the one the reader invents.
  if (daily.length < 2) {
    only(host, head, node("p", "mt-3 text-sm text-brand-muted",
      `${count(values[0])} ${noun} on ${dayLabel(daily[0].day)}.`));
    return;
  }

  // Round gridlines: 1, 2 or 5 times a power of ten, four steps at most, so the axis reads
  // 0 / 25 / 50 / 75 / 100 rather than 0 / 23.75 / 47.5.
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const stepV = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) || mag * 10;
  const top = Math.ceil(max / stepV) * stepV;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += stepV) ticks.push(v);

  // The plot is stretched to its box (preserveAspectRatio none), so every stroke carries
  // vector-effect and stays one weight at any width; the area has no stroke to distort. Text
  // never goes in the SVG - stretched text is illegible - so the axes and tooltip are HTML.
  const W = daily.length * 10;
  const H = 100;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const x = (i) => (i / (daily.length - 1)) * W;
  const y = (v) => H - (v / top) * H;

  ticks.forEach((t) => {
    const g = document.createElementNS(SVG_NS, "line");
    g.setAttribute("x1", "0");
    g.setAttribute("x2", String(W));
    g.setAttribute("y1", String(y(t)));
    g.setAttribute("y2", String(y(t)));
    g.setAttribute("class", "an-grid");
    g.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(g);
  });

  // A soft fill that fades to nothing at the baseline, in chart ink.
  const defs = document.createElementNS(SVG_NS, "defs");
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", "anFill");
  grad.setAttribute("x1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("y2", "1");
  [["0", "0.28"], ["1", "0"]].forEach(([at, op]) => {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", at);
    stop.setAttribute("stop-color", "currentColor");
    stop.setAttribute("stop-opacity", op);
    grad.appendChild(stop);
  });
  defs.appendChild(grad);
  svg.appendChild(defs);

  // A Catmull-Rom spline converted to cubic Béziers. It passes THROUGH every point rather than
  // near it - a smoothing that moved the days would be a chart drawing numbers nobody counted.
  const pts = values.map((v, i) => [x(i), y(v)]);
  let path = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    // Clamped to the plot, so the curve cannot overshoot below zero between two quiet days.
    const cy = (v) => Math.min(H, Math.max(0, v));
    path += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${cy(p1[1] + (p2[1] - p0[1]) / 6)},`
      + ` ${p2[0] - (p3[0] - p1[0]) / 6} ${cy(p2[1] - (p3[1] - p1[1]) / 6)},`
      + ` ${p2[0]} ${p2[1]}`;
  }

  const area = document.createElementNS(SVG_NS, "path");
  area.setAttribute("d", `${path} L ${W} ${H} L 0 ${H} Z`);
  area.setAttribute("fill", "url(#anFill)");
  svg.appendChild(area);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("d", path);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);

  const plot = node("div", "an-plot");
  plot.appendChild(svg);
  ticks.forEach((t) => {
    const tick = node("span", "an-ytick", count(t));
    tick.style.top = `${(1 - t / top) * 100}%`;
    tick.setAttribute("aria-hidden", "true");
    plot.appendChild(tick);
  });

  // The hover layer: a crosshair, a dot on the line and a tooltip, positioned in percent so the
  // plot can be any width. For a mouse; the table under the figure is what a screen reader reads.
  const cross = node("div", "an-cross");
  const dot = node("div", "an-dot");
  const tip = node("div", "an-tip");
  [cross, dot, tip].forEach((n) => { n.setAttribute("aria-hidden", "true"); n.hidden = true; plot.appendChild(n); });
  const show = (i) => {
    const left = `${(i / (daily.length - 1)) * 100}%`;
    cross.style.left = left;
    dot.style.left = left;
    dot.style.top = `${(1 - values[i] / top) * 100}%`;
    tip.style.left = left;
    tip.style.top = "-0.5rem";
    tip.style.transform = `translate(${i > daily.length * 0.8 ? "-100%" : i < daily.length * 0.2 ? "0" : "-50%"}, -100%)`;
    only(tip, node("div", "font-semibold text-brand-text", dayLabel(daily[i].day)),
      node("div", "text-brand-muted", `${count(values[i])} ${noun}`));
    [cross, dot, tip].forEach((n) => { n.hidden = false; });
  };
  plot.addEventListener("pointermove", (e) => {
    const box = plot.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (daily.length - 1));
    show(Math.min(daily.length - 1, Math.max(0, i)));
  });
  plot.addEventListener("pointerleave", () => { [cross, dot, tip].forEach((n) => { n.hidden = true; }); });

  const axis = node("div", "an-xaxis");
  axis.setAttribute("aria-hidden", "true");
  const mid = Math.floor((daily.length - 1) / 2);
  [0, mid, daily.length - 1].forEach((i) => axis.appendChild(node("span", "", dayLabel(daily[i].day))));

  const peak = values.reduce((a, v, i) => (v > values[a] ? i : a), 0);
  const figure = node("figure");
  const caption = node("figcaption", "mt-3 text-xs text-brand-muted",
    `${dayLabel(daily[0].day)} to ${dayLabel(daily[daily.length - 1].day)}. `
    + `Busiest day ${dayLabel(daily[peak].day)}, ${count(values[peak])} ${noun}.`);
  figure.append(plot, axis, caption,
    srTable(shown === "visitors" ? "Unique visitors per day" : "Views per day",
      daily.map((d, i) => [dayLabel(d.day), `${count(values[i])} ${noun}`])));
  only(host, head, figure);
}

/**
 * Day of week against hour, as a grid of cells rather than a chart.
 *
 * It borrows `.contrib-day` and therefore the exact colour ramp the contribution grids on /code/
 * and the Admin home use. One ramp in one place is the point: three grids that each invented
 * their own green would be three different meanings for the same shade.
 *
 * The scale is relative to the busiest single cell in the window, not to a fixed number of views,
 * so a quiet week and a busy one are each readable - the question a heatmap answers is "when",
 * not "how many", and the table underneath carries the counts for anyone who wants them.
 */
function heatmap(hours) {
  const host = el("heatmap");
  const total = hours.reduce((n, h) => n + h.views, 0);
  if (!total) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }

  const cells = new Map(hours.map((h) => [`${h.dow}:${h.hour}`, h.views]));
  const max = Math.max(...hours.map((h) => h.views));

  const figure = node("figure");
  const rows = node("div", "space-y-[2px] overflow-x-auto");
  for (let d = 0; d < 7; d += 1) {
    const row = node("div", "flex items-center gap-2");
    row.appendChild(node("span", "w-8 shrink-0 text-xs text-brand-muted", DOW_SHORT[d]));
    const grid = node("div", "hours min-w-[16rem] flex-1");
    for (let h = 0; h < 24; h += 1) {
      const views = cells.get(`${d}:${h}`) || 0;
      const cell = node("div", "contrib-day");
      // Five steps, and a day with nothing on it keeps level 0 rather than being given the
      // faintest green - the ramp's own comment says an empty cell has to read as an absence.
      if (views) cell.setAttribute("data-level", String(Math.min(4, Math.ceil((views / max) * 4))));
      // A native tooltip for a pointer, the same as the chart's <title> elements. The table below
      // is what a screen reader reads; this is for the mouse.
      cell.title = `${DOW[d]} ${String(h).padStart(2, "0")}:00 UTC - ${count(views)} views`;
      grid.appendChild(cell);
    }
    row.appendChild(grid);
    rows.appendChild(row);
  }

  // A key, because a sequential ramp without one is five shades of nothing: the cells say which
  // hours are busier than which, and nothing on the page said darker meant more until this line.
  // Both ends are labelled rather than every step - the exact bin boundaries are arithmetic
  // nobody needs, and the busiest cell's own count is in the caption below.
  const key = node("div", "mt-3 flex items-center gap-2 text-xs text-brand-muted");
  const ramp = node("div", "flex gap-[2px]");
  [0, 1, 2, 3, 4].forEach((level) => {
    const swatch = node("div", "contrib-day h-3 w-3");
    if (level) swatch.setAttribute("data-level", String(level));
    ramp.appendChild(swatch);
  });
  key.append(node("span", "", "Quieter"), ramp,
    node("span", "", `Busier (${count(max)} views)`));

  const busiest = hours.reduce((a, b) => (b.views > a.views ? b : a));
  const caption = node("figcaption", "mt-3 text-sm text-brand-muted",
    `Busiest hour: ${DOW[busiest.dow]} at ${String(busiest.hour).padStart(2, "0")}:00 UTC, `
    + `${count(busiest.views)} views. Hours run 00 to 23 left to right.`);

  // One row per day rather than 168, because a screen reader reading "Monday 00:00, 0 views"
  // 168 times is a worse answer than the picture it is standing in for.
  const table = srTable("Views by day of week and hour, UTC",
    DOW.map((name, d) => {
      const busiestHour = Array.from({ length: 24 }, (_, h) => [h, cells.get(`${d}:${h}`) || 0])
        .reduce((a, b) => (b[1] > a[1] ? b : a));
      const dayTotal = Array.from({ length: 24 }, (_, h) => cells.get(`${d}:${h}`) || 0)
        .reduce((n, v) => n + v, 0);
      return [name, `${count(dayTotal)} views`,
        dayTotal ? `busiest at ${String(busiestHour[0]).padStart(2, "0")}:00 UTC` : "none"];
    }),
    ["Day", "Views", "Busiest hour"]);

  figure.append(rows, key, caption, table);
  only(host, figure);
}

/**
 * One dimension: the leader in a sentence, then every value as a bar.
 *
 * **There was a donut here and it was wrong twice over.** It coloured six nominal categories -
 * Chrome, Safari, Firefox - as six steps of one hue's opacity, which is a value ramp doing a
 * category's job: it double-encodes the length the bars below already show, and it spends the
 * one free channel on information the reader has. And a ring is the wrong form for the question
 * anyway. "Which is the big one" is a length comparison, and lengths from a common baseline are
 * read far more accurately than angles - which is exactly what the bar list underneath was
 * already doing, one row per value, with the numbers on them.
 *
 * So the ring went and nothing replaced it. The lead line carries the part-to-whole ("Chrome
 * leads, 60% of 100 views") because that is the one proportion worth stating, and the bars carry
 * the comparison. One colour for every bar, because these categories have no order and nothing
 * about Firefox is a darker green than Safari.
 */
function dimension(list, title) {
  const card = node("div", "");
  card.appendChild(node("h3", "sr-only", title));

  const total = list.reduce((n, r) => n + r.views, 0);
  if (!total) {
    card.appendChild(node("p", "hint mt-1", "Nothing counted in this window yet."));
    return card;
  }

  const named = (r) => (title === "Window width" ? label(SCREEN, r.value) : r.value);
  const top1 = list[0];
  card.append(
    node("p", "hint mt-1", `${named(top1)} leads, ${pct(top1.views / total)} of ${count(total)} views.`),
    barList(list.map((r) => [named(r), r.views])),
    srTable(title, list.map((r) => [named(r), `${count(r.views)} views`,
      pct(r.views / total)]), [title, "Views", "Share"]),
  );
  return card;
}

/**
 * A row of tabs over a set of panels, built here rather than in the template because the panels
 * are. Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects.
 */
let tabSeq = 0;
function tabs(label, items) {
  const bar = node("div", "an-tabs");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", label);
  const buttons = [];
  const panels = [];
  items.forEach(([name, content], i) => {
    const id = `antab${(tabSeq += 1)}`;
    const b = node("button", "an-tab", name);
    b.setAttribute("type", "button");
    b.setAttribute("role", "tab");
    b.setAttribute("id", id);
    b.setAttribute("aria-selected", i === 0 ? "true" : "false");
    if (i) b.setAttribute("tabindex", "-1");
    const panel = node("div", "");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", id);
    panel.hidden = i !== 0;
    panel.appendChild(content);
    buttons.push(b);
    panels.push(panel);
    bar.appendChild(b);
  });
  const select = (k) => buttons.forEach((b, i) => {
    b.setAttribute("aria-selected", i === k ? "true" : "false");
    if (i === k) b.removeAttribute("tabindex"); else b.setAttribute("tabindex", "-1");
    panels[i].hidden = i !== k;
  });
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => select(i));
    b.addEventListener("keydown", (e) => {
      const k = e.key === "ArrowRight" ? (i + 1) % buttons.length
        : e.key === "ArrowLeft" ? (i - 1 + buttons.length) % buttons.length : -1;
      if (k >= 0) { select(k); buttons[k].focus(); }
    });
  });
  return { bar, panels };
}

/** The four device dimensions, one tab each. */
function agents(data) {
  const { bar, panels } = tabs("Devices", DIMENSIONS.map(([key, title]) =>
    [title === "Operating system" ? "OS" : title === "Window width" ? "Width" : title,
      dimension(data[key] || [], title)]));
  const wrap = node("div", "");
  const head = node("div", "mt-2");
  head.appendChild(bar);
  wrap.append(head, ...panels);
  only(el("agents"), wrap);
}

/** Where page views came from, as flags and English names. */
function countries(list) {
  const host = el("countries");
  const total = list.reduce((n, r) => n + r.views, 0);
  if (!total) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }
  const rows = list.map((r) => [
    r.value === "unknown" ? "Unknown" : `${flag(r.value)} ${countryName(r.value)}`, r.views]);
  only(host, barList(rows), srTable("Countries", list.map((r) => [countryName(r.value),
    `${count(r.views)} views`, pct(r.views / total)]), ["Country", "Views", "Share"]));
}

/** Where visits began, and where they stopped. Two lists of the same shape, side by side. */
function journeys(entryPages, exitPages) {
  const grid = node("div", "grid gap-4 sm:grid-cols-2");
  [["Entry pages", entryPages], ["Exit pages", exitPages]].forEach(([title, list]) => {
    const col = node("div", "");
    col.appendChild(node("h3", "mt-3 text-xs font-semibold uppercase tracking-wide text-brand-muted", title));
    if (!list.length) {
      col.appendChild(node("p", "mt-2 text-sm text-brand-muted", "Nothing counted in this window yet."));
    } else {
      col.append(
        capped(list.map((r) => [r.path, r.visits]), "visits"),
        srTable(title, list.map((r) => [r.path, `${count(r.visits)} visits`,
          label(PROPERTY, r.property)]), ["Page", "Visits", "Site"]),
      );
    }
    grid.appendChild(col);
  });
  only(el("journeys"), grid);
}

/**
 * The last twenty visits.
 *
 * A real table and not an sr-only one, because this is a list of rows and a list of rows is what
 * a table is for. It carries no visitor number: the question is what a visit read and for how
 * long, and the handle that joins two visits together is not part of that question - which is
 * also why the API does not send one.
 */
function recentVisits(list) {
  const host = el("recent");
  if (!list.length) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }
  const card = node("div", "overflow-x-auto");
  const table = node("table", "w-full text-sm");
  const head = node("thead", "text-left text-xs uppercase tracking-wide text-brand-muted");
  const hr = node("tr");
  ["When", "Site", "Entered", "Left", "Pages", "Length", "Reading on"].forEach((h) => {
    const th = node("th", "py-2 pr-4 font-semibold", h);
    th.setAttribute("scope", "col");
    hr.appendChild(th);
  });
  head.appendChild(hr);

  const body = node("tbody", "divide-y divide-brand-border");
  list.forEach((v) => {
    const tr = node("tr");
    [
      stamp(v.started),
      label(PROPERTY, v.property),
      v.entry,
      // An exit equal to the entry on a one-page visit is not a second fact, it is the same one.
      v.views > 1 ? v.exit : "—",
      count(v.views),
      // The caveat, per row: a one-page visit has nothing to measure between.
      v.views > 1 ? clock(v.seconds) : "—",
      [v.browser, v.os, v.device].filter(Boolean).join(" · "),
    ].forEach((cell) => tr.appendChild(node("td", "py-2 pr-4 align-top text-brand-text", cell)));
    body.appendChild(tr);
  });

  table.append(head, body);
  card.appendChild(table);
  only(host, card);
}

/**
 * Every page read, busiest first. With both sites selected each row says which one it belongs to,
 * because "/" on the site and "/" in the app are different pages that print the same.
 */
function paths(topPaths, byProperty) {
  const host = el("paths");
  if (!topPaths.length) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }
  const both = new Set(topPaths.map((p) => p.property)).size > 1;
  const rows = [...topPaths].sort((a, b) => b.views - a.views)
    .map((r) => [r.path, r.views, both ? label(PROPERTY_HOST, r.property) : ""]);
  const split = byProperty.map((p) => `${label(PROPERTY, p.property)} ${count(p.views)}`).join(" · ");
  only(host,
    node("p", "an-panel-hint", split ? `Views by site: ${split}.` : ""),
    capped(rows),
    srTable("Which pages are read", topPaths.map((r) => [r.path, `${count(r.views)} views`,
      label(PROPERTY, r.property)]), ["Page", "Views", "Site"]));
}

function referrers(list) {
  const host = el("referrers");
  if (!list.length) {
    nothing(host, "Nothing counted in this window yet.");
    return;
  }
  const card = node("div", "");
  // A null host is a real and common answer - somebody typed the address, or the browser was
  // told not to send a referrer. Calling it "direct" and leaving it at that would claim more
  // than is known, so the row says both.
  const rows = list.map((r) => [r.host || "Direct, or no referrer sent", r.views]);
  card.append(barList(rows), srTable("Where readers came from",
    rows.map(([name, views]) => [name, `${count(views)} views`]), ["Referrer", "Views"]));
  only(host, card);
}

/**
 * A figure against the same figure in the window before it.
 *
 * Four sentences, because a percentage is only meaningful when there is something to be a
 * percentage of. Dividing by a previous window of nought gives Infinity, and "+∞%" of nothing is
 * the kind of figure that ends up in a slide.
 */
function against(now, before, noun) {
  if (!now && !before) return `Nothing counted in either window.`;
  if (!before) return `Nothing in the window before this one.`;
  const change = Math.round(((now - before) / before) * 100);
  return `${change > 0 ? "+" : ""}${change}% against ${count(before)} ${noun} before.`;
}

function render(data) {
  const totals = data.totals || {};
  const range = data.range || {};
  const views = totals.views || 0;
  const visits = totals.visits || 0;
  const visitors = totals.visitors || 0;
  // Not `window`: this file runs in a browser and shadowing that name inside the one function
  // that draws everything is a trap set for whoever adds the next line.
  const span = range.from && range.to
    ? `${dateLabel(range.from)} to ${dateLabel(range.to)}.` : "In this window.";

  stat("views", views ? count(views) : "None yet",
    views ? `${span} ${against(views, totals.previousViews || 0, "views")}` : span);
  stat("visitors", visitors ? count(visitors) : "None yet",
    visitors ? against(visitors, totals.previousVisitors || 0, "browsers")
      : "Browsers, counted once a day each.");
  stat("visits", visits ? count(visits) : "None yet",
    visits ? "A gap of 30 minutes starts a new one."
      : "No page view in this window carries a visitor number.");

  const live = data.live || {};
  stat("live", count(live.visitors || 0),
    live.visitors
      ? `${count(live.views || 0)} views in the last five minutes.`
      : "Nobody in the last five minutes.");

  // **These three are drawn only when there are visits to derive them from.** A bounce rate of
  // 0% over no visits is not a good bounce rate, it is an absence wearing a number, and the same
  // goes for an average visit of 0s. The em dash is the panel saying it does not know, which is
  // the rule the rest of this page already follows.
  if (visits) {
    stat("perVisit", (totals.viewsPerVisit || 0).toFixed(1), "Pages read before leaving.");
    stat("bounce", pct(totals.bounceRate || 0),
      `${count(Math.round((totals.bounceRate || 0) * visits))} of ${count(visits)} visits read one page.`);
    stat("duration", clock(totals.durationSeconds || 0),
      "Bounces count as zero, so this reads low. See the note above.");
  } else {
    ["perVisit", "bounce", "duration"].forEach((id) => {
      stat(id, "—", "Needs at least one visit to derive.");
    });
  }

  const linkedin = data.fromLinkedIn || 0;
  stat("linkedin", linkedin ? count(linkedin) : "None yet",
    linkedin && views ? `${pct(linkedin / views)} of views in this window.`
      : "No view in this window arrived from LinkedIn.");

  // **The fifth caveat, and the same figure means three different things.** It is written here
  // rather than in the template because only the window can say which.
  //
  //   * a view counted BEFORE the visitor number existed. The counter shipped at 00:03 on
  //     18 September 2026 and the column at 02:58, so just under three hours of real page views
  //     have no number and never will. Ordinary history, not a fault.
  //   * past 30 days, the erasure has run. The promise in /privacy/ working.
  //   * anything else is the alarm: a request that arrived with no address, which is what a
  //     wrong `trust proxy` looks like - and the alternative failure is worse and silent, every
  //     visitor hashing to the proxy and the chart showing one extremely loyal reader.
  //
  // **The first case was what shipped, and this note accused the deployment of the third.** On
  // the morning it went live the panel read "52% of views carry no visitor number, which inside
  // a 30-day window means the request arrived with no address" - true of the case imagined and
  // false of the case that happened. A smoke alarm that cries wolf on day one is one nobody
  // reads again, so the window is compared against the hour the column landed rather than
  // assuming every window starts after it.
  const IDENTIFIED_SINCE = Date.parse("2026-09-18T02:58:00Z");
  const missing = data.unidentified || 0;
  const note = el("unidentifiedNote");
  const from = Date.parse(range.from || "");
  const share = views ? pct(missing / views) : "";

  if (!views || !missing) {
    note.textContent = "";
  } else if ((range.days || 0) > 30) {
    note.textContent = `${share} of views in this window carry no visitor number. This window `
      + `reaches past 30 days, so those are views whose number has been erased: the counts `
      + `survive and the link between them does not. Visits and the rates below them are derived `
      + `from the rest.`;
  } else if (Number.isFinite(from) && from < IDENTIFIED_SINCE) {
    note.textContent = `${share} of views in this window carry no visitor number, and this `
      + `window reaches back before 18 September 2026, when the number was added. Those are `
      + `page views counted before there was anything to count people with. Nothing is wrong, `
      + `and the share falls on its own as the window moves past that day.`;
  } else {
    note.textContent = `${share} of views in this window carry no visitor number. Every view in `
      + `this window was counted after the number existed, so this should be near nought: a `
      + `figure that is not means requests are arriving with no address, and every visitor count `
      + `on this page is wrong in the same direction.`;
  }

  lastData = data;
  chart(data.daily || []);
  heatmap(data.hours || []);
  countries(data.byCountry || []);
  agents(data);
  paths(data.topPaths || [], data.byProperty || []);
  journeys(data.entryPages || [], data.exitPages || []);
  referrers(data.referrers || []);
  recentVisits(data.recent || []);
}

const FIGURES = ["visitors", "visits", "views", "live", "perVisit", "bounce", "duration", "linkedin"];
const PANELS = ["chart", "heatmap", "agents", "countries", "paths", "journeys", "referrers", "recent"];

/** Every panel says why it is empty, rather than each one quietly drawing nothing. */
function unavailable(message) {
  FIGURES.forEach((id) => {
    el(id).textContent = "—";
    el(id).setAttribute("data-loading", "");
    el(id + "Note").textContent = "";
  });
  el("unidentifiedNote").textContent = "";
  PANELS.forEach((id) => nothing(el(id), message));
}

// A slow answer for 365 days must not land after a fast answer for 7 and overwrite it. The same
// guard profile.js uses: only the most recent request is allowed to draw.
let sequence = 0;

async function load() {
  const mine = ++sequence;
  say("Loading…");
  try {
    const query = new URLSearchParams({
      days: el("range").value,
      property: el("property").value,
    });
    const data = await api("/admin/analytics?" + query);
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
  ["range", "property"].forEach((id) => el(id).addEventListener("change", load));

  // Visitors and Views choose what the chart draws; the choice survives a change of window.
  const pickers = [...document.querySelectorAll("[data-metric]")];
  pickers.forEach((b) => b.addEventListener("click", () => {
    metric = b.getAttribute("data-metric");
    pickers.forEach((p) => p.setAttribute("aria-pressed", p === b ? "true" : "false"));
    if (lastData) chart(lastData.daily || []);
  }));

  // The Pages card's two tabs are in the template, so they are wired here.
  const pageTabs = [el("tab-paths"), el("tab-journeys")];
  const pick = (k) => pageTabs.forEach((t, i) => {
    t.setAttribute("aria-selected", i === k ? "true" : "false");
    if (i === k) t.removeAttribute("tabindex"); else t.setAttribute("tabindex", "-1");
    el(t.getAttribute("aria-controls")).hidden = i !== k;
  });
  pageTabs.forEach((t, i) => {
    t.addEventListener("click", () => pick(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { pick(1 - i); pageTabs[1 - i].focus(); }
    });
  });

  load();
});
