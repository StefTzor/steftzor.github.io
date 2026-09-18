'use strict';

/**
 * The Analytics dashboard's drawing, run without a browser.
 *
 * Every panel on /admin/analytics/ is built by hand out of DOM calls and inline SVG - a spline
 * converted from a Catmull-Rom, a 7x24 grid of cells, bar lists drawn as row backgrounds - none
 * of that is checkable by reading it. The page also cannot be opened without signing in through
 * Firebase, so a headless browser is not the cheap answer either.
 *
 * So the module is run the way scripts/consent.test.js runs the consent banner: its source is
 * read, its imports and its one side effect at the bottom are removed, and what is left is
 * evaluated against a DOM small enough to fit in this file. What is being checked is what a
 * reader cannot check by eye - that the arithmetic terminates, that nothing is NaN, that every
 * chart is paired with the table a screen reader gets, and that an absence is never drawn as a
 * measurement.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../app/scripts/admin-analytics.js'), 'utf8');

// --- the smallest DOM this module will run against --------------------------
// Enough for the calls it actually makes and no more. A node that is asked for something this
// does not have throws, which is the point: the shim failing is how a new browser dependency in
// the module announces itself, rather than being discovered in production.
function makeDom() {
  const byId = new Map();

  function element(tag) {
    const node = {
      tag,
      className: '',
      children: [],
      attrs: {},
      style: {},
      _text: '',
      get textContent() {
        return this.children.length
          ? this.children.map((c) => c.textContent).join('')
          : this._text;
      },
      set textContent(v) { this._text = String(v); this.children = []; },
      get lastChild() { return this.children[this.children.length - 1] || null; },
      append(...kids) { kids.forEach((k) => { if (k) this.children.push(k); }); },
      appendChild(kid) { this.children.push(kid); return kid; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener() {},
    };
    return node;
  }

  const document = {
    createElement: (tag) => element(tag),
    createElementNS: (ns, tag) => Object.assign(element(tag), { ns }),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, Object.assign(element('div'), { id }));
      return byId.get(id);
    },
  };
  return { document, byId };
}

/** Every node in a subtree, so a test can ask "is there a table under this panel". */
function walk(node, out = []) {
  out.push(node);
  node.children.forEach((c) => walk(c, out));
  return out;
}
const find = (node, fn) => walk(node).filter(fn);
const tags = (node, tag) => find(node, (n) => n.tag === tag);
const text = (node) => walk(node).map((n) => n._text).join(' ');

