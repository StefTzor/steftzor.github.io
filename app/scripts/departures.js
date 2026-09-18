import { api, profile } from "./shell.js";
import { inWords, shortStop, towardsOf } from "./stop-format.js";
import { remember } from "./rows.js";

/**
 * The next few buses from home, on the home view.
 *
 * It does NOT poll. The API caches for 45 seconds, and the whole deployment shares 100 requests
 * per 15 minutes - a tab left open on a 60-second timer would spend a sixth of that on nobody
 * reading it. Instead it loads once, refreshes when you come back to the tab and what is on
 * screen has gone stale, and refreshes when asked.
 *
 * The card holds its own space from the first paint - placeholder rows the height of the real
 * ones - and goes away entirely if there turns out to be nothing to show. A card that announces
 * itself and then says it knows nothing is worse than no card at all; a card that appears out of
 * nowhere and shoves the page down is worse than both, which is what this used to do.
 */

const el = (id) => document.getElementById(id);
const STALE_AFTER_MS = 2 * 60 * 1000;
const SHOW = 5;

let fetchedAt = 0;

function render(data) {
  const list = el("depList");
  list.textContent = "";

  list.removeAttribute("aria-busy");

  const next = data.departures.slice(0, SHOW);
  if (!next.length) {
    el("depNote").textContent = "Nothing leaving in the next hour.";
    // Empty before the card has ever shown a board is the "nothing to say" case it removes itself
    // for, exactly as the hidden version did. Empty AFTER one is an answer about a board the
    // reader is already reading - the last bus of the evening having gone - so it is said in the
    // note rather than by deleting what they are looking at. Same rule as the catch below.
    if (el("departures").dataset.card !== "ready") el("departures").dataset.card = "absent";
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
    towards.className = "min-w-0 flex-1 truncate text-sm text-brand-text";
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

  // Whoever is actually running these buses, from the board rather than from a constant: the
  // stop is yours to change, and a badge that still said UL at a stop in Skåne would be a lie
  // the card told confidently. Hidden when the upstream did not say.
  // The operator, reported by the board rather than written here - point this at a stop in Skane
  // and it stops saying UL. It reads as " · UL" beside the stop name: a fact about the board,
  // among the other facts about the board.
  //
  // It used to be a badge next to the heading, which forced an empty reserved box from first
  // paint so that its arrival would not wrap the title. Down here nothing is reserved and
  // nothing moves, because the line it joins is already waiting for its own text.
  const operator = next.map((d) => d.operator).find(Boolean);
  const badge = el("depOperator");
  badge.className = operator ? "text-brand-muted" : "";
  badge.textContent = operator ? ` · ${operator}` : "";

  // Stale is said, not hidden: a departure board that is two minutes old is a departure board
  // that is wrong, and the reader is the one who should decide whether that matters.
  el("depAge").textContent = data.stale ? " · last known" : "";
  el("departures").dataset.card = "ready";
  // What to reserve next time. Written after a successful draw, so a failed load never
  // teaches the page a smaller board than the stop really has.
  remember("depList", next.length);
}

async function load(refreshButton) {
  if (refreshButton) refreshButton.disabled = true;
  try {
    const data = await api("/departures");
    fetchedAt = Date.now();
    render(data);
  } catch (err) {
    console.error("departures:", err.status, err.code);
    // Configured-but-broken is worth saying once the card has shown a board; never configured at
    // all means this deployment has no key, and the card goes away entirely. The state lives in
    // data-card rather than a `hidden` class now, because the card is on screen from the first
    // paint holding its own space - "not yet answered" and "nothing to say" stopped being the
    // same thing the moment it stopped starting hidden.
    if (el("departures").dataset.card !== "ready") {
      el("departures").dataset.card = "absent";
      return;
    }
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
