import { api, profile } from "./shell.js";
import { inWords, shortStop, towardsOf } from "./stop-format.js";

/**
 * The full board for one stop: departures, arrivals, what lines turn up, and what else is
 * nearby.
 *
 * The card on the home view answers "should I leave now". This page answers the rest, which is
 * why it shows clock times as well as countdowns - a countdown is the right answer at the door
 * and the wrong one when you are planning the afternoon.
 *
 * Like that card, it does NOT poll. The deployment shares 100 requests per 15 minutes and the
 * API caches each board for 45 seconds; a timer here would spend that allowance on a tab nobody
 * is looking at. It loads once, refreshes on return to a stale tab, and refreshes when asked.
 *
 * The stop is the profile's stop, the same one the home card reads. Changing it here changes it
 * there, and the copy on the page says so rather than leaving it to be discovered.
 */

const el = (id) => document.getElementById(id);
const STALE_AFTER_MS = 2 * 60 * 1000;

let arrivals = false;
let fetchedAt = 0;

function say(text, tone) {
  const box = el("status");
  box.textContent = text || "";
  box.className = "mb-6 text-sm " + (tone === "error" ? "text-red-700 dark:text-red-400" : "text-brand-muted");
}

/** "14:32", from ResRobot's "14:32:00". Trimmed rather than parsed: it is already local. */
function clock(time) {
  return String(time || "").slice(0, 5);
}

// --- the board ----------------------------------------------------------------

function renderBoard(data) {
  const list = el("trList");
  list.textContent = "";
  list.removeAttribute("aria-busy");

  el("board-heading").textContent = shortStop(data.stop) || "This stop";
  el("trAge").textContent = data.stale ? "last known" : "";

  const operator = data.departures.map((d) => d.operator).find(Boolean);
  const badge = el("trOperator");
  badge.textContent = operator || "";
  badge.classList.toggle("hidden", !operator);

  if (!data.departures.length) {
    el("trNote").textContent = arrivals
      ? "Nothing arriving in the next hour."
      : "Nothing leaving in the next hour.";
    renderLines([]);
    return;
  }
  el("trNote").textContent = "";

  data.departures.forEach((d) => {
    const li = document.createElement("li");
    li.className = "board-row";

    const line = document.createElement("span");
    line.className = "dep-line";
    line.textContent = d.line;

    const where = document.createElement("span");
    where.className = "min-w-0";
    const name = document.createElement("span");
    name.className = "block truncate text-sm text-brand-text";
    name.textContent = towardsOf(d.towards);
    where.appendChild(name);

    // The scheduled time, and the real one when they differ. Both, rather than the later of the
    // two: a bus that is eight minutes late is a different fact from a bus that leaves at 14:40,
    // and only one of them tells you whether to run.
    const sub = document.createElement("span");
    sub.className = "block text-xs text-brand-muted tabular-nums";
    const parts = [`${arrivals ? "Due" : "Scheduled"} ${clock(d.scheduledAt)}`];
    if (d.category) parts.push(d.category);
    sub.textContent = parts.join(" · ");
    where.appendChild(sub);

    const right = document.createElement("span");
    right.className = "flex shrink-0 items-center gap-2";

    if (d.delayMinutes > 0) {
      const late = document.createElement("span");
      late.className = "text-xs font-semibold text-amber-700 dark:text-amber-300";
      late.textContent = `${d.delayMinutes} late`;
      right.appendChild(late);
    }
    if (d.cancelled) {
      const off = document.createElement("span");
      off.className = "text-xs font-semibold text-red-700 dark:text-red-300";
      off.textContent = "cancelled";
      right.appendChild(off);
    }

    const when = document.createElement("span");
    when.className = "w-16 text-right text-sm font-semibold tabular-nums text-brand-text";
    when.textContent = inWords(d.inMinutes);
    right.appendChild(when);

    li.append(line, where, right);
    list.appendChild(li);
  });

  renderLines(data.departures);
}

/**
 * Every line on the board, with where it goes.
 *
 * Built from what was just fetched rather than asked for separately: ResRobot has no "which
 * lines serve this stop" call, and inventing the answer from a timetable this does not have
 * would be the sort of plausible-looking panel nobody can check. A Map keyed by line, and a Set
 * per line, because the same bus appears on the board three times in an hour.
 */
function renderLines(rows) {
  const list = el("trLines");
  list.textContent = "";

  el("trLinesNote").textContent = arrivals
    ? "Every line due in the next hour, and where each one is coming from."
    : "Every line due in the next hour, and where each one is headed.";

  const byLine = new Map();
  rows.forEach((d) => {
    if (!byLine.has(d.line)) byLine.set(d.line, new Set());
    const where = towardsOf(d.towards);
    if (where) byLine.get(d.line).add(where);
  });

  if (!byLine.size) {
    const li = document.createElement("li");
    li.className = "text-sm text-brand-muted";
    li.textContent = "Nothing on the board to summarise.";
    list.appendChild(li);
    return;
  }

  [...byLine.entries()]
    // Numerically where the line is a number, alphabetically where it is not: "2" before "11"
    // before "801", and a replacement service called "X" after all of them.
    .sort((a, b) => (Number(a[0]) || Infinity) - (Number(b[0]) || Infinity) || a[0].localeCompare(b[0]))
    .forEach(([line, wheres]) => {
      const li = document.createElement("li");
      li.className = "card flex items-start gap-3 py-3";

      const badge = document.createElement("span");
      badge.className = "dep-line mt-0.5";
      badge.textContent = line;

      const text = document.createElement("span");
      text.className = "min-w-0 text-sm text-brand-text";
      text.textContent = [...wheres].join(" · ");

      li.append(badge, text);
      list.appendChild(li);
    });
}

