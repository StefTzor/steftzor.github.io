import { profile, api, API_BASE } from "./shell.js";
import { el, say } from "./admin-status.js";
import { pendingAccounts, unreadMessages } from "./queues.js";

/**
 * Admin -> Overview: what is waiting for you, and what is running.
 *
 * Every number on this page is fetched. Nothing is inferred and nothing is placeholder data -
 * a figure on an overview is trusted precisely because it is never decorative, and one invented
 * sparkline would cost the rest of the screen its credibility.
 *
 * The four blocks load independently on purpose. The accounts list being unavailable must not
 * stop the message count, and neither must stop the service checks, which are the very things
 * you would come here to read when something is wrong.
 */

/** A count lands in a slot that is already the right size, so nothing below it moves. */
function setCount(id, noteId, value, note) {
  const box = el(id);
  box.textContent = value;
  box.removeAttribute("data-loading");
  el(noteId).textContent = note;
}

function setUnavailable(id, noteId, why) {
  const box = el(id);
  box.textContent = "—";
  box.removeAttribute("data-loading");
  el(noteId).textContent = why;
}

/** Waiting for approval. The link goes to the queue; the number says whether to bother. */
async function loadPending() {
  try {
    const pending = await pendingAccounts();
    setCount("pendingCount", "pendingNote", String(pending),
      pending === 0 ? "Nothing to approve"
        : pending === 1 ? "1 account is waiting"
        : `${pending} accounts are waiting`);
  } catch (err) {
    console.error("overview: accounts failed", err.status);
    setUnavailable("pendingCount", "pendingNote",
      err.status === 403 ? "You may not manage accounts" : "The account list is unavailable");
  }
}

/**
 * Unread messages.
 *
 * Counted from the first page only, which is why the note says "on the first page" when the
 * server tells us there are older ones. A number that silently means "of the ones I happened to
 * look at" is worse than no number: it reads as a total and is not one.
 */
async function loadUnread() {
  try {
    const { count: unread, more } = await unreadMessages();
    setCount("unreadCount", "unreadNote", String(unread),
      more ? "On the most recent page"
        : unread === 0 ? "Nothing unread"
        : unread === 1 ? "1 message to read"
        : `${unread} messages to read`);
  } catch (err) {
    console.error("overview: messages failed", err.status);
    setUnavailable("unreadCount", "unreadNote",
      err.status === 404 ? "The message database is not configured" : "Messages are unavailable");
  }
}

/** "3 hours ago", for a moment in the past. Empty when the input is not a date. */
function since(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function setState(id, tone, label) {
  const pill = el(id);
  pill.textContent = label;
  pill.className = "status-pill status-pill--" + tone;
}

/**
 * The two services this page can actually check.
 *
 * /health is unauthenticated by design and answers with the time the process started, so a
 * restart is visible rather than merely assumed. It is fetched directly rather than through
 * api(), which would attach a token to a public endpoint and would fail before it ever reported
 * the thing that is wrong - "the API is down" is exactly the answer this card exists to give.
 */
async function loadApi() {
  try {
    const res = await fetch(API_BASE + "/health", { cache: "no-store" });
    if (!res.ok) throw new Error("health " + res.status);
    const { startedAt } = await res.json();
    setState("apiState", "up", "Up");
    const ago = since(startedAt);
    el("apiDetail").textContent = ago ? `Running since ${ago}` : "Running";
  } catch (err) {
    console.error("overview: api health failed", err.message);
    setState("apiState", "down", "Unreachable");
    el("apiDetail").textContent = "The health check did not answer.";
  }
}

/** This app's own deploy stamp. Same origin, so it needs nothing and cannot be blocked. */
async function loadApp() {
  try {
    const res = await fetch("/build.txt", { cache: "no-store" });
    if (!res.ok) throw new Error("build " + res.status);
    const ago = since((await res.text()).trim());
    setState("appState", "up", "Up");
    el("appDetail").textContent = ago ? `Deployed ${ago}` : "Deployed";
  } catch (err) {
    console.error("overview: build stamp failed", err.message);
    // The page you are reading was served, so "down" would be plainly untrue. Only the stamp
    // is missing, and the card should say the thing that is actually unknown.
    setState("appState", "unknown", "Serving");
    el("appDetail").textContent = "The build stamp could not be read.";
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Traffic: the one figure that means something without a window, and seven days of shape.
 *
 * Every other number on /admin/analytics/ belongs to a window somebody chose, and lifting one out
 * of that window is how a dashboard ends up asserting something nobody measured. "Views in the
 * last five minutes" is different: the window is in the name.
 *
 * The line beside it has no axis and no scale, deliberately. It is there to answer "is this
 * normal for a week" at a glance, and a sparkline with a number on it is a chart pretending to
 * be readable at 12rem wide. The counts are one click away, which is what the card is.
 */
function sparkline(daily) {
  const host = el("spark");
  host.textContent = "";
  if (daily.length < 2) return;
  const max = Math.max(...daily.map((d) => d.views));
  if (!max) return;

  const W = 100;
  const H = 28;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "w-full h-7 text-brand-accent");
  // Hidden from assistive technology and not labelled, because it says nothing the sentence
  // below it does not: the note carries the seven-day total in words.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const pts = daily.map((d, i) => [
    (i / (daily.length - 1)) * W,
    H - 2 - (d.views / max) * (H - 4),
  ]);
  const line = document.createElementNS(SVG_NS, "polyline");
  line.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  // The viewBox is stretched to whatever width the card gives it, so without this the stroke is
  // stretched with it and the line reads as a different weight on every screen size.
  line.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(line);
  host.appendChild(svg);
}

async function loadTraffic() {
  try {
    const data = await api("/admin/analytics?days=7");
    const live = data.live || {};
    setCount("liveNow", "liveNowNote", String(live.visitors || 0),
      live.visitors
        ? `${live.views} view${live.views === 1 ? "" : "s"} in the last five minutes`
        : "Nobody in the last five minutes");
    const daily = data.daily || [];
    sparkline(daily);
    const week = daily.reduce((n, d) => n + d.views, 0);
    if (week) {
      el("liveNowNote").textContent += ` · ${week.toLocaleString()} views this week`;
    }
  } catch (err) {
    console.error("overview: traffic failed", err.status);
    setUnavailable("liveNow", "liveNowNote",
      err.status === 404 ? "The counter is not configured"
        : err.status === 403 ? "You may not read the counts"
        : "The counts are unavailable");
  }
}

profile.then(() => {
  say("");
  loadPending();
  loadUnread();
  loadApi();
  loadApp();
  loadTraffic();
});
