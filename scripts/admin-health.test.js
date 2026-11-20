'use strict';

/**
 * The Admin health page's drawing, run without a browser, the way analytics-render.test.js does:
 * the imports and the start-up at the bottom go, health-state.js is loaded beside it, and the rest
 * runs against a small DOM whose innerHTML throws - a label from elsewhere reaching that setter is
 * the failure this file exists to catch.
 *   node scripts/admin-health.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRC = read('app/scripts/admin-health.js');
const STATE = read('app/scripts/health-state.js');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

// --- a small DOM ------------------------------------------------------------------------------

function element(tag) {
  const n = {
    tag, children: [], attrs: {}, _text: '', className: '', style: {}, dataset: {}, listeners: {},
    hidden: false, type: '', href: '', rel: '', checked: false,
    append(...kids) { kids.forEach((k) => n.children.push(typeof k === 'string' ? textNode(k) : k)); },
    appendChild(k) { n.children.push(k); return k; },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k]; },
    addEventListener(t, f) { n.listeners[t] = f; },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(''); },
    set textContent(v) { n.children = []; n._text = String(v); },
    set innerHTML(_) { throw new Error('innerHTML used'); },
  };
  return n;
}
const textNode = (t) => ({ tag: '#text', children: [], _text: t, textContent: t });

function makeDom(ids) {
  const byId = {};
  ids.forEach((id) => { byId[id] = element('div'); });
  const document = {
    createElement: element,
    createElementNS: (_ns, tag) => element(tag),
    getElementById: (id) => byId[id],
    visibilityState: 'visible',
  };
  return { document, byId };
}

const walk = (n) => [n, ...(n.children || []).flatMap(walk)];
const find = (n, pred) => walk(n).filter(pred);
const byClass = (n, c) => find(n, (x) => (x.className || '').split(' ').includes(c) || (x.attrs && (x.attrs.class || '').split(' ').includes(c)));

const IDS = ['summary', 'status', 'machines', 'machinesAge', 'apiState', 'apiTime', 'apiDetail', 'appState', 'appDetail', 'boots', 'deploys', 'deployAge'];

function load({ api = async () => { throw new Error('no network'); }, fetchImpl = async () => { throw new Error('no network'); } } = {}) {
  const { document, byId } = makeDom(IDS);
  const strip = (src) => src.split('\n').filter((l) => !l.startsWith('import ')).join('\n').replace(/^export /gm, '');
  const body = strip(STATE) + '\n' + strip(SRC).replace(/profile\.then\([\s\S]*$/, '');
  const ctx = {
    document, console: { error() {}, log() {} }, Date, Math, Number, String, Object, Array, JSON, Promise, Map,
    el: (id) => document.getElementById(id), say: () => {}, api, fetch: fetchImpl, API_BASE: 'https://api.test',
    performance: { now: (() => { let t = 0; return () => { t += 184; return t; }; })() },
    setInterval: () => 0,
  };
  vm.createContext(ctx);
  vm.runInContext(body + '\n;this.__ = { machineCard, loadMachines, loadApi, loadApp, loadBoots, loadDeploys, renderSummary, page };', ctx);
  return { ...ctx.__, byId };
}

// --- fixtures -------------------------------------------------------------------------------

const NOW = Date.now();
const fresh = new Date(NOW - 20000).toISOString();
const mini = (over = {}) => ({
  id: 'a', name: 'box-a', label: 'Box A', role: 'Role A', status: 'up', updatedAt: fresh,
  cores: 4, uptimeSec: 10205, load1: 0.05, cpu: 0.55,
  mem: { pct: 13.5, usedGb: 1.56, totalGb: 11.57 }, swap: { usedGb: 0.01, totalGb: 8 },
  disk: { pct: 9.9, usedGb: 6.34, totalGb: 67.6 }, tempC: 38,
  temps: [{ label: 'CPU package', c: 38 }, { label: 'NVMe', c: 37 }], netKBs: { down: 2, up: 1.8 },
  coresPct: [1, 0, 2, 1], services: { total: 72, failed: 0 }, containers: 0,
  history: [{ t: 'x', cpu: 1, mem: 13 }, { t: 'y', cpu: 2, mem: 14 }], ...over,
});
const boxB = (over = {}) => mini({ name: 'box-b', label: 'Box B', role: 'Role B', tempC: null, temps: [], netKBs: { down: 5.1, up: 2 }, containers: 5, ...over });

(async () => {
  // --- machines -----------------------------------------------------------------------------
  {
    const h = load();
    const card = h.machineCard(boxB({ mem: { pct: 87, usedGb: 10.4, totalGb: 12 } }), Date.now(), null);
    assert(card.className.includes('hc-edge--warn'), card.className);
    assert(card.textContent.includes('Memory high'));
    ok('a machine card names its state in words and colours its edge');
  }

  {
    const h = load();
    const card = h.machineCard(mini(), Date.now(), 'https://hub.test');
    const values = find(card, (n) => n.tag === 'text').map((t) => t.textContent);
    assert.strictEqual(values[0], '1%', 'the CPU ring carries its value in the centre');
    assert(values.includes('38°'), 'the temperature tile reads 38°');
    const opsCard = h.machineCard(boxB(), Date.now(), null);
    const tiles = byClass(opsCard, 'hc-tile');
    const net = tiles[3];
    assert(net.textContent.includes('Network'));
    assert.strictEqual(byClass(net, 'hc-ring__fill').length, 0, 'the network ring has no fill');
    assert(card.textContent.includes('Open in Beszel'));
    ok('rings carry their value in the centre; network has no fill');
  }

  {
    const h = load();
    const card = h.machineCard({ id: 'n', name: 'new', label: 'new', role: null, status: 'up', updatedAt: fresh,
      cpu: null, mem: { pct: null }, disk: { pct: null }, tempC: null, temps: [], netKBs: null, coresPct: [], history: [] }, Date.now(), null);
    assert(card.textContent.includes('No data yet'));
    assert(card.textContent.includes('—'));
    ok('an empty machine renders "—" and No data yet');
  }

  {
    const h = load({ api: async () => { const e = new Error('x'); e.status = 503; e.code = 'machines_unavailable'; throw e; } });
    await h.loadMachines();
    assert(h.byId.machines.textContent.includes('Unavailable'));
    assert(h.byId.summary.textContent.includes('Machines unavailable'));
    const u = load({ api: async () => { const e = new Error('x'); e.status = 503; e.code = 'machines_unconfigured'; throw e; } });
    await u.loadMachines();
    assert(u.byId.machines.textContent.includes('Not configured'));
    ok('machines unavailable shows in its section only');
  }

  {
    const h = load({ api: async () => ({ fetchedAt: new Date().toISOString(), beszelUrl: null, machines: [mini({ label: '<img src=x>' })] }) });
    await h.loadMachines();
    assert(h.byId.machines.textContent.includes('<img src=x>'), 'the label arrives as text');
    ok('labels are text, never markup');
  }

  // --- services -----------------------------------------------------------------------------
  {
    const h = load({ fetchImpl: async () => ({ ok: true, json: async () => ({ startedAt: new Date().toISOString(), build: 'abcdef123' }) }) });
    await h.loadApi();
    assert.strictEqual(h.byId.apiTime.textContent, '184 ms');
    assert.strictEqual(h.byId.apiState.textContent, 'Up');
    ok('the API card shows response time; the number does not change its state');
  }

  // --- restarts -----------------------------------------------------------------------------
  {
    const hour = 3600000;
    const boots = [
      { startedAt: new Date(NOW - 1 * hour).toISOString(), version: 'b' },
      { startedAt: new Date(NOW - 50 * hour).toISOString(), version: 'b' },
      { startedAt: new Date(NOW - 100 * hour).toISOString(), version: 'a' },
    ];
    const h = load({ api: async () => ({ boots }) });
    await h.loadBoots();
    const host = h.byId.boots;
    const squares = byClass(host, 'hc-sq');
    assert.strictEqual(squares.length, 30, 'one square a day');
    assert(squares.some((s) => s.className.includes('hc-sq--bad')), 'an unexpected restart is red');
    assert(squares.some((s) => s.className.includes('hc-sq--deploy')), 'a deploy is brass');
    assert(squares.some((s) => s.className.includes('hc-sq--unknown')), 'the oldest has nothing to compare');
    const red = squares.find((s) => s.className.includes('hc-sq--bad') && s.tag === 'button');
    red.listeners.click();
    const peek = byClass(host, 'hc-peek')[0];
    assert(peek.textContent.includes('restart with no deploy'));
    assert.strictEqual(red.attrs['aria-pressed'], 'true');
    const history = byClass(host, 'hc-exp')[0];
    assert(history.textContent.includes('Restart history (3)'));
    assert(history.textContent.includes('no deploy') && history.textContent.includes('deploy') && history.textContent.includes('build unknown'));
    assert(h.byId.summary.textContent.includes('Unexpected restart today'));
    ok('restart squares: brass deploy, red unexpected, grey unknown; history and chip follow');

    const many = Array.from({ length: 50 }, (_, i) => ({ startedAt: new Date(NOW - i * hour).toISOString(), version: String(i) }));
    const t = load({ api: async () => ({ boots: many }) });
    await t.loadBoots();
    assert(t.byId.boots.textContent.includes('Only the last 50 restarts are shown'));
    ok('a truncated restart history says so');
  }

  // --- deploys ------------------------------------------------------------------------------
  {
    const at = (i) => new Date(NOW - i * 3600000).toISOString();
    const runs = Array.from({ length: 22 }, (_, i) => ({ id: i, status: 'completed', conclusion: i === 0 ? 'failure' : i === 3 ? 'cancelled' : 'success',
      message: i === 0 ? 'fix: the thing' : 'feat: x', sha: 'sha' + i, durationMs: 60000, startedAt: at(i), url: 'https://github.test/run/' + i,
      failedStep: i === 0 ? 'check chat quotes' : null }));
    const data = { at: new Date().toISOString(), stale: false, unreachable: [], pipelines: [{ repo: 'r', workflow: 'Deploy the app to Dokploy', runs }] };
    const h = load({ api: async () => data });
    await h.loadDeploys();
    const host = h.byId.deploys;
    const strip = byClass(host, 'hc-strip')[0];
    const squares = strip.children;
    assert.strictEqual(squares.length, 20, 'the last 20 runs');
    assert(squares[19].className.includes('hc-sq--bad'), 'newest on the right');
    squares[19].listeners.click();
    const peek = byClass(host, 'hc-peek')[0];
    assert(peek.textContent.includes('fix: the thing') && peek.textContent.includes('sha0') && peek.textContent.includes('check chat quotes'));
    const link = find(peek, (n) => n.tag === 'a')[0];
    assert.strictEqual(link.href, 'https://github.test/run/0');
    ok('deploy strip per pipeline, newest on the right; a failed square names its step and links the log');

    const exp = byClass(host, 'hc-exp')[0];
    assert(exp.textContent.includes('Run history (22) · 1 failed, 1 cancelled'));
    const box = find(exp, (n) => n.tag === 'input')[0];
    box.checked = true;
    box.listeners.change();
    const rows = byClass(exp, 'hc-run');
    assert.strictEqual(rows.filter((r) => !r.hidden).length, 1, 'failed only leaves the one failed run');
    assert(h.byId.summary.textContent.includes('Last deploy failed'));
    ok('run history has a failed-only filter; the summary chip says the last deploy failed');
  }

  console.log(`admin-health: ${passed} passed`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
