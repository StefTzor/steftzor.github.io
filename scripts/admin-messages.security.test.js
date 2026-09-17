/**
 * The Reply link cannot be turned into someone else's email.
 *   node scripts/admin-messages.security.test.js
 *
 * Every address on the Messages screen was typed by a stranger into a public contact form, and
 * the only thing that screen does with it besides print it is build a mailto: URL. That makes the
 * address a URL fragment supplied by an attacker, and mailto: has query parameters - `bcc`, `to`,
 * `body`, `subject` - that decide who receives your reply and what it says.
 *
 * The pattern this checks was a blocklist ("no spaces, no @, no angle brackets") that accepted
 * `a@b.co?bcc=attacker%40evil.com`: a valid-looking address the API stores happily, and a mailto
 * that blind-copies a stranger when the administrator clicks Reply. Appending our own `?subject=`
 * does not help - the first `?` in a mailto wins.
 *
 * The regex is read out of the module rather than copied here. A copy would keep passing after
 * someone loosened the real one, which is the only failure this test exists to catch.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'app', 'scripts', 'admin-messages.js');
assert.ok(fs.existsSync(file), `${file} is missing - this test would check nothing`);
const src = fs.readFileSync(file, 'utf8');

const pattern = src.match(/^const MAILTO = (\/.+\/);$/m);
assert.ok(pattern, 'could not find the MAILTO pattern in admin-messages.js');
const MAILTO = new RegExp(pattern[1].slice(1, -1));

const capped = src.match(/^const MAX_EMAIL = (\d+);/m);
assert.ok(capped, 'admin-messages.js no longer caps the address length');
const MAX_EMAIL = Number(capped[1]);

// The guard must be the length AND the pattern, in mailto() itself - not at either call site,
// where the next caller would forget it.
const guard = src.match(/function mailto\([^)]*\) \{\n([^\n]*)/);
assert.ok(guard, 'could not find mailto() in admin-messages.js');
for (const check of ['typeof email !== "string"', 'email.length > MAX_EMAIL', '!MAILTO.test(email)']) {
  assert.ok(guard[1].includes(check),
    `mailto() must reject on ${check} before building a URL, not at the call sites`);
}
assert.ok(guard[1].includes('return null'), 'mailto() must return null rather than a partial URL');

const ok = (email) => typeof email === 'string' && email.length <= MAX_EMAIL && MAILTO.test(email);

// --- addresses that must never become a link -------------------------------
// Each one is accepted by the API's own /^[^\s@]+@[^\s@]+\.[^\s@]+$/, so each one is storable.
for (const evil of [
  'a@b.co?bcc=attacker%40evil.com',      // a silent blind copy of your reply
  'a@b.co?to=finance%40evil.com',        // a second recipient
  'a@b.co?body=Please%20wire%20it',      // your reply, written for you
  'a@b.co?subject=Urgent',               // the first ? wins, so ours is ignored
  'a@b.co&cc=x',                         // the separator without the leading ?
  'a@b.co#frag',
  'a@b.co%0Abcc=x',                      // an encoded newline, in case a client unfolds it
  'a@b.co/../x',
  'a@b.co%2Fx',
  'a@b."co',
  "a@b.co'x",
  'a'.repeat(MAX_EMAIL) + '@b.co',       // over the cap
]) {
  assert.ok(!ok(evil), `${evil} must not be turned into a mailto: link`);
}

// --- ordinary addresses that must keep working -----------------------------
// A rejected address still renders, it just loses its link - but rejecting real ones would make
// the Reply button useless, which is a quieter kind of broken.
for (const good of [
  'stefanos@tzortzoglou.eu',
  'first.last@example.co.uk',
  'plus+tag@gmail.com',
  'under_score@example.com',
  'dash-name@sub.domain.example.com',
  'digits123@example123.com',
  'xn--80ak6aa92e@xn--80ak6aa92e.com',   // an IDN domain, already punycoded
]) {
  assert.ok(ok(good), `${good} is an ordinary address and must still get a Reply link`);
}

console.log('admin messages: all checks passed — the Reply link cannot be redirected or rewritten');
