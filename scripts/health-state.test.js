'use strict';

/**
 * The health page's judgements, without a browser: when a reading is amber or red, what a machine
 * card says, which restarts were deploys, and what the summary at the top reports.
 *   node scripts/health-state.test.js
 *
 * The module is plain functions with no imports; `export` is stripped and it runs in a vm, the
 * way analytics-render.test.js loads app code.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../app/scripts/health-state.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(SRC.replace(/^export /gm, ''), ctx);
const { readingState, isStale, machineState, classifyRestarts, dayBuckets, summary } = ctx;

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

const NOW = Date.parse('2026-11-20T17:00:00Z');
const machine = (over = {}) => ({
  name: 'box-a', label: 'Box A', status: 'up', updatedAt: '2026-11-20T16:59:30Z',
  cpu: 1, mem: { pct: 13 }, disk: { pct: 10 }, tempC: 38, ...over,
});

{
  assert.strictEqual(readingState('cpu', 80), 'ok');
  assert.strictEqual(readingState('cpu', 80.1), 'warn');
  assert.strictEqual(readingState('mem', 90), 'warn');
  assert.strictEqual(readingState('disk', 91), 'bad');
  assert.strictEqual(readingState('temp', 70), 'ok');
  assert.strictEqual(readingState('temp', 71), 'warn');
  assert.strictEqual(readingState('temp', 81), 'bad');
  assert.strictEqual(readingState('mem', null), 'unknown');
  assert.strictEqual(readingState('cpu', undefined), 'unknown');
  ok('readings turn amber above 80 % / 70 °C and red above 90 % / 80 °C');
}

{
  assert.strictEqual(isStale(new Date(NOW - 181000).toISOString(), NOW), true);
  assert.strictEqual(isStale(new Date(NOW - 179000).toISOString(), NOW), false);
  assert.strictEqual(isStale(new Date(NOW + 30000).toISOString(), NOW), false, 'a clock ahead of ours is fresh');
  assert.strictEqual(isStale(null, NOW), true);
  ok('a machine is stale after 3 minutes; a timestamp from the future is fresh');
}

{
  assert.deepStrictEqual({ ...machineState(machine(), NOW) }, { state: 'ok', word: 'Healthy' });
  assert.deepStrictEqual({ ...machineState(machine({ disk: { pct: 92 }, mem: { pct: 85 } }), NOW) },
    { state: 'bad', word: 'Disk almost full' });
  assert.deepStrictEqual({ ...machineState(machine({ mem: { pct: 85 } }), NOW) }, { state: 'warn', word: 'Memory high' });
  assert.deepStrictEqual({ ...machineState(machine({ cpu: 95 }), NOW) }, { state: 'bad', word: 'CPU busy' });
  assert.deepStrictEqual({ ...machineState(machine({ tempC: 75 }), NOW) }, { state: 'warn', word: 'Running hot' });
  assert.deepStrictEqual({ ...machineState(machine({ status: 'down' }), NOW) }, { state: 'bad', word: 'Down' });
  assert.deepStrictEqual({ ...machineState(machine({ updatedAt: '2026-11-20T16:50:00Z' }), NOW) }, { state: 'bad', word: 'Down' });
  assert.deepStrictEqual({ ...machineState(machine({ cpu: null, mem: { pct: null }, disk: { pct: null }, tempC: null }), NOW) },
    { state: 'unknown', word: 'No data yet' });
  // Equal severity: disk outranks memory, memory outranks temperature, temperature outranks CPU.
  assert.strictEqual(machineState(machine({ cpu: 85, tempC: 75 }), NOW).word, 'Running hot');
  ok('a machine card takes its worst reading, and names it');
}

{
  const boots = [
    { startedAt: '2026-11-20T10:00:00Z', version: 'b' },
    { startedAt: '2026-11-19T10:00:00Z', version: 'b' },
    { startedAt: '2026-11-18T10:00:00Z', version: 'a' },
  ];
  assert.deepStrictEqual(classifyRestarts(boots).map((r) => r.kind), ['unexpected', 'deploy', 'unknown']);
  const withNull = [{ startedAt: 'x', version: null }, { startedAt: 'y', version: 'a' }];
  assert.deepStrictEqual(classifyRestarts(withNull).map((r) => r.kind), ['unknown', 'unknown']);
  assert.deepStrictEqual([...classifyRestarts([])], []);
  ok('restarts: a new build is a deploy, the same build is unexpected, a missing build is unknown');
}

{
  const items = [{ startedAt: new Date(NOW - 2 * 86400000).toISOString(), kind: 'unexpected' }];
  const days = dayBuckets(items, 30, NOW);
  assert.strictEqual(days.length, 30);
  const d = new Date(NOW);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.strictEqual(days[29].day, today);
  assert.deepStrictEqual([...days[27].kinds], ['unexpected']);
  assert.deepStrictEqual([...days[28].kinds], []);
  ok('the 30-day strip ends today and puts each restart on its day');
}

{
  const fine = { machines: [machine(), machine({ name: 'box-b' }), machine({ name: 'box-c' })], apiUp: true, appUp: true, latestDeploys: ['success', 'success'], restarts: [] };
  const s = summary(fine, NOW);
  assert.strictEqual(s.systems.word, 'All 5 systems healthy');
  assert.strictEqual(s.systems.state, 'ok');
  assert.strictEqual(s.systems.total, 5);
  assert.deepStrictEqual([...s.chips], []);

  const amber = summary({ ...fine, machines: [machine({ mem: { pct: 85 } }), machine(), machine()] }, NOW);
  assert.strictEqual(amber.systems.word, '1 needs attention');
  assert.strictEqual(amber.systems.attention, 1);
  assert.strictEqual(amber.systems.state, 'warn');

  const two = summary({ ...fine, apiUp: false, machines: [machine({ status: 'down' }), machine(), machine()] }, NOW);
  assert.strictEqual(two.systems.word, '2 need attention');
  assert.strictEqual(two.systems.state, 'bad');

  const off = summary({ ...fine, machines: null }, NOW);
  assert.strictEqual(off.systems.word, 'Machines unavailable');
  assert.strictEqual(off.systems.state, 'warn');

  // The likeliest real outage - the API down - also takes the machines with it. It must still be said.
  const apiDown = summary({ ...fine, machines: null, apiUp: false }, NOW);
  assert.strictEqual(apiDown.systems.word, '1 needs attention · machines unavailable');
  assert.strictEqual(apiDown.systems.state, 'bad');
  assert.deepStrictEqual([...summary({ ...fine, latestDeploys: ['success', 'failure'] }, NOW).chips], ['Last deploy failed']);
  const recent = [{ startedAt: new Date(NOW - 3 * 3600000).toISOString(), kind: 'unexpected' }];
  assert.deepStrictEqual([...summary({ ...fine, restarts: recent }, NOW).chips], ['Unexpected restart today']);
  const old = [{ startedAt: new Date(NOW - 30 * 3600000).toISOString(), kind: 'unexpected' }];
  assert.deepStrictEqual([...summary({ ...fine, restarts: old }, NOW).chips], []);
  ok('the summary counts five live systems and adds chips for a failed deploy or a restart today');
}

console.log(`health-state: ${passed} passed`);