function load() {
  const { document, byId } = makeDom();
  // The imports and the one `profile.then(...)` at the bottom are what tie this module to a
  // browser and to Firebase. Everything between them is the drawing, which is what is under test.
  const body = SRC
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace(/profile\.then\([\s\S]*$/, '');
  const ctx = {
    document,
    // The two helpers the module imports from admin-status.js, reimplemented rather than stubbed
    // to nothing: `el` is how every panel finds its host, and a no-op would make every assertion
    // below pass against a page that drew nothing at all.
    el: (id) => document.getElementById(id),
    say: () => {},
    api: async () => { throw new Error('no network in this test'); },
    profile: { then: () => {} },
    console: { error: () => {} },
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(body, ctx);
  return { ctx, byId };
}

// --- a window with something in it ------------------------------------------
const DAILY = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-08-${String(i + 1).padStart(2, '0')}`.slice(0, 10),
  views: [0, 3, 9, 4, 0, 12, 7][i % 7],
}));

const FULL = {
  range: { days: 30, from: '2026-08-19T00:00:00.000Z', to: '2026-09-17T12:00:00.000Z', property: null },
  totals: {
    views: 100, previousViews: 80, visitors: 40, previousVisitors: 50,
    visits: 60, viewsPerVisit: 1.6667, bounceRate: 0.55, durationSeconds: 41.75,
  },
  live: { visitors: 2, views: 5 },
  unidentified: 3,
  daily: DAILY,
  hours: [{ dow: 1, hour: 9, views: 12 }, { dow: 5, hour: 20, views: 4 }],
  byBrowser: [{ value: 'Chrome', views: 60 }, { value: 'Safari', views: 30 },
    { value: 'Firefox', views: 4 }, { value: 'Edge', views: 3 }, { value: 'Opera', views: 2 },
    { value: 'Other', views: 1 }],
  byOs: [{ value: 'macOS', views: 70 }, { value: 'Windows', views: 30 }],
  byDevice: [{ value: 'desktop', views: 90 }, { value: 'phone', views: 10 }],
  byScreen: [{ value: 'desktop', views: 80 }, { value: 'phone', views: 20 }],
  topPaths: [{ property: 'site', path: '/', views: 40 }, { property: 'app', path: '/f1/', views: 12 }],
  byProperty: [{ property: 'site', views: 88 }, { property: 'app', views: 12 }],
  entryPages: [{ property: 'site', path: '/', visits: 30 }],
  exitPages: [{ property: 'site', path: '/cv/', visits: 18 }],
  referrers: [{ host: 'www.linkedin.com', views: 20 }, { host: null, views: 55 }],
  fromLinkedIn: 20,
  recent: [
    { started: '2026-09-17T11:00:00.000Z', seconds: 150, views: 3, entry: '/', exit: '/cv/',
      property: 'site', browser: 'Safari', os: 'macOS', device: 'desktop', screen: 'desktop' },
    { started: '2026-09-17T10:00:00.000Z', seconds: 0, views: 1, entry: '/portfolio/',
      exit: '/portfolio/', property: 'app', browser: 'Chrome', os: 'Android', device: 'phone',
      screen: 'phone' },
  ],
};

// An answer with the shape but nothing in it, which is the case that must not draw zeroes.
const EMPTY = {
  range: FULL.range,
  totals: { views: 0, previousViews: 0, visitors: 0, previousVisitors: 0, visits: 0,
    viewsPerVisit: 0, bounceRate: 0, durationSeconds: 0 },
  live: { visitors: 0, views: 0 },
  unidentified: 0, daily: DAILY.map((d) => ({ ...d, views: 0 })), hours: [],
  byBrowser: [], byOs: [], byDevice: [], byScreen: [], topPaths: [], byProperty: [],
  entryPages: [], exitPages: [], referrers: [], fromLinkedIn: 0, recent: [],
};

const PANELS = ['chart', 'heatmap', 'agents', 'paths', 'journeys', 'referrers', 'recent'];
const FIGURES = ['visitors', 'visits', 'views', 'live', 'perVisit', 'bounce', 'duration', 'linkedin'];

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

// --- a full window ----------------------------------------------------------
{
  const { ctx, byId } = load();
  ctx.render(FULL);

  FIGURES.forEach((id) => {
    const box = byId.get(id);
    assert.ok(box, id + ' was drawn');
    assert.ok(!('data-loading' in box.attrs), id + ' lost its loading dash');
    assert.ok(box.textContent && box.textContent !== '—', id + ' has a figure');
  });
  assert.strictEqual(byId.get('views').textContent, '100');
  assert.strictEqual(byId.get('visitors').textContent, '40');
  assert.strictEqual(byId.get('live').textContent, '2');
  assert.strictEqual(byId.get('perVisit').textContent, '1.7', 'a rate is rounded, not printed raw');
  assert.strictEqual(byId.get('bounce').textContent, '55%');
  assert.strictEqual(byId.get('duration').textContent, '42s');
  ok('every figure is drawn, and the derived ones are rounded to something readable');

  // Up against views, DOWN against visitors. Two directions from one answer, because a panel
  // that only ever computed one of them would look right on the day both moved the same way.
  assert.ok(byId.get('viewsNote').textContent.includes('+25%'), 'views rose a quarter');
  assert.ok(byId.get('visitorsNote').textContent.includes('-20%'), 'visitors fell a fifth');
  ok('a change is signed, and it is computed per figure rather than once');

  PANELS.forEach((id) => {
    const panel = byId.get(id);
    assert.ok(panel.children.length, id + ' drew something');
    assert.ok(!text(panel).includes('NaN') && !text(panel).includes('undefined'),
      id + ' contains no NaN and no undefined');
  });
  ok('every panel draws, and none of them prints NaN or undefined');

  // The rule this page states about itself: a picture is not an answer to somebody who cannot
  // see it. Every chart is aria-hidden AND paired with a table.
  ['chart', 'heatmap', 'agents', 'paths', 'journeys', 'referrers'].forEach((id) => {
    const panel = byId.get(id);
    assert.ok(tags(panel, 'table').length, id + ' carries a table');
    tags(panel, 'svg').forEach((svg) => {
      assert.strictEqual(svg.attrs['aria-hidden'], 'true', id + "'s svg is hidden from a reader");
    });
  });
  ok('every chart is hidden from assistive technology and paired with a table that is not');

  // The spline. Every coordinate finite, and it passes through the points rather than near them:
  // the first command is a move to the first point and the last curve ends on the last one.
  const paths = tags(byId.get('chart'), 'path');
  assert.strictEqual(paths.length, 2, 'an area and a line');
  const d = paths[1].attrs.d;
  assert.ok(/^M 0 [\d.]+/.test(d), 'the line starts at the first day');
  assert.ok(!/NaN|Infinity/.test(d), 'no coordinate is NaN or Infinity');
  assert.strictEqual((d.match(/C /g) || []).length, DAILY.length - 1, 'one curve per gap');
  const ends = d.trim().split(' ').slice(-2).map(Number);
  assert.strictEqual(ends[0], DAILY.length * 10, 'and ends on the last day, not short of it');
  assert.ok(Number.isFinite(ends[1]));
  assert.strictEqual(paths[1].attrs['vector-effect'], 'non-scaling-stroke',
    'the stroke does not thin when the viewBox is stretched');
  ok('the spline is finite, has one curve per gap, and reaches both ends of the range');

  // **No ring, and no ramp.** A donut coloured six nominal categories as six steps of one hue's
  // opacity, which is a value ramp doing a category's job and is a named anti-pattern; the bar
  // list underneath was already answering the same question with lengths from a common baseline.
  // The assertion is that neither came back: no <svg> in this panel at all, and every bar the
  // same colour rather than one shade per row.
  const agents = byId.get('agents');
  assert.strictEqual(tags(agents, 'svg').length, 0, 'the dimensions draw no ring');
  const fills = find(agents, (n) => n.className && n.className.includes('bg-brand-accent'));
  assert.ok(fills.length >= 6, 'every value is a bar');
  assert.deepStrictEqual([...new Set(fills.map((f) => f.className))].length, 1,
    'one colour for every bar - these categories have no order to encode as a shade');
  assert.ok(fills.every((f) => /^[\d.]+%$/.test(f.style.width)), 'and a width that is a percentage');
  assert.ok(text(agents).includes('leads'), 'the part-to-whole is a sentence, not a ring');
  ok('a nominal dimension is bars of one colour, and the value ramp on it is gone');

  // The spline's hover, which the bar chart had and the curve lost: one transparent full-height
  // target per day, so a value is reachable by pointing at the column rather than at the line.
  const hits = tags(byId.get('chart'), 'rect').filter((r) => r.attrs.fill === 'transparent');
  assert.strictEqual(hits.length, DAILY.length, 'one hover target per day');
  assert.ok(tags(hits[0], 'title').length, 'and each one names its day and count');

  // A sequential ramp with no key is five shades of nothing.
  const swatches = find(byId.get('heatmap'), (n) => n.className === 'contrib-day h-3 w-3');
  assert.strictEqual(swatches.length, 5, 'the heatmap carries a scale key');
  assert.ok(text(byId.get('heatmap')).includes('Quieter'), 'with both ends labelled');
  ok('the spline can be hovered and the heatmap says what darker means');

  // The heatmap: 7 rows of 24, and a cell with nothing in it keeps level 0 rather than being
  // given the faintest green - an empty hour has to read as an absence.
  const cells = find(byId.get('heatmap'), (n) => n.className === 'contrib-day');
  assert.strictEqual(cells.length, 7 * 24, 'every hour of every day has a cell');
  const lit = cells.filter((c) => 'data-level' in c.attrs);
  assert.strictEqual(lit.length, 2, 'only the two hours with views are lit');
  assert.strictEqual(lit[0].attrs['data-level'], '4', 'the busiest hour is the top of the ramp');
  ok('the heatmap is a full week of hours, and an empty hour is not given a colour');

  // The last-visits list, and the one thing it must never carry.
  const rows = tags(byId.get('recent'), 'tr');
  assert.strictEqual(rows.length, 3, 'a header row and two visits');
  const bounce = rows[2];
  assert.ok(text(bounce).includes('—'),
    'a one-page visit shows a dash for its length and its exit, not 0s');
  assert.ok(text(byId.get('recent')).includes('2m 30s'), 'and a real visit shows its length');
  assert.ok(!/visitor|Visitor/.test(text(byId.get('recent'))),
    'no visitor number reaches the screen');
  ok('a bounce shows a dash rather than a zero, and no visitor number is on the page');

  // The fifth caveat, which changes meaning with the window.
  assert.ok(byId.get('unidentifiedNote').textContent.includes('no address'),
    'inside 30 days a missing number is a fault');
  const short = load();
  short.ctx.render({ ...FULL, range: { ...FULL.range, days: 90 } });
  assert.ok(short.byId.get('unidentifiedNote').textContent.includes('erased'),
    'past 30 days the same figure is the retention promise working');
  ok('the unidentified note says which of the two things it means, from the window');
}

// --- a window with nothing in it --------------------------------------------
{
  const { ctx, byId } = load();
  ctx.render(EMPTY);

  // The whole rule of this page in one assertion: a nought drawn where nothing was counted is an
  // invention, and these three are the ones that would be most believable.
  ['perVisit', 'bounce', 'duration'].forEach((id) => {
    assert.strictEqual(byId.get(id).textContent, '—',
      id + ' is a dash, not a confident zero over no visits');
  });
  assert.strictEqual(byId.get('views').textContent, 'None yet');
  assert.strictEqual(byId.get('visitors').textContent, 'None yet');
  assert.strictEqual(byId.get('unidentifiedNote').textContent, '',
    'and the caveat about missing numbers says nothing when there are no views');

  PANELS.forEach((id) => {
    const said = text(byId.get(id));
    assert.ok(/nothing|Nothing/.test(said), id + ' says it is empty in words: ' + said.slice(0, 40));
    assert.ok(!tags(byId.get(id), 'svg').length, id + ' draws no picture of nothing');
  });
  ok('an empty window says so in words everywhere, and draws no chart of nothing');
}

// --- an answer that is missing half its fields ------------------------------
{
  // Not a hypothetical: the panel and the API deploy separately, so for a few minutes after a
  // deploy the page can be newer than the answer it is reading.
  const { ctx, byId } = load();
  ctx.render({});
  PANELS.forEach((id) => assert.ok(byId.get(id).children.length, id + ' still said something'));
  FIGURES.forEach((id) => assert.ok(byId.get(id).textContent, id + ' still said something'));
  assert.ok(!text(byId.get('chart')).includes('NaN'));
  ok('an answer with no fields in it draws a page rather than throwing');
}

// --- the failure path -------------------------------------------------------
{
  const { ctx, byId } = load();
  ctx.unavailable('The database did not answer.');
  FIGURES.forEach((id) => {
    assert.strictEqual(byId.get(id).textContent, '—');
    assert.ok('data-loading' in byId.get(id).attrs, id + ' goes back to not knowing');
  });
  PANELS.forEach((id) => assert.ok(text(byId.get(id)).includes('did not answer')));
  ok('a failure puts every figure back to a dash and says why on every panel');
}

console.log(`\nanalytics: all ${passed} checks passed — every chart has a table, and an absence is never drawn as a zero`);
