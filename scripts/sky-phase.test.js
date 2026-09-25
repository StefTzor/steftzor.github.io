'use strict';

/**
 * The hero's time-of-day phase. Pure, so it is checked by value: one instant inside every window,
 * both edges of the two that are easiest to get backwards, and every input that must draw nothing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/sky-phase.js'), 'utf8')
  .replace(/^export /m, '');
const ctx = {};
vm.runInNewContext(SRC + '\nthis.skyPhase = skyPhase;', ctx);
const { skyPhase } = ctx;

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

// A late-September day in Uppsala: up 06:57, down 18:59, local time (UTC+2).
const UP = '2026-09-26T06:57:00+02:00';
const DOWN = '2026-09-26T18:59:00+02:00';
const at = (hhmm) => Date.parse(`2026-09-26T${hhmm}:00+02:00`);

const cases = [
  ['02:00', 'night'], ['06:11', 'night'], ['06:12', 'dawn'], ['07:26', 'dawn'], ['07:27', 'day'],
  ['12:00', 'day'], ['17:43', 'day'], ['17:44', 'golden'], ['18:43', 'golden'], ['18:44', 'dusk'],
  ['19:43', 'dusk'], ['19:44', 'night'], ['23:30', 'night'],
];
for (const [t, want] of cases) {
  assert.strictEqual(skyPhase(UP, DOWN, at(t)), want, `${t} should be ${want}`);
}
ok('every window, and both edges of each, land on the phase a person would call it');

for (const [up, down] of [[null, DOWN], [UP, undefined], ['', DOWN], ['nonsense', DOWN],
  [[UP], DOWN], [0, DOWN], [DOWN, UP]]) {
  assert.strictEqual(skyPhase(up, down, at('12:00')), null, `${JSON.stringify([up, down])} draws nothing`);
}
ok('missing, unreadable, non-string or reversed times draw no daylight rather than a guess');

console.log(`\nsky-phase: all checks passed (${passed}) - the card is right about the light outside`);
