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

/**
 * The destination, exactly as ResRobot gives it.
 *
 * This used to strip a leading "Uppsala ", which made "Uppsala Hågavägen" read as "Hågavägen"
 * and lost information for no gain. What ResRobot calls `direction` is documented as "name of
 * the last stop on the vehicle's trip" - so it is a stop name, not the destination an operator
 * puts on the front of the bus. UL's own app shows "Eriksberg Håga" because that is UL's
 * headsign, which this upstream does not carry at all.
 */
function towardsOf(towards) {
  return String(towards || "").trim();
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
    towards.textContent = towardsOf(d.towards);

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

// --- choosing a stop ----------------------------------------------------------

function pickNote(text) { el("depPickNote").textContent = text || ""; }

/** The search results, as buttons. createElement and textContent: these names come from upstream. */
function renderResults(stops) {
  const list = el("depResults");
  list.textContent = "";
  if (!stops.length) { pickNote("No stop matches that."); return; }
  pickNote("");
  stops.forEach((stop) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "w-full rounded px-2 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg";
    btn.textContent = stop.name;
    btn.addEventListener("click", () => choose(stop));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

/**
 * Save the stop, then reload the board.
 *
 * Saved to the profile rather than to this browser, because the board is drawn from the profile
 * on the server - storing the choice locally would mean the page and the API disagreed about
 * which stop this is.
 */
async function choose(stop) {
  pickNote("Saving…");
  try {
    await api("/me/profile", {
      method: "POST",
      body: JSON.stringify({ homeStop: { id: stop.id, name: stop.name } }),
    });
    closePicker();
    await load();
  } catch (err) {
    console.error("departures: could not save the stop", err.status, err.code);
    pickNote(err.code === "bad_stop" ? "That stop could not be saved." : "That could not be saved.");
  }
}

function openPicker() {
  el("depPicker").classList.remove("hidden");
  el("depResults").textContent = "";
  pickNote("");
  el("depSearch").focus();
}

function closePicker() {
  el("depPicker").classList.add("hidden");
  el("depSearch").value = "";
  el("depChange").focus();
}

profile.then(() => {
  if (!el("departures")) return;
  el("depRefresh").addEventListener("click", (e) => load(e.currentTarget));
  el("depChange").addEventListener("click", openPicker);
  el("depCancel").addEventListener("click", closePicker);

  el("depPicker").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = el("depSearch").value.trim();
    if (!q) return;
    pickNote("Searching…");
    try {
      const { stops } = await api("/departures/stops?q=" + encodeURIComponent(q));
      renderResults(stops);
    } catch (err) {
      console.error("departures: search failed", err.status, err.code);
      pickNote("The search could not be run.");
    }
  });

  // Coming back to the tab with something stale on screen is the one moment a refresh is
  // obviously wanted and obviously cheap.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - fetchedAt > STALE_AFTER_MS) load();
  });

  load();
});
