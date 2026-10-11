'use strict';

/**
 * The live-bus layer on /transit/: what it asks for, when it asks, and how a bus gets from one
 * answer to the next.
 *   node scripts/live-buses.test.js
 *
 * live-buses-core.js has no imports, so it is run here in a vm exactly as the browser runs it,
 * with `export ` stripped (the technique stop-search.test.js uses). Timers are a hand-cranked
 * queue, so "fifteen seconds later" is a function call rather than a wait.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/live-buses-core.js'), 'utf8')
  .replace(/^export /gm, '');
const NAMES = ['clampBox', 'busesQuery', 'frameAt', 'onScreen', 'ago', 'describe', 'statusLine',
  'debounce', 'createPoller', 'ensureBusLayers', 'MAX_SPAN', 'NEAR', 'POLL_MS', 'SOURCE', 'LAYERS'];
const ctx = { console };
vm.runInNewContext(`${SRC}\n${NAMES.map((n) => `this.${n} = ${n};`).join('\n')}`, ctx);
const core = ctx;

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

/** setTimeout/clearTimeout that only fire when told to. */
function clock() {
  let t = 0;
  let seq = 0;
  const due = new Map();
  return {
    timers: {
      set: (fn, ms) => { seq += 1; due.set(seq, { fn, at: t + ms }); return seq; },
      clear: (id) => { due.delete(id); },
    },
    async advance(ms) {
      t += ms;
      for (const [id, d] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (d.at <= t && due.has(id)) { due.delete(id); await d.fn(); }
      }
      await new Promise((r) => setImmediate(r));
    },
    pending: () => due.size,
  };
}

