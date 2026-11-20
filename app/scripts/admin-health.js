import { api, profile, API_BASE } from "./shell.js";
import { el, say } from "./admin-status.js";
import { machineState, readingState, summary, classifyRestarts, dayBuckets } from "./health-state.js";

/**
 * Admin -> Health: the whole system at a glance, then the detail one click down.
 *
 * Machines first, from the Beszel hub through /admin/machines: a card each, coloured by its worst
 * reading and saying which one in words. Then the services ("is it up right now" comes from the
 * services themselves - /health and /build.txt), the API's restarts and the deploy pipelines,
 * each drawn as a strip of squares with the full history in an expander under it.
 *
 * Every section loads and fails on its own; the summary at the top is redrawn whenever one lands.
 * createElement throughout: commit messages, labels and sensor names are text from elsewhere.
 */

const SVG = "http://www.w3.org/2000/svg";
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;
const REFRESH_MS = 60 * 1000;
const PILL = { ok: "up", warn: "warn", bad: "down", unknown: "unknown" };

// What the summary is built from. `machines` stays undefined until the first answer, so the line
// at the top says "Checking" rather than "unavailable" while the page is still loading.
const page = { machines: undefined, apiUp: null, appUp: null, latestDeploys: [], restarts: [] };

// --- words and numbers ----------------------------------------------------------------------

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

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pct = (v) => (isNum(v) ? `${Math.round(v)}%` : "—");
const gb = (used, total) => (isNum(used) && isNum(total) ? `${used.toFixed(1)} / ${total.toFixed(1)} GB` : "");

function rate(kbs) {
  if (!isNum(kbs)) return "—";
  return kbs >= 1024 ? `${(kbs / 1024).toFixed(1)} MB/s` : `${kbs.toFixed(1)} KB/s`;
}

function uptime(sec) {
  if (!isNum(sec)) return "—";
  const h = Math.floor(sec / 3600);
  if (h >= 48) return `${Math.floor(h / 24)} d`;
  return `${h} h ${Math.floor((sec % 3600) / 60)} m`;
}

