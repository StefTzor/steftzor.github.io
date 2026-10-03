'use strict';

/**
 * scripts/mapping.js without a browser: the profile /data-mapping/ shows is the one its rules
 * compute, and the three records only link once they are normalised.
 */

const assert = require('assert');
const { T, profile, matches } = require('./mapping.js');

const p = Object.fromEntries(profile().map((r) => [r.target, r]));
const value = (k) => p[k].value;

assert.strictEqual(value('email'), 'anna.berg@example.com');
assert.strictEqual(value('secondary_email'), 'a.berg@work.example');
assert.strictEqual(value('phone'), '+46701234567');
assert.strictEqual(value('first_name'), 'Anna');
assert.strictEqual(value('last_name'), 'Berg-Lind');
assert.strictEqual(p.last_name.from, 'crm');
assert.strictEqual(p.last_name.conflict, true);
assert.strictEqual(value('birth_date'), '1990-07-02');
assert.strictEqual(value('marketing_consent'), true);
assert.strictEqual(value('first_purchase'), '2026-03-14');
assert.strictEqual(value('lifetime_value_sek'), 999);

// "agree" rules must actually agree; a disagreement there is a data bug, not a resolution.
for (const k of ['email', 'phone', 'first_name']) assert.strictEqual(p[k].conflict, false, k);

// The point of the page: every pair links, and none would have before normalising.
for (const m of matches()) {
  assert.ok(m.on.length > 0, `${m.a}-${m.b} has no shared key`);
  assert.deepStrictEqual(m.raw, [], `${m.a}-${m.b} matched raw`);
}

assert.strictEqual(T.e164[1]('070-123 45 67'), '+46701234567');
assert.strictEqual(T.e164[1]('0046701234567'), '+46701234567');
assert.strictEqual(T.e164[1]('+46 70 123 45 67'), '+46701234567');
assert.strictEqual(T.title[1]('BERG-LIND'), 'Berg-Lind');
assert.strictEqual(T.iso[1]('09/04/2026'), '2026-04-09');

console.log('mapping: ok');
