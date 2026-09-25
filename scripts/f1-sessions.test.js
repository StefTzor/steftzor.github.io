'use strict';

/**
 * A practice never gets a results table, so the /f1/ page has to keep saying it happened.
 *
 * The upstream publishes results, qualifying and sprint and nothing else - there is no practice
 * classification anywhere in it - so Friday's only fact is a start time. renderRound used to drop
 * every session it had no table for AND whose time had passed, which meant a finished weekend
 * showed no trace of its three practices at all.
 *
 * This runs the real renderRound against a fabricated round, the same vm trick f1-framing.test.js
 * uses, and reads the tree it builds. The limit of that technique is written down there.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/f1-page.js'), 'utf8');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

/** A DOM node as far as this file's createElement/textContent/append vocabulary goes. */
const node = (tag) => ({
  tag, className: '', textContent: '', children: [], style: {},
  classList: { add() {} }, setAttribute() {}, addEventListener() {},
  appendChild(c) { this.children.push(c); return c; },
  append(...cs) { cs.forEach((c) => this.children.push(c)); },
});

/** Every node in the tree, flat, so an assertion can look for one without knowing the nesting. */
function flatten(n, out = []) {
  out.push(n);
  n.children.forEach((c) => flatten(c, out));
  return out;
}

const ctx = {
  document: { createElement: node, getElementById: () => null },
  console: { error: () => {} },
  say: () => {}, api: async () => ({}), profile: { then: () => {} },
  teamColour: () => '#000',
  createMap: async () => null, goTo: () => {}, frame: () => true,
  getComputedStyle: () => ({ getPropertyValue: () => '0 0 0' }),
};
// One roundBody per render, handed out by el() and kept here to be read afterwards.
let body = null;
ctx.el = (id) => (id === 'roundBody' ? body : node('span'));
vm.createContext(ctx);
vm.runInContext(PAGE.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
  .replace(/profile\.then\([\s\S]*$/, ''), ctx);
assert.strictEqual(typeof ctx.renderRound, 'function',
  'renderRound must stay a function declaration for this test to reach it');

const HOUR = 3600e3;
const session = (label, hoursFromNow) =>
  ({ label, at: new Date(Date.now() + hoursFromNow * HOUR).toISOString() });
const PRACTICES = ['Practice 1', 'Practice 2', 'Practice 3'];

const finisher = (position) => ({
  positionText: String(position), position,
  driver: { name: `Driver ${position}` }, constructor: { id: 'x', name: 'Team' },
  status: 'Finished', time: '1:30:00', points: 25, gained: 0, q1: '1:20.000',
});

/** renderRound against one round, returning the flat tree it wrote into #roundBody. */
function render(data) {
  body = node('div');
  ctx.renderRound(data);
  return flatten(body);
}

const race = (sessions) => ({
  round: 15, name: 'Test Grand Prix', locality: 'Nowhere', country: 'Testland',
  sprint: false, sessions,
});

/** Session rows as {label, struck}, read off the li that holds a span and a time. */
const rows = (tree) => tree.filter((n) => n.tag === 'li' && n.children.length === 2
  && n.children[1].tag === 'time')
  .map((n) => ({ label: n.children[0].textContent, struck: n.children[1].className.includes('line-through') }));

const heading = (tree) => tree.filter((n) => n.tag === 'h3').map((n) => n.textContent);

// 1. Nothing has run: every session listed, nothing struck through.
{
  const tree = render({ race: race([...PRACTICES.map((l, i) => session(l, 24 + i)),
    session('Qualifying', 48), session('Race', 72)]), over: false });
  assert.deepStrictEqual(rows(tree).map((r) => r.label),
    [...PRACTICES, 'Qualifying', 'Race'], 'a round with no results lists all five sessions');
  assert.ok(rows(tree).every((r) => !r.struck), 'and strikes none of them, because none has run');
  ok('a round that has not started lists every session, unstruck');
}

// 2. Mid-weekend: qualifying is a table, the practices are struck, the race keeps its time.
{
  const tree = render({
    race: race([...PRACTICES.map((l, i) => session(l, -48 + i)),
      session('Qualifying', -24), session('Race', 12)]),
    qualifying: [finisher(1)], over: false,
  });
  const got = rows(tree);
  assert.deepStrictEqual(got.map((r) => r.label), [...PRACTICES, 'Race'],
    'the practices survive and the race keeps its time; qualifying became a table');
  assert.deepStrictEqual(got.map((r) => r.struck), [true, true, true, false],
    'the practices are struck through, the race is not - it has not run');
  assert.ok(heading(tree).includes('Sessions'),
    '"Still to come" would be a lie about the three practices above it');
  ok('mid-weekend keeps the run practices, struck through, under a heading that fits');
}

// 3. Finished: results shown, and the practices are still there rather than dropped.
{
  const tree = render({
    race: race([...PRACTICES.map((l, i) => session(l, -72 + i)),
      session('Qualifying', -48), session('Race', -24)]),
    qualifying: [finisher(1)], raceResults: [finisher(1), finisher(2)], over: true,
  });
  const got = rows(tree);
  assert.deepStrictEqual(got.map((r) => r.label), PRACTICES,
    'this is the regression: a finished weekend used to show no practice at all');
  assert.ok(got.every((r) => r.struck), 'all of them struck through, all of them over');
  assert.ok(heading(tree).includes('Race result'), 'and the race result is still what leads');
  ok('a finished round still says its practices happened');
}

// 4. Every session covered by a table is gone from the list, not listed twice.
{
  const tree = render({
    race: race([session('Qualifying', -48), session('Sprint', -36), session('Race', -24)]),
    qualifying: [finisher(1)], sprintResults: [finisher(1)], raceResults: [finisher(1)],
    over: true,
  });
  assert.deepStrictEqual(rows(tree), [],
    'a weekend where every session has a table lists no sessions underneath it');
  ok('a session with a table is never also a row in the session list');
}

console.log(`\n${passed} checks passed - f1 session list`);
