/**
 * GitHub contribution calendar, fetched at build time.
 *
 * This used to be a client-side widget: a script from unpkg, a stylesheet from unpkg, and a
 * proxy on api.bloggify.net, which meant every visitor's IP reached two third parties to draw
 * one chart. It also broke silently — the widget was written for the SVG GitHub used to serve
 * and GitHub now returns a table, so the page's styling applied to nothing for months.
 *
 * Fetching here instead means only the build machine talks to GitHub, the markup is ours, and
 * the data can only go stale between deploys — which is when the numbers change anyway, since
 * a deploy is triggered by a push.
 *
 * A failed fetch must never fail the build: a transient GitHub blip during a deploy would
 * otherwise take the whole site down. It returns null and the page renders a link instead.
 */

const USER = "steftzor";
const SOURCE = `https://github.com/users/${USER}/contributions`;

module.exports = async function () {
  let html;
  try {
    const res = await fetch(SOURCE, {
      headers: { "User-Agent": "tzortzoglou.eu build" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn(`[contributions] ${err.message} — the page will link to the profile instead.`);
    return null;
  }

  // Counts live in <tool-tip for="cell-id">, not in the cell, so index them first.
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g)) {
    tips.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }

  const days = [];
  for (const m of html.matchAll(/<td\b([^>]*\bdata-date="[^"]*"[^>]*)>/g)) {
    const attr = (name) => (m[1].match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
    const date = attr("data-date");
    const label = tips.get(attr("id")) || "";
    const count = Number((label.match(/^(\d+)\s+contribution/) || [])[1] || 0);
    days.push({ date, level: Number(attr("data-level") || 0), count, label });
  }
  if (!days.length) {
    console.warn("[contributions] no day cells found — GitHub's markup may have changed again.");
    return null;
  }

  days.sort((a, b) => a.date.localeCompare(b.date));

  // Rebuild the grid from the dates rather than trusting GitHub's cell order: columns are
  // weeks, rows are weekdays, and a leading partial week is padded so rows stay aligned.
  const weeks = [];
  let week = new Array(new Date(days[0].date + "T00:00:00Z").getUTCDay()).fill(null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push([...week, ...new Array(7 - week.length).fill(null)]);

  const total = days.reduce((sum, d) => sum + d.count, 0);

  // One label per month, placed on the week where that month first appears.
  const months = weeks.map((w, i) => {
    const first = w.find(Boolean);
    if (!first) return null;
    const m = first.date.slice(0, 7);
    const prev = i && weeks[i - 1].find(Boolean)?.date.slice(0, 7);
    return m === prev ? null : new Date(first.date + "T00:00:00Z")
      .toLocaleString("en", { month: "short", timeZone: "UTC" });
  });

  return { weeks, months, total, from: days[0].date, to: days[days.length - 1].date, profile: `https://github.com/${USER}` };
};