(async () => {
  // --- what is asked for ------------------------------------------------------
  {
    const stop = [17.64, 59.85];
    const q = core.busesQuery({ mode: 'lines', lines: ['2', '2', '801', 'Buss 4'], stop, bounds: null });
    assert.strictEqual(q, 'bbox=17.54000,59.80000,17.74000,59.90000&lines=2%2C801',
      'lines mode: distinct, valid line names around the stop');
    assert.strictEqual(core.busesQuery({ mode: 'lines', lines: [], stop, bounds: null }), null,
      'no lines on the board: nothing to ask, nothing spent');
    assert.strictEqual(core.busesQuery({ mode: 'lines', lines: ['2'], stop: null, bounds: null }), null,
      'no stop coordinate: nothing to ask');
    const many = Array.from({ length: 20 }, (_, i) => String(i + 1));
    assert.strictEqual(decodeURIComponent(core.busesQuery({ mode: 'lines', lines: many, stop, bounds: null }).split('lines=')[1]).split(',').length, 12,
      'at most twelve lines, which is what the API accepts');
    ok('"Your lines" asks for the board\'s distinct lines near the stop, or for nothing');

    const wide = core.busesQuery({ mode: 'all', lines: [], stop, bounds: [16.0, 59.0, 19.0, 60.5] });
    const [w, s, e, n] = wide.slice(5).split(',').map(Number);
    assert.ok(e - w <= core.MAX_SPAN.lon && n - s <= core.MAX_SPAN.lat, 'a zoomed-out map is cut to the largest box the API takes');
    assert.ok(Math.abs((w + e) / 2 - 17.5) < 1e-4 && Math.abs((s + n) / 2 - 59.75) < 1e-4, 'around the map\'s centre');
    assert.ok(!wide.includes('lines='), '"All of Uppsala" filters by nothing');
    const small = core.busesQuery({ mode: 'all', lines: [], stop, bounds: [17.6, 59.84, 17.7, 59.87] });
    assert.strictEqual(small, 'bbox=17.60000,59.84000,17.70000,59.87000', 'a box inside the limit is sent as it is');
    ok('"All of Uppsala" asks for the map\'s bounds, cut down to the API\'s limit when zoomed out');
  }

  // --- the glide ----------------------------------------------------------------
  {
    const from = new Map([
      ['A', { id: 'A', lon: 17.60, lat: 59.80, line: '2' }],
      ['GONE', { id: 'GONE', lon: 17.70, lat: 59.90, line: '5' }],
    ]);
    const to = [
      { id: 'A', lon: 17.62, lat: 59.84, line: '2', headsign: 'Gränbystaden', at: '2026-10-12T16:00:00Z' },
      { id: 'NEW', lon: 17.65, lat: 59.85, line: '801' },
    ];
    const half = core.frameAt(from, to, 0.5);
    // Through JSON: arrays made inside the vm have the vm's Array prototype, and deepStrictEqual
    // compares prototypes.
    const at = (fc, id) => JSON.parse(JSON.stringify(fc.features.find((f) => f.properties.id === id) || null));
    assert.deepStrictEqual(at(half, 'A').geometry.coordinates.map((x) => +x.toFixed(5)), [17.61, 59.82], 'halfway is halfway');
    assert.deepStrictEqual(at(half, 'NEW').geometry.coordinates, [17.65, 59.85], 'a new bus appears where it is');
    assert.strictEqual(at(half, 'GONE').properties.opacity, 0.5, 'a gone bus is half faded at half time');
    const end = core.frameAt(from, to, 1);
    assert.deepStrictEqual(at(end, 'A').geometry.coordinates, [17.62, 59.84], 'and arrives exactly');
    assert.strictEqual(at(end, 'GONE'), null, 'at the end the gone bus is gone');
    assert.deepStrictEqual([...core.onScreen(half).keys()], ['A', 'NEW'], 'a fading bus is not a starting point for the next glide');
    ok('a glide moves buses linearly, shows new ones at once and fades the gone ones out');
  }

  // --- words --------------------------------------------------------------------
  {
    const now = Date.parse('2026-10-12T16:00:12Z');
    const at = '2026-10-12T16:00:00Z';
    assert.deepStrictEqual({ ...core.describe({ line: '2', headsign: 'Gränbystaden', at }, now) },
      { strong: '2', text: ' → Gränbystaden · 12 s ago' });
    assert.deepStrictEqual({ ...core.describe({ line: '', at }, now) }, { strong: '', text: 'Bus · 12 s ago' });
    assert.strictEqual(core.ago(at, Date.parse(at) - 3000), '0 s ago', 'a clock ahead of the server says 0, not -3');
    assert.strictEqual(core.ago(at, Date.parse(at) + 190000), '3 min ago');
    ok('the popup reads "2 → Gränbystaden · 12 s ago", or "Bus · 12 s ago" with no line');

    assert.strictEqual(core.statusLine({ data: { stale: false, updatedAt: at }, now: Date.parse(at) + 8000 }), 'Live · updated 8 s ago');
    assert.strictEqual(core.statusLine({ data: { stale: true, reason: 'budget', updatedAt: null }, now }),
      'Live positions paused for today (daily limit). Times on the board are still live.');
    assert.strictEqual(core.statusLine({ data: { stale: true, reason: 'upstream', updatedAt: at }, now }), 'Live positions unavailable right now.');
    assert.strictEqual(core.statusLine({ error: { status: 502 }, now }), 'Live positions unavailable right now.');
    const copy = [core.statusLine({ data: { stale: true, reason: 'budget' }, now }), core.describe({ line: '2', at }, now).text].join(' ');
    assert.ok(!copy.includes('—'), 'no em dashes in the copy');
    ok('the status line says live, paused for the day, or unavailable');
  }

  // --- the poll gate --------------------------------------------------------------
  {
    const c = clock();
    let runs = 0;
    const p = core.createPoller({ run: async () => { runs += 1; }, every: 15000, timers: c.timers });
    p.set({ visible: true });
    assert.strictEqual(runs, 0, 'visible but scrolled away: nothing');
    p.set({ intersecting: true });
    await c.advance(0);
    assert.strictEqual(runs, 1, 'visible and on screen: at once');
    await c.advance(15000);
    assert.strictEqual(runs, 2, 'then every fifteen seconds');
    p.set({ visible: false });
    await c.advance(60000);
    assert.strictEqual(runs, 2, 'a hidden tab asks nothing');
    assert.strictEqual(c.pending(), 0, 'and has no timer waiting');
    p.set({ visible: true });
    await c.advance(0);
    assert.strictEqual(runs, 3, 'coming back asks at once rather than waiting out the interval');
    p.set({ intersecting: false });
    await c.advance(60000);
    assert.strictEqual(runs, 3, 'a map scrolled out of view asks nothing');
    ok('polls every 15 s only while visible and on screen, and at once on coming back');
  }
  {
    const c = clock();
    let release;
    let runs = 0;
    const p = core.createPoller({ run: () => { runs += 1; return new Promise((r) => { release = r; }); }, every: 15000, timers: c.timers });
    p.set({ visible: true, intersecting: true });
    p.set({ visible: false });   // the tab is hidden while the first request is in the air
    release();
    await c.advance(60000);
    assert.strictEqual(runs, 1, 'the answer lands, and nothing is scheduled after it');
    assert.strictEqual(c.pending(), 0);
    ok('a tab hidden mid-fetch lets the fetch finish and schedules nothing');
  }
  {
    const c = clock();
    let release = () => {};
    let runs = 0;
    const p = core.createPoller({ run: () => { runs += 1; return new Promise((r) => { release = r; }); }, every: 15000, timers: c.timers });
    p.set({ visible: true, intersecting: true });
    const pan = core.debounce(() => p.now(), 300, c.timers);
    for (let i = 0; i < 20; i++) { pan(); await c.advance(50); }   // a second of dragging
    await c.advance(300);
    assert.strictEqual(runs, 1, 'twenty moveends and a request in flight: still one request');
    p.now();
    p.now();
    release();
    await c.advance(0);
    assert.strictEqual(runs, 2, 'requests asked for during a fetch collapse into one more');
    ok('rapid moveends are debounced and never stack requests');
  }

  // --- the layer survives a style switch ------------------------------------------
  {
    function fakeMap() {
      const sources = new Map();
      const layers = [];
      return {
        sources, layers,
        getSource: (id) => sources.get(id),
        addSource: (id, spec) => sources.set(id, { spec, data: spec.data, setData(d) { this.data = d; } }),
        addLayer: (l) => { layers.push(l.id); },
        getLayer: (id) => layers.includes(id),
        removeLayer: (id) => layers.splice(layers.indexOf(id), 1),
        removeSource: (id) => sources.delete(id),
        setStyle() { sources.clear(); layers.length = 0; },
      };
    }
    const ink = (t) => `rgb(${t})`;
    const map = fakeMap();
    const one = { type: 'FeatureCollection', features: [] };
    core.ensureBusLayers(map, ink, one);
    assert.deepStrictEqual([...map.layers], [...core.LAYERS]);
    assert.strictEqual(map.sources.get(core.SOURCE).spec.cluster, true);
    assert.strictEqual(map.sources.get(core.SOURCE).spec.clusterMaxZoom, 13);
    const two = { type: 'FeatureCollection', features: [{}] };
    core.ensureBusLayers(map, ink, two);
    assert.strictEqual(map.layers.length, 4, 'a second call updates the data and adds nothing');
    assert.strictEqual(map.sources.get(core.SOURCE).data, two);
    map.setStyle();
    core.ensureBusLayers(map, ink, two);
    assert.deepStrictEqual([...map.layers], [...core.LAYERS], 'after a style switch the layers are back');
    assert.strictEqual(map.sources.get(core.SOURCE).data, two, 'with the buses that were showing');
    ok('the clustered bus source and its layers are rebuilt after a style switch');

    const broken = fakeMap();
    let n = 0;
    broken.addLayer = (l) => { n += 1; if (n === 3) throw new Error('bad paint'); broken.layers.push(l.id); };
    ctx.console = { ...console, error() {} };   // the failure is logged; this run expects it
    core.ensureBusLayers(broken, ink, one);
    ctx.console = console;
    assert.strictEqual(broken.layers.length, 0, 'half-built layers are removed');
    assert.strictEqual(broken.sources.size, 0, 'and the source, so the next style.load can try again');
    ok('a layer that fails to add leaves nothing half-built behind');
  }

  // --- the wiring, read from source --------------------------------------------
  // live-buses.js imports the shell and touches the page, so it is not run here; what can go
  // wrong in it without an error is the wiring, and that is asserted from the text, as
  // basemap.test.js does for the satellite toggle.
  {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const LIVE = read('app/scripts/live-buses.js');
    const TRANSIT = read('app/scripts/transit.js');
    const PAGE = read('app/pages/transit.njk');
    assert.ok(LIVE.includes('map.on("style.load", () => ensureBusLayers(map, ink, latest))'),
      'the bus layers are re-added on every style.load, with the buses that were showing');
    assert.ok(LIVE.includes('visibilitychange') && LIVE.includes('IntersectionObserver'),
      'the poll gate is fed by tab visibility and by the map being on screen');
    assert.ok(LIVE.includes('stillness()') && /^export const stillness/m.test(read('app/scripts/map.js')),
      'motion asks map.js about reduced motion, like every camera move');
    const route = TRANSIT.indexOf('map.on("style.load", drawRoute);');
    assert.ok(route > 0 && route < TRANSIT.indexOf('startLiveBuses({'),
      'buses start after the route, so their layers are re-added above it');
    for (const id of ['trBusMode', 'trBusMine', 'trBusAll', 'trBusNote', 'trBusSay']) {
      assert.ok(PAGE.includes(`id="${id}"`), `#${id} is on the page`);
    }
    assert.ok(/id="trBusSay"[^>]*aria-live="polite"/.test(PAGE), 'a mode change is announced');
    assert.ok(!/id="trBusNote"[^>]*aria-live/.test(PAGE), 'the line rewritten every 15 s is not a live region');
    const ELEVENTY = read('eleventy.app.js');
    for (const f of ['live-buses.js', 'live-buses-core.js']) {
      assert.ok(ELEVENTY.includes(`"app/scripts/${f}": "scripts/${f}"`), `${f} is copied into the build`);
    }
    assert.ok(/const SATELLITE = \{[\s\S]*?glyphs: "https:\/\/tiles\.openfreemap\.org\/fonts\/\{fontstack\}\/\{range\}\.pbf"[\s\S]*?\n\};/.test(read('app/scripts/map.js')),
      'the satellite style has glyphs, or the bus text throws there and the layer is dropped');
    assert.ok(/#trBusMode:has\(~ #trMap\.hidden\)\s*\{\s*display:\s*none/.test(read('src/input.css')),
      'the bus switch is hidden when the map is');
    ok('wired: re-added on style.load, gated on visibility and view, announced only on a mode change, shipped');
  }


  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
