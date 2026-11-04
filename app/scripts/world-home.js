import { api, profile } from "./shell.js";
import { nearbyAlerts, ago, alertHref } from "./world-core.js";

/**
 * The home card for /world/: alerts near the saved home place, or a line saying there are none.
 * Text only: alert titles come from third parties. Removed if the alerts cannot be read.
 */

const el = (id) => document.getElementById(id);
const MAX = 3;
const DEFAULT_HOME = { name: "Uppsala", lat: 59.8586, lon: 17.6389, countryCode: "SE" };

function row(alert, now) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = alertHref(alert.id);
  link.className = "world-row";
  const left = document.createElement("span");
  left.className = "flex min-w-0 items-baseline text-brand-text";
  const dot = document.createElement("span");
  dot.className = "world-dot";
  dot.dataset.severity = alert.severity;
  const title = document.createElement("span");
  title.className = "truncate";
  title.textContent = alert.title;
  left.append(dot, title);
  const when = document.createElement("span");
  when.className = "shrink-0 text-xs text-brand-muted tabular-nums";
  when.textContent = ago(alert.at, now);
  link.append(left, when);
  li.append(link);
  return li;
}

profile.then(async (me) => {
  const card = el("worldToday");
  if (!card) return;
  const home = (me && me.homeLocation) || DEFAULT_HOME;
  try {
    const { alerts } = await api("/world/alerts");
    const near = nearbyAlerts(alerts, home);
    const list = el("worldRows");
    list.removeAttribute("aria-busy");
    list.replaceChildren(...near.slice(0, MAX).map((a) => row(a, Date.now())));
    const worldwide = alerts.filter((a) => a.severity === "high").length;
    const place = (home.name || "your saved place").split(",")[0];
    el("worldMore").textContent = `${near.length ? `${near.length} near ${place}` : `Nothing to report near ${place}`}. `
      + `${worldwide} major ${worldwide === 1 ? "alert" : "alerts"} worldwide.`;
    card.dataset.card = "ready";
  } catch (err) {
    console.error("world home:", err.status, err.code);
    card.dataset.card = "absent";
  }
});
