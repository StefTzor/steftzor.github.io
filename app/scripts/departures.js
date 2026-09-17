import { api, profile } from "./shell.js";

/**
 * The next few buses from home, on the home view.
 *
 * It does NOT poll. The API caches for 45 seconds, and the whole deployment shares 100 requests
 * per 15 minutes - a tab left open on a 60-second timer would spend a sixth of that on nobody
 * reading it. Instead it loads once, refreshes when you come back to the tab and what is on
 * screen has gone stale, and refreshes when asked.
 *
 * The card starts hidden and stays hidden if there is nothing to show. A card that announces
 * itself and then says it knows nothing is worse than no card at all.
 */

const el = (id) => document.getElementById(id);
const STALE_AFTER_MS = 2 * 60 * 1000;
const SHOW = 5;

let fetchedAt = 0;

/** "now", "1 min", "12 min" - the only three shapes a departure board needs. */
function inWords(minutes) {
  if (minutes <= 0) return "now";
  return `${minutes} min`;
}

/** ResRobot repeats the municipality: "Portalgatan (Uppsala) (Uppsala kn)". Once is enough. */
function shortStop(name) {
  return String(name || "").replace(/\s*\([^)]*kn\)\s*$/i, "").trim();
}

/** The destination, without the city it is already obvious we are in. */
function shortTowards(towards) {
  return String(towards || "").replace(/^Uppsala\s+/i, "");
}

function render(data) {
  const list = el("depList");
  list.textContent = "";

  const next = data.departures.slice(0, SHOW);
  if (!next.length) {
    el("depNote").textContent = "Nothing leaving in the next hour.";
    return;
  }
  el("depNote").textContent = "";

  next.forEach((d) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-3 py-2 first:pt-0 last:pb-0";

    const line = document.createElement("span");
    line.className = "dep-line";
    line.textContent = d.line;

    const towards = document.createElement("span");
    towards.className = "flex-1 truncate text-sm text-brand-text";
    towards.textContent = shortTowards(d.towards);

    const when = document.createElement("span");
    when.className = "shrink-0 text-sm font-semibold tabular-nums text-brand-text";
    when.textContent = inWords(d.inMinutes);

    li.append(line, towards);

    // A delay is the one thing on this card worth interrupting for, so it is said in words
    // beside the time rather than encoded in the colour of the number.
    if (d.delayMinutes > 0) {
      const late = document.createElement("span");
      late.className = "shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-300";
      late.textContent = `${d.delayMinutes} late`;
      li.appendChild(late);
    }
    if (d.cancelled) {
      const off = document.createElement("span");
      off.className = "shrink-0 text-xs font-semibold text-red-700 dark:text-red-300";
      off.textContent = "cancelled";
      li.appendChild(off);
    }

    li.appendChild(when);
    list.appendChild(li);
  });

  el("depStop").textContent = shortStop(data.stop);
  // Stale is said, not hidden: a departure board that is two minutes old is a departure board
  // that is wrong, and the reader is the one who should decide whether that matters.
  el("depAge").textContent = data.stale ? " · last known" : "";
  el("departures").classList.remove("hidden");
}

async function load(refreshButton) {
  if (refreshButton) refreshButton.disabled = true;
  try {
    const data = await api("/departures");
    fetchedAt = Date.now();
    render(data);
  } catch (err) {
    console.error("departures:", err.status, err.code);
    // Configured-but-broken is worth saying once the card is already on screen; never
    // configured at all means this deployment has no key, and the card stays away entirely.
    if (el("departures").classList.contains("hidden")) return;
    el("depNote").textContent = err.code === "no_such_stop"
      ? "That stop could not be found."
      : "Departures could not be loaded.";
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

profile.then(() => {
  if (!el("departures")) return;
  el("depRefresh").addEventListener("click", (e) => load(e.currentTarget));

  // Coming back to the tab with something stale on screen is the one moment a refresh is
  // obviously wanted and obviously cheap.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - fetchedAt > STALE_AFTER_MS) load();
  });

  load();
});
