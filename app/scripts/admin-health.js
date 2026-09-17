import { api, profile, API_BASE } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin -> Health: what is running, and how the last few deploys went.
 *
 * Two different questions, answered by two different things. "Is it up" comes from the services
 * themselves - /health and /build.txt - and is true this second. "Did the last deploy work"
 * comes from GitHub Actions, and is the only source that knows about one that FAILED: a service
 * that is running can only tell you about deploys that succeeded.
 */

const TONE = { success: "up", failure: "down" };

/** "3 hours ago", for a moment in the past. */
function since(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} ago`;
}

/** "35s", "2m 14s" - a build time nobody has to convert in their head. */
function took(ms) {
  if (!Number.isFinite(ms)) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function setState(id, tone, label) {
  const pill = el(id);
  pill.textContent = label;
  pill.className = "status-pill status-pill--" + tone;
}

/** /health is public by design and answers with the time the process started. */
async function loadApi() {
  try {
    const res = await fetch(API_BASE + "/health", { cache: "no-store" });
    if (!res.ok) throw new Error("health " + res.status);
    const { startedAt } = await res.json();
    setState("apiState", "up", "Up");
    el("apiDetail").textContent = startedAt ? `Running since ${since(startedAt)}` : "Running";
  } catch (err) {
    console.error("health: api", err.message);
    setState("apiState", "down", "Unreachable");
    el("apiDetail").textContent = "The health check did not answer.";
  }
}

async function loadApp() {
  try {
    const res = await fetch("/build.txt", { cache: "no-store" });
    if (!res.ok) throw new Error("build " + res.status);
    setState("appState", "up", "Up");
    el("appDetail").textContent = `Deployed ${since((await res.text()).trim())}`;
  } catch (err) {
    console.error("health: app", err.message);
    // This page was served, so "down" would be plainly untrue. Only the stamp is missing.
    setState("appState", "unknown", "Serving");
    el("appDetail").textContent = "The build stamp could not be read.";
  }
}

/** One run, as a row. createElement throughout: commit messages are text from a repository. */
function runRow(run) {
  const li = document.createElement("li");
  li.className = "flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0";

  const state = document.createElement("span");
  const running = run.status !== "completed";
  state.className = "status-pill " + (running ? "status-pill--unknown" : "status-pill--" + (TONE[run.conclusion] || "unknown"));
  // The word, not a colour. "Cancelled" and "skipped" are real conclusions and deserve their own
  // word rather than being flattened into a red dot.
  state.textContent = running ? "Running"
    : run.conclusion === "success" ? "Passed"
    : run.conclusion === "failure" ? "Failed"
    : run.conclusion ? run.conclusion[0].toUpperCase() + run.conclusion.slice(1)
    : "Unknown";

  const msg = document.createElement("a");
  msg.className = "min-w-0 flex-1 truncate text-sm text-brand-text hover:text-brand-accent hover:underline";
  msg.textContent = run.message || run.sha;
  if (run.url) { msg.href = run.url; msg.rel = "noopener"; }

  const meta = document.createElement("span");
  meta.className = "shrink-0 text-xs text-brand-muted tabular-nums";
  meta.textContent = [run.sha, took(run.durationMs), since(run.startedAt)].filter(Boolean).join(" · ");

  li.append(state, msg, meta);

  // The failing step, on its own line: it is the one thing worth reading before opening the log.
  if (run.failedStep) {
    const why = document.createElement("p");
    why.className = "w-full pl-1 text-xs text-red-700 dark:text-red-400";
    why.textContent = run.failedStep;
    li.appendChild(why);
  }
  return li;
}

function render(data) {
  const host = el("deploys");
  host.textContent = "";

  el("deployAge").textContent = data.stale
    ? "GitHub could not be reached; showing the last answer."
    : `As of ${since(data.at)}.`;

  data.pipelines.forEach((p) => {
    const card = document.createElement("section");
    card.className = "card mb-4";
    const head = document.createElement("div");
    head.className = "mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";
    const name = document.createElement("h3");
    name.className = "font-semibold text-brand-text";
    name.textContent = p.workflow;
    const repo = document.createElement("p");
    repo.className = "text-xs text-brand-muted";
    repo.textContent = p.repo;
    head.append(name, repo);

    const list = document.createElement("ul");
    list.className = "divide-y divide-brand-muted/10";
    p.runs.forEach((r) => list.appendChild(runRow(r)));

    card.append(head, list);
    host.appendChild(card);
  });

  // A repository that could not be read is named. Leaving it out would make its pipeline look
  // like one that has never run.
  if (data.unreachable && data.unreachable.length) {
    const p = document.createElement("p");
    p.className = "text-sm text-brand-muted";
    p.textContent = `Could not read: ${data.unreachable.join(", ")}.`;
    host.appendChild(p);
  }
}

async function loadDeploys() {
  try {
    render(await api("/admin/deploys"));
  } catch (err) {
    console.error("health: deploys", err.status, err.code);
    el("deploys").textContent = "";
    el("deployAge").textContent = "";
    const p = document.createElement("p");
    p.className = "text-sm text-brand-muted";
    p.textContent = err.code === "not_configured"
      ? "Deploy history needs a GitHub token on the API. Nothing is broken; it is simply not connected."
      : "Deploy history could not be loaded.";
    el("deploys").appendChild(p);
  }
}

profile.then(() => {
  say("");
  loadApi();
  loadApp();
  loadDeploys();
});
