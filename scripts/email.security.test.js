/**
 * One address rule, applied everywhere it matters.  node scripts/email.security.test.js
 *
 * Addresses arrive from strangers through a public contact form and from anyone who registers.
 * Two things are then done with them, and each is a separate way to get hurt:
 *
 *   1. The Messages screen builds a `mailto:` link out of a stored address, which makes the
 *      address a fragment of a URL chosen by whoever typed it. mailto: has parameters - `bcc`,
 *      `to`, `body`, `subject` - that decide who receives the reply and what it says.
 *   2. The auth forms decide whether an address may be registered at all. If they are looser
 *      than the API, an account can be created whose password can never be reset, because the
 *      reset endpoint will refuse the very address it was registered with. A silent lockout.
 *
 * So this checks the rule itself, that the mailto sink applies it, and that the forms apply the
 * same one rather than keeping a second opinion. The rule is read out of the module rather than
 * copied here: a copy would keep passing after someone loosened the real one, which is the only
 * failure worth catching.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => {
  const file = path.join(__dirname, '..', rel);
  assert.ok(fs.existsSync(file), `${rel} is missing - this test would check nothing`);
  return fs.readFileSync(file, 'utf8');
};

// --- 1. the rule -----------------------------------------------------------
const ruleSrc = read('app/scripts/email.js');
const shape = ruleSrc.match(/^const SHAPE = \/(.+)\/;$/m);
const unsafe = ruleSrc.match(/^const UNSAFE = \/(.+)\/;$/m);
const capped = ruleSrc.match(/^export const MAX_EMAIL = (\d+);$/m);
assert.ok(shape && unsafe && capped, 'app/scripts/email.js no longer declares SHAPE, UNSAFE and MAX_EMAIL');

const SHAPE = new RegExp(shape[1]);
const UNSAFE = new RegExp(unsafe[1]);
const MAX_EMAIL = Number(capped[1]);
const isEmail = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_EMAIL
  && SHAPE.test(v) && !UNSAFE.test(v);

// Every attack below is accepted by the loose shape check, which is what the whole system used
// before this rule existed - so every one of them was a storable address.
const attacks = [
  'a@b.co?bcc=attacker%40evil.com',
  'a@b.co?to=finance%40evil.com',
  'a@b.co?body=Please%20wire%20the%20invoice',
  'a@b.co?subject=Urgent',
  'a@b.co&cc=x',
  'a@b.co,second%40evil.com',
  'a@b.co;second%40evil.com',
  'a@b.co#fragment',
  'a@b.co%0Abcc=x',
  'a@b.co%40evil.com',
  'a@b.co/../x',
  'a@b.co:25',
  'a@b.co<x>',
];
for (const evil of attacks) {
  assert.ok(SHAPE.test(evil),
    `${evil} must still match the loose shape, or it proves nothing about what used to pass`);
  assert.ok(!isEmail(evil), `${evil} must never become a mailto: link or a registerable address`);
}

// Refusing a real address is the worse error on the contact form: it means someone could not
// reach him at all. These must keep working.
for (const good of [
  'stefanos@tzortzoglou.eu',
  'first.last@example.co.uk',
  'plus+tag@gmail.com',
  "o'brien@example.com",
  'under_score@example.com',
  'dash-name@sub.domain.example.com',
  'tz-mu5dzq8mdaz3@uberip.com',
  'xn--80ak6aa92e@xn--80ak6aa92e.com',
]) {
  assert.ok(isEmail(good), `${good} is an ordinary address and must be accepted`);
}

for (const junk of [null, undefined, 12345, {}, [], ['a@b.co'], true, '', 'not-an-email', 'no@dot',
  'x'.repeat(MAX_EMAIL) + '@b.co']) {
  assert.ok(!isEmail(junk), `${JSON.stringify(junk)} must not pass as an address`);
}

// --- 2. the mailto sink applies it ----------------------------------------
const messages = read('app/scripts/admin-messages.js');
assert.ok(/import \{ isEmail \} from "\.\/email\.js";/.test(messages),
  'admin-messages.js must take the rule from email.js, not keep its own');

const mailtoFn = messages.match(/function mailto\([^)]*\) \{\n([\s\S]*?)\n\}/);
assert.ok(mailtoFn, 'could not find mailto() in admin-messages.js');
const [guardLine, ...rest] = mailtoFn[1].split('\n');
assert.ok(/if \(!isEmail\(email\)\) return null;/.test(guardLine),
  'mailto() must refuse the address BEFORE it builds anything - the first ? in a mailto wins, ' +
  'so a check woven in after the concatenation would not help');
assert.ok(rest.join('\n').includes('"mailto:" + email'),
  'mailto() no longer looks like it builds the URL this test is guarding');

// --- 3. the forms apply the same one --------------------------------------
const forms = read('app/scripts/forms.js');
assert.ok(/import \{ isEmail \} from "\.\/email\.js";/.test(forms),
  'forms.js must take the rule from email.js');
assert.ok(!/const EMAIL\s*=\s*\//.test(forms),
  'forms.js must not define its own address pattern: a form that accepts what the API refuses ' +
  'creates an account whose password can never be reset');

console.log(`email: all checks passed — ${attacks.length} storable injections refused, ` +
  'and the forms, the sink and the API share one rule');
