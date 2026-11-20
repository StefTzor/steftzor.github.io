/**
 * The health page's judgements, kept apart from the drawing so they can be tested without a
 * browser: when a reading turns amber or red, what a machine card says about itself, which API
 * restarts were deploys, and what the line at the top of the page reports.
 *
 * No imports and no DOM. The thresholds match the Beszel alerts, so the page and the Telegram
 * message never disagree about what "high" means.
 */

const LIMITS = {
  cpu: [80, 90],
  mem: [80, 90],
  disk: [80, 90],
  temp: [70, 80],
};

// Beszel stops counting a machine as fresh when it has not reported for a few minutes.
const STALE_MS = 180 * 1000;

const RANK = { unknown: 0, ok: 1, warn: 2, bad: 3 };

/** "ok" up to the first limit, "warn" above it, "bad" above the second; "unknown" with no number. */
export function readingState(kind, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  const [warn, bad] = LIMITS[kind];
  if (value > bad) return "bad";
  if (value > warn) return "warn";
  return "ok";
}

/** True when the last report is older than three minutes. A clock ahead of ours is fresh. */
export function isStale(updatedAt, nowMs) {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t > STALE_MS;
}

/**
 * The card's state is its worst reading, and its word names that reading. On a tie the order is
 * disk, memory, temperature, CPU: a full disk stops things, a busy CPU usually passes.
 */
export function machineState(m, nowMs) {
  if (m.status !== "up" || isStale(m.updatedAt, nowMs)) return { state: "bad", word: "Down" };
  const readings = [
    ["disk", m.disk && m.disk.pct, "Disk almost full"],
    ["mem", m.mem && m.mem.pct, "Memory high"],
    ["temp", m.tempC, "Running hot"],
    ["cpu", m.cpu, "CPU busy"],
  ];
  let worst = { state: "unknown", word: "No data yet" };
  for (const [kind, value, word] of readings) {
    const state = readingState(kind, value);
    if (RANK[state] > RANK[worst.state]) worst = { state, word: state === "ok" ? "Healthy" : word };
  }
  return worst;
}

/**
 * Restarts newest first, each marked by comparing its build with the start before it: a new
 * build is a deploy, the same build is a restart nobody asked for. Without a build on either
 * side, or for the oldest one fetched, there is nothing to compare, so it says "unknown".
 */
export function classifyRestarts(boots) {
  return boots.map((b, i) => {
    const before = boots[i + 1];
    let kind = "unknown";
    if (before && b.version && before.version) kind = b.version === before.version ? "unexpected" : "deploy";
    return { startedAt: b.startedAt, version: b.version, kind };
  });
}

/** "2026-11-20" in the viewer's own calendar, which is the day they think of it as. */
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One entry per day for the last `days` days, oldest first, with the kinds that fell on it. */
export function dayBuckets(items, days, nowMs) {
  const out = [];
  const index = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = localDay(nowMs - i * 86400000);
    index.set(day, out.length);
    out.push({ day, kinds: [] });
  }
  for (const item of items) {
    const t = Date.parse(item.startedAt);
    if (!Number.isFinite(t)) continue;
    const at = index.get(localDay(t));
    if (at !== undefined) out[at].kinds.push(item.kind);
  }
  return out;
}

/**
 * The top of the page: how many of the five live systems (three machines, the API, the app) need
 * attention, plus a chip for a failed latest deploy or a restart nobody asked for in the last day.
 */
export function summary({ machines, apiUp, appUp, latestDeploys, restarts }, nowMs) {
  const states = [];
  if (machines) for (const m of machines) states.push(machineState(m, nowMs).state);
  if (apiUp !== null && apiUp !== undefined) states.push(apiUp ? "ok" : "bad");
  if (appUp !== null && appUp !== undefined) states.push(appUp ? "ok" : "bad");

  const attention = states.filter((s) => s === "warn" || s === "bad").length;
  let state = states.includes("bad") ? "bad" : states.includes("warn") ? "warn" : "ok";
  let word;
  if (!machines) {
    // An API outage takes the machines with it; the outage is the news, so it leads.
    word = attention
      ? `${attention} ${attention === 1 ? "needs" : "need"} attention · machines unavailable`
      : "Machines unavailable";
    if (state === "ok") state = "warn";
  } else if (attention === 0) {
    word = "All 5 systems healthy";
  } else {
    word = `${attention} ${attention === 1 ? "needs" : "need"} attention`;
  }

  const chips = [];
  if ((latestDeploys || []).includes("failure")) chips.push("Last deploy failed");
  const dayAgo = nowMs - 24 * 3600 * 1000;
  if ((restarts || []).some((r) => r.kind === "unexpected" && Date.parse(r.startedAt) >= dayAgo)) {
    chips.push("Unexpected restart today");
  }

  return { systems: { attention, total: 5, word, state }, chips };
}
