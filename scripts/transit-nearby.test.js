'use strict';

/**
 * Pressing "Near me" has to take the reader to the stops it found.
 *
 * **This is a regression test for a bug a reader found on a phone.** The button sits in the stop
 * picker at the top of /transit/; the list it fills, "Stops near you", is the last thing on the
 * page, below the board, the lines and a 28rem map. On success the code cleared the only note in
 * view and wrote the answer three screens down, so the button read as broken - nothing in the
 * viewport changed, and the picker it was pressed in stayed open and empty.
 *
 * So this runs the real `near()` against a stub DOM and asserts the reveal, not the render: the
 * list is un-hidden, the reader is moved to it, and the note says something. A check that only
 * counted the `<li>`s would have passed on the broken version - that part was never wrong.
 *
 * The vm technique and its limit (imports are stripped, so module linkage is invisible here) are
 * documented at length in f1-framing.test.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/transit.js'), 'utf8');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

/** What was done to the page, rather than what was put on it. */
const acted = { scrolled: [], focused: [] };

/** A DOM node as far as transit.js's vocabulary reaches. */
function node(tag, id) {
  const n = {
    tag, id, className: '', textContent: '', value: '', type: '', children: [],
    hidden: false, disabled: false, style: {},
    classes: new Set(),
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.children.push(c)); },
    scrollIntoView(opts) { acted.scrolled.push([this.id, opts]); },
    focus(opts) { acted.focused.push([this, opts]); },
    /** Depth-first, so a button nested inside its <li> is found the way querySelector finds it. */
    querySelector(sel) {
      for (const c of this.children) {
        if (c.tag === sel) return c;
        const deeper = c.querySelector(sel);
        if (deeper) return deeper;
      }
      return null;
    },
  };
  n.classList = {
    add: (c) => n.classes.add(c),
    remove: (c) => n.classes.delete(c),
    contains: (c) => n.classes.has(c),
    toggle: (c, on) => (on ? n.classes.add(c) : n.classes.delete(c)),
  };
  return n;
}

const page = new Map();
const byId = (id) => {
  if (!page.has(id)) page.set(id, node('div', id));
  return page.get(id);
};
byId('trNearby').classList.add('hidden');   // as the markup ships it
byId('trMap').classList.add('hidden');      // no map, so drawNearby returns before MapLibre

const STOPS = [
  { id: '740000001', name: 'Uppsala Centralstation', distance: 120, lat: 59.858, lon: 17.646 },
  { id: '740000002', name: 'Stora torget', distance: 340, lat: 59.859, lon: 17.639 },
];

let asked = null;
const ctx = {
  document: { getElementById: byId, createElement: (tag) => node(tag, null), addEventListener() {} },
  console: { error: () => {} },
  navigator: {
    geolocation: {
      // Answers straight away with a fix, which is the case under test. The returned promise is
      // how the test waits for the async callback the real API ignores the return value of.
      getCurrentPosition(success) { asked = success({ coords: { latitude: 59.8586, longitude: 17.6389 } }); },
    },
  },
  api: async (url) => { assert.ok(url.startsWith('/departures/nearby?'), url); return { stops: STOPS }; },
  profile: { then: () => {} },
  shortStop: (s) => s, inWords: () => '', towardsOf: () => '', remember: () => {},
  createMap: async () => null, goTo: () => {}, homeTo: () => {},
  window: { matchMedia: () => ({ matches: false }) },
};
vm.createContext(ctx);
vm.runInContext(SRC.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
  .replace(/profile\.then\([\s\S]*$/, ''), ctx);
assert.strictEqual(typeof ctx.near, 'function',
  'near() must stay a function declaration for this test to reach it');

(async () => {
  ctx.near();
  await asked;
  assert.ok(asked, 'near() asked this browser for a position');

  // 1. The list itself. Not the point of the file, but the reveal below means nothing without it.
  const list = byId('trNearList');
  assert.strictEqual(list.children.length, STOPS.length, 'every nearby stop is a row');
  ok(`the ${STOPS.length} stops the API returned are rendered as rows`);

  // 2. The section is no longer hidden. A scroll to a hidden element goes nowhere.
  assert.ok(!byId('trNearby').classList.contains('hidden'),
    '"Stops near you" is revealed, or there is nothing to scroll to');
  ok('the "Stops near you" section is revealed');

  // 3. **The regression.** The reader is taken to the answer.
  assert.deepStrictEqual(acted.scrolled.map(([id]) => id), ['trNearby'],
    'the page scrolls to the stops it just found, exactly once - this is the bug: the list was '
    + 'filled three screens below the button and nothing in the viewport moved');
  assert.strictEqual(acted.scrolled[0][1] && acted.scrolled[0][1].behavior, undefined,
    'instant, not smooth: three screens of animated scrolling is what reduced-motion refuses');
  ok('pressing Near me scrolls to the stops, instantly rather than smoothly');

  // 4. And so do the keyboard and the screen reader: the first stop is a button, and it is focused.
  assert.strictEqual(acted.focused.length, 1, 'exactly one thing took focus');
  const [focused, opts] = acted.focused[0];
  assert.strictEqual(focused.tag, 'button', 'and it is a button, not the section around it');
  assert.strictEqual(focused, list.children[0].querySelector('button'),
    'specifically the first stop in the list - the nearest one');
  assert.ok(opts && opts.preventScroll,
    'preventScroll, or the focus scrolls again to somewhere other than the block just chosen');
  ok('focus moves to the nearest stop, without undoing the scroll');

  // 5. The note never says nothing. It is the picker's live region and the only text in view.
  const note = byId('trPickNote').textContent;
  assert.ok(note && note.trim(), 'the picker note says what happened rather than being blanked');
  assert.ok(note.includes(String(STOPS.length)), `the note counts the stops: ${JSON.stringify(note)}`);
  ok(`the picker's live region says what happened: ${JSON.stringify(note)}`);

  console.log(`\n${passed} checks passed - Near me takes the reader to the stops`);
})().catch((err) => { console.error(err); process.exit(1); });
