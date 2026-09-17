import { api, profile } from "./shell.js";

/**
 * The next Formula 1 weekend, in the reader's own timezone.
 *
 * The API sends ISO instants and nothing else. Every time on this card is formatted here, by the
 * browser, because the browser is the only thing that knows where the reader is - and the whole
 * appeal of the card is that the times are the ones you would actually set an alarm for.
 *
 * Loads once. The calendar moves a few times a year, so polling it would be absurd; the
 * countdown ticks locally off a timestamp already in hand.
 */

const el = (id) => document.getElementById(id);

/** "Sat 14:00" for this week, "26 Sep, 13:00" beyond it - the reader's locale decides the words. */
function when(iso, raceWeek) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, raceWeek
    ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** How long until then, in the largest unit that is still honest. */
function until(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function render(data) {
  const race = data.next;
  if (!race) return;

  el("f1Name").textContent = race.name;
  el("f1Where").textContent = [race.locality, race.country].filter(Boolean).join(", ");
  el("f1Sprint").classList.toggle("hidden", !race.sprint);

  const soon = data.nextSession;
  const away = soon && until(soon.at);
  el("f1Countdown").textContent = soon
    ? (away ? `${soon.label} in ${away}` : `${soon.label} is under way`)
    : "The race is under way.";

  // Within a week, weekday names read faster than dates; beyond it they are ambiguous.
  const raceWeek = Date.parse(race.sessions[race.sessions.length - 1].at) - Date.now() < 7 * 864e5;

  const list = el("f1Sessions");
  list.textContent = "";
  list.removeAttribute("aria-busy");
  race.sessions.forEach((s) => {
    const li = document.createElement("li");
    li.className = "flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0";

    const label = document.createElement("span");
    const isNext = soon && s.at === soon.at;
    // The next session is the one the card exists to answer, so it is the one that stands out.
    label.className = isNext
      ? "text-sm font-semibold text-brand-accent"
      : "text-sm text-brand-text";
    label.textContent = s.label;

    const time = document.createElement("time");
    time.dateTime = s.at;
    time.className = "shrink-0 text-sm tabular-nums " +
      (Date.parse(s.at) < Date.now() ? "text-brand-muted line-through" : "text-brand-muted");
    time.textContent = when(s.at, raceWeek);

    li.append(label, time);
    list.appendChild(li);
  });

  el("f1").dataset.card = "ready";
}

profile.then(async () => {
  if (!el("f1")) return;
  try {
    const data = await api("/f1/next");
    // No race left in the season is a real answer, and the card goes away rather than saying so
    // on a home view that has nothing else to do with racing. It holds its space until then, so
    // the decision costs the page no movement either way.
    if (data.next) render(data);
    else el("f1").dataset.card = "absent";
  } catch (err) {
    console.error("f1:", err.status, err.code);
    el("f1").dataset.card = "absent";
  }
});