const when = (iso) => new Date(iso).toLocaleString(undefined,
  { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// --- small builders -------------------------------------------------------------------------

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function svgNode(tag, attrs) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function pill(state, word) {
  return node("span", `status-pill status-pill--${PILL[state] || "unknown"}`, word);
}

/** A disclosure with one chevron. The browser's own marker is hidden in CSS. */
function expander(title, body) {
  const d = node("details", "hc-exp");
  const s = node("summary");
  s.append(node("span", "hc-chev", "▸"), node("span", "", title));
  d.append(s, body);
  return d;
}

function message(host, text) {
  host.textContent = "";
  host.appendChild(node("p", "text-sm text-brand-muted", text));
}

// --- drawings -------------------------------------------------------------------------------

/**
 * A ring gauge with its value written in the middle. `value` is 0-100 and fills the ring; null
 * draws the empty track, which is how Network is shown - a rate has no full.
 */
function ring(value, state, label, centre, detail) {
  const tile = node("div", "hc-tile");
  const svg = svgNode("svg", { viewBox: "0 0 64 64", class: "hc-ring", "aria-hidden": "true" });
  svg.appendChild(svgNode("circle", { cx: 32, cy: 32, r: RING_R, class: "hc-ring__track" }));
  if (isNum(value)) {
    const len = Math.max(0, Math.min(100, value)) / 100 * RING_C;
    svg.appendChild(svgNode("circle", {
      cx: 32, cy: 32, r: RING_R, class: `hc-ring__fill hc-${state}`,
      "stroke-dasharray": `${len.toFixed(1)} ${RING_C.toFixed(1)}`, transform: "rotate(-90 32 32)",
    }));
  }
  const text = svgNode("text", { x: 32, y: 37, "text-anchor": "middle", class: `hc-ring__value hc-text-${state}` });
  text.textContent = centre;
  svg.appendChild(text);
  tile.append(svg, node("p", "hc-tile__label", label));
  // The reading in words for a screen reader, which cannot see the ring.
  tile.appendChild(node("span", "sr-only", `${label} ${centre}${detail ? `, ${detail}` : ""}`));
  if (detail) tile.appendChild(node("p", "hc-tile__detail", detail));
  return tile;
}

/** A line over the last hour, 0-100 on the vertical. Nothing is drawn with fewer than two points. */
function sparkline(points, w, h, cls = "hc-spark") {
  const svg = svgNode("svg", { viewBox: `0 0 ${w} ${h}`, class: cls, preserveAspectRatio: "none", "aria-hidden": "true" });
  const vals = points.filter(isNum);
  if (vals.length < 2) return svg;
  const step = w / (vals.length - 1);
  const coords = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (Math.min(100, v) / 100) * (h - 2)).toFixed(1)}`);
  svg.appendChild(svgNode("polyline", { points: coords.join(" "), class: "hc-spark__line" }));
  return svg;
}

/** A labelled bar, for a core or a sensor. */
function bar(label, value, shown, state) {
  const wrap = node("div", "hc-bar");
  const row = node("div", "hc-bar__row");
  row.append(node("span", "", label), node("span", "tabular-nums", shown));
  const track = node("div", "hc-bar__track");
  const fill = node("i", `hc-bar__fill hc-bg-${state}`);
  fill.style.width = `${Math.max(0, Math.min(100, isNum(value) ? value : 0))}%`;
  track.appendChild(fill);
  wrap.append(row, track);
  return wrap;
}

/**
 * A strip of squares. Squares with something to say are buttons: pressing one writes its detail
 * into the line under the strip, which is a live region so a screen reader hears it.
 */
function strip(squares, peek, label) {
  const row = node("div", "hc-strip");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  const buttons = [];
  for (const sq of squares) {
    if (!sq.detail) {
      const s = node("span", `hc-sq hc-sq--${sq.kind}`);
      s.setAttribute("aria-hidden", "true");
      row.appendChild(s);
      continue;
    }
    const b = node("button", `hc-sq hc-sq--${sq.kind}`);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", sq.label);
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      peek.textContent = "";
      peek.appendChild(node("span", "", sq.detail));
      if (sq.href) {
        const a = node("a", "hc-peek__link", "Open log ↗");
        a.href = sq.href;
        a.rel = "noopener";
        peek.append(" ", a);
      }
      peek.hidden = false;
    });
    buttons.push(b);
    row.appendChild(b);
  }
  return row;
}

function peekLine() {
  const p = node("p", "hc-peek");
  p.setAttribute("role", "status");
  p.setAttribute("aria-live", "polite");
  p.hidden = true;
  return p;
}

// --- the summary ----------------------------------------------------------------------------

function renderSummary() {
  const host = el("summary");
  host.textContent = "";
  const s = summary({ ...page, machines: page.machines === undefined ? [] : page.machines }, Date.now());
  // Until the machines have answered, the count would be a guess; the chips are not.
  if (page.machines === undefined) {
    host.appendChild(node("span", "hc-chip", "Checking…"));
  } else {
    const main = node("span", `hc-chip hc-chip--${s.systems.state}`);
    main.append(node("span", `hc-dot hc-bg-${s.systems.state}`), node("span", "", s.systems.word));
    host.appendChild(main);
  }
  s.chips.forEach((c) => {
    const chip = node("span", "hc-chip hc-chip--warn");
    chip.append(node("span", "hc-dot hc-bg-warn"), node("span", "", c));
    host.appendChild(chip);
  });
}

// --- machines -------------------------------------------------------------------------------

function machineCard(m, nowMs, beszelUrl) {
  const { state, word } = machineState(m, nowMs);
  const card = node("article", `card hc-card hc-edge--${state}`);

  const head = node("div", "hc-card__head");
  const names = node("div");
  names.append(node("h3", "font-semibold text-brand-text", m.label));
  const role = [m.role, isNum(m.cores) ? `${m.cores} cores` : ""].filter(Boolean).join(" · ");
  if (role) names.append(node("p", "hint", role));
  head.append(names, pill(state, word));
  card.appendChild(head);

  const tiles = node("div", "hc-tiles");
  const cpuState = readingState("cpu", m.cpu);
  const cpu = ring(m.cpu, cpuState, "CPU", pct(m.cpu));
  cpu.appendChild(sparkline((m.history || []).map((p) => p.cpu), 64, 16));
  tiles.appendChild(cpu);
  tiles.appendChild(ring(m.mem && m.mem.pct, readingState("mem", m.mem && m.mem.pct), "RAM", pct(m.mem && m.mem.pct), gb(m.mem && m.mem.usedGb, m.mem && m.mem.totalGb)));
  tiles.appendChild(ring(m.disk && m.disk.pct, readingState("disk", m.disk && m.disk.pct), "Disk", pct(m.disk && m.disk.pct), gb(m.disk && m.disk.usedGb, m.disk && m.disk.totalGb)));
  if (isNum(m.tempC)) {
    tiles.appendChild(ring(m.tempC, readingState("temp", m.tempC), "Temp", `${Math.round(m.tempC)}°`, "alert at 80°"));
  } else {
    tiles.appendChild(ring(null, "unknown", "Network", m.netKBs ? `↓${rate(m.netKBs.down).split(" ")[0]}` : "—",
      m.netKBs ? rate(m.netKBs.down).split(" ")[1] + " in" : "no temp sensor"));
  }
  card.appendChild(tiles);

  const foot = node("p", "hc-foot");
  const fact = (k, v) => { const s = node("span", "", `${k} `); s.appendChild(node("b", "", v)); return s; };
  foot.append(fact("Up", uptime(m.uptimeSec)), fact("Load", isNum(m.load1) ? m.load1.toFixed(2) : "—"));
  if (isNum(m.tempC) && m.netKBs) foot.append(fact("Net", `↓${rate(m.netKBs.down)} ↑${rate(m.netKBs.up)}`));
  else if (isNum(m.containers)) foot.append(fact("Containers", String(m.containers)));
  card.appendChild(foot);

  card.appendChild(expander("Details", machineDetails(m, beszelUrl)));
  return card;
}

function machineDetails(m, beszelUrl) {
  const body = node("div", "hc-details");

  if (m.coresPct && m.coresPct.length) {
    const cores = node("div");
    cores.appendChild(node("h4", "hc-h4", "CPU cores"));
    m.coresPct.forEach((v, i) => cores.appendChild(bar(`Core ${i}`, v, pct(v), readingState("cpu", v))));
    body.appendChild(cores);
  }

  const side = node("div");
  if (m.temps && m.temps.length) {
    side.appendChild(node("h4", "hc-h4", "Temperatures"));
    m.temps.forEach((t) => side.appendChild(bar(t.label, t.c, `${Math.round(t.c)} °C`, readingState("temp", t.c))));
  }
  side.appendChild(node("h4", "hc-h4", "Memory"));
  side.appendChild(bar("RAM", m.mem && m.mem.pct, gb(m.mem && m.mem.usedGb, m.mem && m.mem.totalGb) || pct(m.mem && m.mem.pct), readingState("mem", m.mem && m.mem.pct)));
  if (m.swap && isNum(m.swap.totalGb) && m.swap.totalGb > 0) {
    side.appendChild(bar("Swap", (m.swap.usedGb / m.swap.totalGb) * 100, gb(m.swap.usedGb, m.swap.totalGb), "ok"));
  }
  if (m.netKBs) side.appendChild(node("p", "hc-note", `Network ↓${rate(m.netKBs.down)} ↑${rate(m.netKBs.up)}`));
  body.appendChild(side);

  const hour = node("div", "hc-wide");
  hour.appendChild(node("h4", "hc-h4", "Last hour"));
  const chart = node("div", "hc-hour");
  chart.append(
    sparkline((m.history || []).map((p) => p.cpu), 300, 44, "hc-hour__cpu"),
    sparkline((m.history || []).map((p) => p.mem), 300, 44, "hc-hour__mem"),
  );
  hour.appendChild(chart);
  const legend = node("p", "hc-legend");
  legend.append(node("span", "hc-key hc-key--cpu", "CPU"), node("span", "hc-key hc-key--mem", "RAM"));
  hour.appendChild(legend);
  body.appendChild(hour);

  const end = node("p", "hc-wide hc-note");
  const bits = [];
  if (m.services) bits.push(`${m.services.total} services${m.services.failed ? `, ${m.services.failed} failed` : ""}`);
  if (isNum(m.containers)) bits.push(`${m.containers} containers`);
  end.appendChild(node("span", "", bits.join(" · ")));
  if (beszelUrl) {
    const a = node("a", "hc-peek__link", "Open in Beszel ↗");
    a.href = beszelUrl;
    a.rel = "noopener";
    end.append(" ", a);
  }
  body.appendChild(end);
  return body;
}

async function loadMachines() {
  const host = el("machines");
  try {
    const data = await api("/admin/machines");
    page.machines = data.machines;
    host.textContent = "";
    const now = Date.now();
    data.machines.forEach((m) => host.appendChild(machineCard(m, now, data.beszelUrl)));
    if (!data.machines.length) message(host, "Beszel reports no machines.");
    el("machinesAge").textContent = `From Beszel, ${since(data.fetchedAt)}. Refreshed every minute.`;
  } catch (err) {
    console.error("health: machines", err.status, err.code);
    page.machines = null;
    message(host, err.code === "machines_unconfigured"
      ? "Not configured: the API has no Beszel login yet. Nothing is broken."
      : "Unavailable: Beszel could not be reached. The rest of this page is unaffected.");
  }
  renderSummary();
}

// --- services -------------------------------------------------------------------------------

function setState(id, tone, label) {
  const p = el(id);
  p.textContent = label;
  p.className = "status-pill status-pill--" + tone;
}

/** /health is public by design and answers with the time the process started. */
async function loadApi() {
  try {
    const t0 = performance.now();
    const res = await fetch(API_BASE + "/health", { cache: "no-store" });
    if (!res.ok) throw new Error("health " + res.status);
    const { startedAt, build } = await res.json();
    const ms = Math.round(performance.now() - t0);
    page.apiUp = true;
    setState("apiState", "up", "Up");
    el("apiTime").textContent = `${ms} ms`;
    el("apiDetail").textContent = [startedAt ? `Running since ${since(startedAt)}` : "Running", build ? `build ${String(build).slice(0, 7)}` : ""]
      .filter(Boolean).join(" · ");
  } catch (err) {
    console.error("health: api", err.message);
    page.apiUp = false;
    setState("apiState", "down", "Unreachable");
    el("apiTime").textContent = "—";
    el("apiDetail").textContent = "The health check did not answer.";
  }
  renderSummary();
}

async function loadApp() {
  try {
    const res = await fetch("/build.txt", { cache: "no-store" });
    if (!res.ok) throw new Error("build " + res.status);
    page.appUp = true;
    setState("appState", "up", "Up");
    el("appDetail").textContent = `Deployed ${since((await res.text()).trim())}`;
  } catch (err) {
    console.error("health: app", err.message);
    // This page was served, so "down" would be plainly untrue. Only the stamp is missing.
    page.appUp = true;
    setState("appState", "unknown", "Serving");
    el("appDetail").textContent = "The build stamp could not be read.";
  }
  renderSummary();
}

// --- restarts -------------------------------------------------------------------------------

const RESTART_WORD = { deploy: "deploy", unexpected: "no deploy", unknown: "build unknown" };

/** The gap to the start before, because that gap is the signal: a month is a deploy, 90 s is a crash. */
function gap(fromIso, toIso) {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min later`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h later`;
  return `${Math.round(hours / 24)} d later`;
}

async function loadBoots() {
  const host = el("boots");
  try {
    const { boots } = await api("/admin/boots?limit=50");
    host.textContent = "";
    const restarts = classifyRestarts(boots);
    page.restarts = restarts;
    renderSummary();
    if (!restarts.length) return message(host, "No restarts recorded yet.");

    const now = Date.now();
    const days = dayBuckets(restarts, 30, now);
    const peek = peekLine();
    const squares = days.map((d) => {
      const kind = d.kinds.includes("unexpected") ? "bad" : d.kinds.includes("deploy") ? "deploy" : d.kinds.length ? "unknown" : "none";
      if (!d.kinds.length) return { kind };
      const those = restarts.filter((r) => d.day === dayOf(r.startedAt));
      const detail = those.map((r) => `${when(r.startedAt)} · ${r.kind === "unexpected" ? "restart with no deploy" : RESTART_WORD[r.kind]}${r.version ? ` · build ${r.version}` : ""}`).join("; ");
      return { kind, detail, label: `${d.day}: ${those.length} restart${those.length === 1 ? "" : "s"}` };
    });
    host.appendChild(strip(squares, peek, "API restarts, last 30 days"));
    host.appendChild(legend([["deploy", "Deploy"], ["bad", "Unexpected restart"], ["unknown", "Build unknown"], ["none", "No restart"]]));

    const oldest = Date.parse(boots[boots.length - 1].startedAt);
    if (boots.length >= 50 && now - oldest < 30 * 86400000) {
      host.appendChild(node("p", "hc-note", `Only the last ${boots.length} restarts are shown.`));
    }
    host.appendChild(peek);

    const list = node("ul", "hc-list");
    restarts.forEach((r, i) => {
      const li = node("li", "hc-row");
      li.append(node("span", "text-sm text-brand-text", when(r.startedAt)));
      const meta = node("span", `text-xs tabular-nums hc-text-${r.kind === "unexpected" ? "bad" : r.kind === "deploy" ? "deploy" : "muted"}`);
      const before = restarts[i + 1];
      meta.textContent = [RESTART_WORD[r.kind], r.version, before ? gap(before.startedAt, r.startedAt) : ""].filter(Boolean).join(" · ");
      li.append(meta);
      list.appendChild(li);
    });
    host.appendChild(expander(`Restart history (${restarts.length})`, list));
  } catch (err) {
    console.error("health: boots", err.status, err.code);
    // A 404 here means the route is behind `if (postgres)` and there is no database, which is
    // a configuration fact rather than a fault.
    message(host, err.status === 404
      ? "Restart history needs the database, which is not configured."
      : "Restart history could not be loaded.");
  }
}

function dayOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function legend(items) {
  const p = node("p", "hc-legend");
  items.forEach(([kind, word]) => p.appendChild(node("span", `hc-key hc-key--${kind}`, word)));
  return p;
}

// --- deploys --------------------------------------------------------------------------------

function runWord(run) {
  if (run.status !== "completed") return "Running";
  if (run.conclusion === "success") return "Passed";
  if (run.conclusion === "failure") return "Failed";
  return run.conclusion ? run.conclusion[0].toUpperCase() + run.conclusion.slice(1) : "Unknown";
}

function runKind(run) {
  if (run.status !== "completed") return "run";
  return run.conclusion === "success" ? "ok" : run.conclusion === "failure" ? "bad" : run.conclusion === "cancelled" ? "warn" : "unknown";
}

/** One run, as a row. Commit messages are text from a repository. */
function runRow(run, pipeline) {
  const li = node("li", "hc-row hc-run");
  li.dataset.result = runKind(run);
  li.appendChild(pill(runKind(run) === "bad" ? "bad" : runKind(run) === "ok" ? "ok" : runKind(run) === "warn" ? "warn" : "unknown", runWord(run)));
  li.appendChild(node("span", "text-xs text-brand-muted", pipeline));
  const msg = node("a", "min-w-0 flex-1 truncate text-sm text-brand-text hover:text-brand-accent hover:underline", run.message || run.sha);
  if (run.url) { msg.href = run.url; msg.rel = "noopener"; }
  li.appendChild(msg);
  li.appendChild(node("span", "shrink-0 text-xs text-brand-muted tabular-nums",
    [run.sha, took(run.durationMs), since(run.startedAt)].filter(Boolean).join(" · ")));
  // The failing step, on its own line: it is the one thing worth reading before opening the log.
  if (run.failedStep) li.appendChild(node("p", "w-full pl-1 text-xs hc-text-bad", `Failed at: ${run.failedStep}`));
  return li;
}

function renderDeploys(data) {
  const host = el("deploys");
  host.textContent = "";
  el("deployAge").textContent = data.stale
    ? "GitHub could not be reached; showing the last answer."
    : `As of ${since(data.at)}. Last 20 runs per pipeline, newest on the right.`;

  page.latestDeploys = data.pipelines
    .map((p) => (p.runs.find((r) => r.status === "completed") || {}).conclusion)
    .filter(Boolean);
  renderSummary();

  const peek = peekLine();
  data.pipelines.forEach((p) => {
    const row = node("div", "hc-pipe");
    row.appendChild(node("span", "hc-pipe__name", p.workflow));
    const squares = p.runs.slice(0, 20).reverse().map((r) => ({
      kind: runKind(r),
      label: `${p.workflow}: ${runWord(r)}, ${since(r.startedAt)}`,
      detail: [runWord(r), r.message || r.sha, r.sha, took(r.durationMs), since(r.startedAt), r.failedStep ? `failed at: ${r.failedStep}` : ""]
        .filter(Boolean).join(" · "),
      href: r.url,
    }));
    row.appendChild(strip(squares, peek, `${p.workflow}, last ${squares.length} runs`));
    host.appendChild(row);
  });
  host.appendChild(legend([["ok", "Passed"], ["warn", "Cancelled"], ["bad", "Failed"], ["run", "Running"]]));
  host.appendChild(peek);

  // A repository that could not be read is named. Leaving it out would make its pipeline look
  // like one that has never run.
  if (data.unreachable && data.unreachable.length) {
    host.appendChild(node("p", "hc-note", `Could not read: ${data.unreachable.join(", ")}.`));
  }

  const all = [];
  data.pipelines.forEach((p) => p.runs.forEach((r) => all.push([r, p.workflow])));
  all.sort((a, b) => String(b[0].startedAt).localeCompare(String(a[0].startedAt)));
  const failed = all.filter(([r]) => runKind(r) === "bad").length;
  const cancelled = all.filter(([r]) => runKind(r) === "warn").length;

  const body = node("div");
  const filter = node("label", "hc-filter");
  const box = node("input");
  box.type = "checkbox";
  filter.append(box, node("span", "", "Failed only"));
  const list = node("ul", "hc-list");
  const rows = all.map(([r, w]) => runRow(r, w));
  rows.forEach((li) => list.appendChild(li));
  box.addEventListener("change", () => {
    rows.forEach((li) => { li.hidden = box.checked && li.dataset.result !== "bad"; });
  });
  body.append(filter, list);
  host.appendChild(expander(`Run history (${all.length}) · ${failed} failed, ${cancelled} cancelled`, body));
}

async function loadDeploys() {
  try {
    renderDeploys(await api("/admin/deploys"));
  } catch (err) {
    console.error("health: deploys", err.status, err.code);
    el("deployAge").textContent = "";
    message(el("deploys"), err.code === "not_configured"
      ? "Deploy history needs a GitHub token on the API. Nothing is broken; it is simply not connected."
      : "Deploy history could not be loaded.");
  }
}

profile.then(() => {
  say("");
  renderSummary();
  loadMachines();
  loadApi();
  loadApp();
  loadBoots();
  loadDeploys();
  // Machines move minute to minute; the rest is read once. Only while the tab is being looked at.
  setInterval(() => { if (document.visibilityState === "visible") loadMachines(); }, REFRESH_MS);
});