async function load(button) {
  if (button) button.disabled = true;
  say("Loading the board…");
  try {
    const data = await api("/departures" + (arrivals ? "?arrivals=1" : ""));
    fetchedAt = Date.now();
    say("");
    renderBoard(data);
  } catch (err) {
    console.error("transit:", err.status, err.code);
    // The placeholder rows are cleared by renderBoard() and by nothing else, so a first load that
    // never reaches it left twelve of them pulsing under the error - a board that reads as still
    // arriving, above a sentence saying it never will.
    //
    // Only a board that never arrived, though. load() also runs on the Departures/Arrivals
    // toggle, on Refresh, and unasked on returning to the tab; clearing unconditionally would
    // wipe twelve real departures because an unattended refresh hit a 429. Stale numbers under a
    // sentence saying so beat an empty card, which is the rule departures.js already states.
    // aria-busy is present if and only if renderBoard() has never run, so it is the flag already.
    if (el("trList").hasAttribute("aria-busy")) {
      el("trList").textContent = "";
      el("trList").removeAttribute("aria-busy");
    }
    say(err.code === "no_such_stop" ? "That stop could not be found."
      : err.code === "not_configured" ? "This deployment has no transit key."
      : "The board could not be loaded.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// --- choosing a stop ----------------------------------------------------------

function pickNote(text) { el("trPickNote").textContent = text || ""; }

/** One stop, as a button. `distance` is only there for the nearby list. */
function stopButton(stop, onPick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm text-brand-text hover:bg-brand-bg";
  const name = document.createElement("span");
  name.className = "min-w-0 truncate";
  name.textContent = shortStop(stop.name);
  btn.appendChild(name);
  if (Number.isFinite(stop.distance)) {
    const far = document.createElement("span");
    far.className = "shrink-0 text-xs text-brand-muted tabular-nums";
    far.textContent = `${stop.distance} m`;
    btn.appendChild(far);
  }
  btn.addEventListener("click", () => onPick(stop));
  return btn;
}

function renderResults(stops) {
  const list = el("trResults");
  list.textContent = "";
  if (!stops.length) { pickNote("No stop matches that."); return; }
  pickNote("");
  stops.forEach((stop) => {
    const li = document.createElement("li");
    li.appendChild(stopButton(stop, choose));
    list.appendChild(li);
  });
}

/** Saved to the profile, not to this browser: the board is drawn from the profile on the server. */
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
    console.error("transit: could not save the stop", err.status, err.code);
    pickNote(err.code === "bad_stop" ? "That stop could not be saved." : "That could not be saved.");
  }
}

/**
 * Stops around where you are standing.
 *
 * The browser asks before answering, and the asking is the reason this is a button rather than
 * something the page does on load: a permission prompt that appears without being provoked is
 * the one people click Block on, and Block is remembered.
 */
function near() {
  if (!navigator.geolocation) { pickNote("This browser cannot share a location."); return; }
  pickNote("Asking this browser where you are…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    pickNote("Looking for stops…");
    try {
      const { latitude, longitude } = pos.coords;
      const { stops } = await api(`/departures/nearby?lat=${latitude}&lon=${longitude}`);
      pickNote(stops.length ? "" : "No stops within a kilometre and a half.");

      const list = el("trNearList");
      list.textContent = "";
      stops.forEach((stop) => {
        const li = document.createElement("li");
        li.className = "card py-2";
        li.appendChild(stopButton(stop, choose));
        list.appendChild(li);
      });
      el("trNearby").classList.toggle("hidden", !stops.length);
    } catch (err) {
      console.error("transit: nearby failed", err.status, err.code);
      pickNote("Nearby stops could not be loaded.");
    }
  }, (err) => {
    // Refusing is a choice, not a failure, and is worth a different sentence from a GPS that
    // could not get a fix.
    console.error("transit: geolocation", err.code);
    pickNote(err.code === err.PERMISSION_DENIED
      ? "This browser is not sharing your location. Search by name instead."
      : "Your location could not be worked out. Search by name instead.");
  }, { timeout: 10000, maximumAge: 5 * 60 * 1000 });
}

function openPicker() {
  el("trPicker").classList.remove("hidden");
  el("trResults").textContent = "";
  pickNote("");
  el("trSearch").focus();
}

function closePicker() {
  el("trPicker").classList.add("hidden");
  el("trSearch").value = "";
  el("trChange").focus();
}

function setBoard(wantArrivals) {
  if (arrivals === wantArrivals) return;
  arrivals = wantArrivals;
  el("trDep").setAttribute("aria-pressed", String(!arrivals));
  el("trArr").setAttribute("aria-pressed", String(arrivals));
  load();
}

profile.then(() => {
  if (!el("trList")) return;

  el("trDep").addEventListener("click", () => setBoard(false));
  el("trArr").addEventListener("click", () => setBoard(true));
  el("trRefresh").addEventListener("click", (e) => load(e.currentTarget));
  el("trChange").addEventListener("click", openPicker);
  el("trCancel").addEventListener("click", closePicker);
  el("trNear").addEventListener("click", near);

  el("trPicker").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = el("trSearch").value.trim();
    if (!q) return;
    pickNote("Searching…");
    try {
      const { stops } = await api("/departures/stops?q=" + encodeURIComponent(q));
      renderResults(stops);
    } catch (err) {
      console.error("transit: search failed", err.status, err.code);
      pickNote("The search could not be run.");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - fetchedAt > STALE_AFTER_MS) load();
  });

  load();
});
