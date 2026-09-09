/**
 * Regression guard for the auth security invariants.  node scripts/auth.security.test.js
 * These are cheap static checks — they exist so a future edit cannot quietly
 * reopen an account-enumeration oracle or start echoing provider errors.
 */
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/auth.js', 'utf8');

// 1. Raw provider error text must never reach the user: it distinguishes
//    "no such user" from "wrong password" and leaks internals.
//    Catches concatenation and innerHTML too, not just the bare assignment.
assert.ok(!/(?:textContent|innerHTML)\s*=[^;]*error\.message/.test(src),
  'auth.js must not surface raw Firebase error.message to the user');

// 2. Registration must not confirm that an address already has an account.
assert.ok(!/already in use by another account/i.test(src),
  'registration must not reveal that an email is already registered');
//    Both paths must go through showPending(), and that helper must be the only
//    thing that writes PENDING_MESSAGE — otherwise the two can drift apart.
assert.strictEqual((src.match(/textContent\s*=\s*PENDING_MESSAGE/g) || []).length, 1,
  'PENDING_MESSAGE must be written in exactly one place (showPending)');
assert.ok(/auth\/email-already-in-use[\s\S]{0,300}showPending\(/.test(src),
  'email-already-in-use must show the same message as a successful registration');
assert.ok(/showPending\(document\.getElementById\("errorMsg"\)\)/.test(src),
  'a successful registration must show the pending message via showPending');

// 3. Login failure must be a single message for every credential failure.
const login = src.slice(src.indexOf('async function handleLogin'), src.indexOf('async function handleRegister'));
assert.ok(!/user-not-found|wrong-password|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(login),
  'login must not branch on which half of the credentials was wrong');

// 4. The account document must still be written under the authenticated uid,
//    never an id taken from the page. (Firestore rules enforce it too.)
assert.ok(/setDoc\(doc\(db,\s*"users",\s*user\.uid\)/.test(src),
  'registration must key the user document on the authenticated uid');

// 5. Consent must be recorded and required.
assert.ok(/if\s*\(!consent \|\| !consent\.checked\)[\s\S]{0,300}return;/.test(src),
  'registration must return early when the consent box is unticked');
assert.ok(/consentAt:\s*new Date\(\)\.toISOString\(\)/.test(src),
  'registration must record consentAt in the Firestore write, not just in a comment');

// 6. Spam gate must still be wired.
assert.ok(/getElementById\("website"\)/.test(src) && /formLoadedAt/.test(src),
  'honeypot and timing gate must remain in place');

console.log('auth.js: all 6 security invariants hold');
