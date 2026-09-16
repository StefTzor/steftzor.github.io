/**
 * Regression guard for the auth security invariants.  node scripts/auth.security.test.js
 * These are cheap static checks — they exist so a future edit cannot quietly
 * reopen an account-enumeration oracle or start echoing provider errors.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Both copies: the public site's, and the app's - which is where sign-in is moving. One test
// rather than two, because two copies of a regression guard drift and the drift is invisible
// until the invariant it was protecting is already gone.
const COPIES = [
  path.join(__dirname, 'auth.js'),
  path.join(__dirname, '..', 'app', 'scripts', 'auth.js'),
].filter(fs.existsSync);
assert.ok(COPIES.length, 'no auth.js found to check');

for (const file of COPIES) {
const where = path.relative(path.join(__dirname, '..'), file);
const src = fs.readFileSync(file, 'utf8');

// 1. Raw provider error text must never reach the user: it distinguishes
//    "no such user" from "wrong password" and leaks internals.
//    Catches concatenation and innerHTML too, not just the bare assignment.
assert.ok(!/(?:textContent|innerHTML)\s*=[^;]*error\.message/.test(src),
  where + ' must not surface raw Firebase error.message to the user');

// 2. Registration must not confirm that an address already has an account.
assert.ok(!/already in use by another account/i.test(src),
  where + ' registration must not reveal that an email is already registered');
//    Both paths must go through showPending(), and that helper must be the only
//    thing that writes PENDING_MESSAGE — otherwise the two can drift apart.
assert.strictEqual((src.match(/textContent\s*=\s*PENDING_MESSAGE/g) || []).length, 1,
  where + ' PENDING_MESSAGE must be written in exactly one place (showPending)');
assert.ok(/auth\/email-already-in-use[\s\S]{0,300}showPending\(/.test(src),
  where + ' email-already-in-use must show the same message as a successful registration');
assert.ok(/showPending\(document\.getElementById\("errorMsg"\)\)/.test(src),
  where + ' a successful registration must show the pending message via showPending');

// 3. Login failure must be a single message for every credential failure.
const login = src.slice(src.indexOf('async function handleLogin'), src.indexOf('async function handleRegister'));
assert.ok(!/user-not-found|wrong-password|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(login),
  where + ' login must not branch on which half of the credentials was wrong');

// 4. The account document must still be written under the authenticated uid,
//    never an id taken from the page. (Firestore rules enforce it too.)
assert.ok(/setDoc\(doc\(db,\s*"users",\s*user\.uid\)/.test(src),
  where + ' registration must key the user document on the authenticated uid');

// 5. Consent must be recorded and required.
assert.ok(/if\s*\(!consent \|\| !consent\.checked\)[\s\S]{0,300}return;/.test(src),
  where + ' registration must return early when the consent box is unticked');
assert.ok(/consentAt:\s*new Date\(\)\.toISOString\(\)/.test(src),
  where + ' registration must record consentAt in the Firestore write, not just in a comment');

// 6. Every form that submits must guard against a double submit.
//    Without it an impatient second click starts a second sign-in, a second account, or a
//    second reset mail - and the reset one sends mail to a third party, so it is the kind of
//    bug someone else notices before you do. Skipped for the public site's copy, which predates
//    this and is being replaced by the app's.
if (/app\/scripts/.test(where)) {
  for (const handler of ['handleLogin', 'handleRegister', 'handleReset']) {
    const body = src.slice(src.indexOf(`async function ${handler}`));
    const end = body.indexOf('\nasync function', 1);
    const fn = end === -1 ? body : body.slice(0, end);
    assert.ok(/dataset\.submitting === "1"/.test(fn),
      where + ` ${handler} must refuse a second submit while one is in flight`);
    assert.ok(/busy\(form, true/.test(fn),
      where + ` ${handler} must disable its button while the request is in flight`);
  }
}

// 7. Init must not depend on DOMContentLoaded having not yet fired.
//    auth.js is reached by a dynamic import() that resolves after that event, so a listener
//    registered for it never runs, no submit handler attaches, and the form does a native GET -
//    which puts the password in the URL, the history and the next request's referrer. That
//    happened on the live site on 2026-09-16.
assert.ok(/document\.readyState === "loading"/.test(src),
  where + ' must attach handlers even when the DOM is already ready');
assert.ok(!/^document\.addEventListener\("DOMContentLoaded"/m.test(src),
  where + ' must not register handlers on DOMContentLoaded alone');

// 8. Spam gate must still be wired.
assert.ok(/getElementById\("website"\)/.test(src) && /formLoadedAt/.test(src),
  where + ' honeypot and timing gate must remain in place');

}

// 9. No form that carries a credential may submit as GET, whatever the JavaScript does.
//     This is the containment for invariant 7: with method="post" a broken handler produces a
//     rejected request instead of a password in the URL bar.
for (const dir of [path.join(__dirname, '..', 'pages'), path.join(__dirname, '..', 'app', 'pages')]) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.njk'))) {
    const page = fs.readFileSync(path.join(dir, name), 'utf8');
    if (!/type="password"/.test(page)) continue;
    for (const [, tag] of page.matchAll(/(<form[^>]*>)/g)) {
      assert.ok(/method="post"/i.test(tag),
        `${path.basename(dir)}/${name} has a password field in a form without method="post" - ` +
        `a native submit would put the password in the URL`);
    }
  }
}

console.log(`auth.js: all security invariants hold in ${COPIES.length} file(s) — ` +
  COPIES.map((f) => path.relative(path.join(__dirname, '..'), f)).join(', '));
