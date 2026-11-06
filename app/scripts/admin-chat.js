import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin -> Chat: a week of chat outcomes, then the recent traces. Text only, never innerHTML: the
 * question column was typed by strangers. A figure with nothing behind it is an em dash, because a
 * nought would claim something was measured.
 */

const NONE = "—";
const OUTCOME = new Map([
  ["done", "Answered"], ["owner", "Fixed lines"], ["tool", "Live tool"], ["cache", "From cache"],
  ["memory", "Memory reply"], ["miss", "Not in the facts"], ["denied", "Denied"], ["blocked", "Blocked"],
  ["rejected", "Answer rejected"], ["busy", "Busy"], ["resting", "Resting"], ["stopped", "Stopped"],
]);

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const pct = (n) => (typeof n === "number" ? `${Math.round(n * 100)}%` : NONE);
const secs = (ms) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : NONE);
const outcome = (key) => OUTCOME.get(key) || key;

function when(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : NONE;
}

function renderSummary(s) {
  const figures = [["chatTotal", s.total.toLocaleString()], ["chatMedian", secs(s.medianMs)], ["chatWorst", secs(s.worstMs)],
    ["chatCache", pct(s.cacheRate)], ["chatFallBack", pct(s.fallBackRate)], ["chatRefusal", pct(s.refusalRate)]];
  figures.forEach(([id, text]) => {
    el(id).textContent = text;
    el(id).removeAttribute("data-loading");
  });

  const list = el("chatOutcomes");
  list.textContent = "";
  if (!s.outcomes.length) {
    list.appendChild(node("div", "text-brand-muted", "No questions in the last 7 days."));
    return;
  }
  s.outcomes.forEach((o) => {
    const row = node("div", "flex justify-between gap-3");
    row.appendChild(node("dt", "text-brand-muted", outcome(o.outcome)));
    row.appendChild(node("dd", "font-semibold tabular-nums text-brand-text", o.count.toLocaleString()));
    list.appendChild(row);
  });
}

function renderTraces(traces) {
  const body = el("chatTraces");
  body.textContent = "";
  if (!traces.length) {
    const row = node("tr");
    const cell = node("td", "px-3 py-3 text-brand-muted", "No traces yet.");
    cell.setAttribute("colspan", "8");
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }
  traces.forEach((t) => {
    const row = node("tr");
    row.appendChild(node("td", "px-3 py-2 whitespace-nowrap tabular-nums text-brand-muted", when(t.at)));
    row.appendChild(t.question === null
      ? node("td", "px-3 py-2 min-w-[16rem] text-brand-muted", "Not kept")
      : node("td", "px-3 py-2 min-w-[16rem] break-words text-brand-text", t.question));
    row.appendChild(node("td", "px-3 py-2 font-mono text-xs text-brand-muted", t.route || NONE));
    row.appendChild(node("td", "px-3 py-2 whitespace-nowrap text-brand-text", outcome(t.outcome)));
    row.appendChild(node("td", "px-3 py-2 font-mono text-xs text-brand-muted", t.tool || NONE));
    [t.msTotal, t.msEmbed, t.msModel].forEach((ms) => {
      row.appendChild(node("td", "px-3 py-2 text-right whitespace-nowrap tabular-nums text-brand-muted", secs(ms)));
    });
    body.appendChild(row);
  });
}

profile.then(async () => {
  say("");
  try {
    const [summary, list] = await Promise.all([api("/admin/chat/summary"), api("/admin/chat/traces")]);
    renderSummary(summary);
    renderTraces(list.traces);
  } catch (err) {
    console.error("chat traces:", err.status, err.code);
    say(err.status === 404
      ? "Chat traces need the API's database, which is not configured."
      : "Chat traces could not be loaded.", "error");
  }
});
