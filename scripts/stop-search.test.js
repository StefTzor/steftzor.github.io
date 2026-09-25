'use strict';

/**
 * app/scripts/stop-search.js without a browser: the three promises its header makes.
 * Too short asks nothing, a slow old answer never replaces a newer one, and the same text is
 * asked once per page.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/stop-search.js'), 'utf8')
  .replace(/^export /m, '');

function setup() {
  const node = () => ({
    value: '', textContent: '', listeners: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    querySelectorAll: () => [],
  });
  const input = node();
  const list = node();
  const asked = [];
  const drawn = [];
  const notes = [];
  const pending = [];
  const ctx = { console: { error() {} }, setTimeout: () => 0, clearTimeout() {}, document: {} };
  vm.runInNewContext(`${SRC}\nthis.liveSearch = liveSearch;`, ctx);
  const s = ctx.liveSearch({
    input, list,
    // Each question waits until the test releases it, so replies can arrive out of order.
    fetchStops: (q) => { asked.push(q); return new Promise((res) => pending.push({ q, res })); },
    render: (stops) => drawn.push(stops),
    note: (t) => notes.push(t),
  });
  return { input, list, s, asked, drawn, notes, pending };
}

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

(async () => {
  try {
    {
      const t = setup();
      t.input.value = 'up';
      await t.s.now();
      assert.strictEqual(t.asked.length, 0, 'two letters ask nothing');
      assert.ok(/3 letters/.test(t.notes.pop()), 'and say how many are needed');
      assert.strictEqual(t.input.attrs.autocomplete, 'off', "the browser's own suggestions stay out of the way");
      ok('under three letters, nothing is spent and the page says why');
    }
    {
      const t = setup();
      t.input.value = 'upp';
      const first = t.s.now();
      t.input.value = 'uppsala c';
      const second = t.s.now();
      // The newer question is answered first, then the old one arrives late.
      t.pending[1].res([{ name: 'Uppsala Centralstation' }]);
      await second;
      t.pending[0].res([{ name: 'UPPSALA' }]);
      await first;
      assert.deepStrictEqual(t.drawn, [[{ name: 'Uppsala Centralstation' }]],
        'only the latest answer is drawn; the late one is dropped');
      ok('a slow reply to an older question never replaces a newer one');
    }
    {
      const t = setup();
      t.input.value = 'Portal';
      const p = t.s.now();
      t.pending[0].res([{ name: 'Portalgatan' }]);
      await p;
      t.input.value = 'portal';
      await t.s.now();
      assert.strictEqual(t.asked.length, 1, 'the same text in another case is not asked twice');
      assert.strictEqual(t.drawn.length, 2, 'but is drawn again, from memory');
      ok('backspacing over a letter redraws from memory rather than asking again');
    }
    {
      const t = setup();
      t.input.value = 'upps';
      const p = t.s.now();
      t.pending[0].res([{ name: 'Uppsala Centralstation' }, { name: 'UPPSALA' }]);
      await p;
      let prevented = 0;
      const tab = { key: 'Tab', shiftKey: false, preventDefault() { prevented += 1; } };
      t.input.listeners.keydown(tab);
      assert.strictEqual(t.input.value, 'Uppsala Centralstation', 'Tab fills in the top suggestion');
      assert.strictEqual(prevented, 1, 'and keeps focus in the box to do it');
      t.input.listeners.keydown(tab);
      assert.strictEqual(prevented, 1, 'a second Tab is left alone, so focus moves on as usual');
      t.input.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented += 1; } });
      assert.strictEqual(prevented, 1, 'and Shift+Tab is never taken');
      ok('Tab completes to the top stop, like a terminal, and never traps the keyboard');
    }
    console.log(`\nstop-search: all checks passed (${passed}) - quiet on the quota, and never out of order`);
  } catch (err) {
    console.error('\nFAILED:', err.message);
    process.exit(1);
  }
})();
