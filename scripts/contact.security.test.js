/**
 * Regression guard for the contact form.  node scripts/contact.security.test.js
 * Cheap static checks, in the same spirit as auth.security.test.js: a future edit must not
 * quietly drop the consent gate, the spam trap, or start echoing raw errors at visitors.
 */
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/contact.js', 'utf8');
const page = fs.readFileSync(__dirname + '/../pages/contact.njk', 'utf8');
const eleventy = fs.readFileSync(__dirname + '/../.eleventy.js', 'utf8');

// 1. Consent is the legal basis for storing the message (GDPR Art. 6(1)(a)). It must be an
//    unticked opt-in in the markup and an early return in the script.
assert.ok(/id="contactConsent"[^>]*required/.test(page.replace(/\s+/g, ' ')),
  'the consent checkbox must be present and required');
assert.ok(!/id="contactConsent"[^>]*checked/.test(page),
  'consent must not be pre-ticked — it would not be freely given');
assert.ok(/if \(!consent \|\| !consent\.checked\)[\s\S]{0,200}return;/.test(src),
  'contact.js must return early when consent is unticked');
assert.ok(/consent: true/.test(src), 'the submission must record that consent was given');

// 2. The spam trap must survive. It is the only anti-bot measure, chosen over a CAPTCHA so
//    no third-party tracking is shipped to visitors.
assert.ok(/id="website"/.test(page), 'the honeypot field must be present in the markup');
assert.ok(/aria-hidden="true"/.test(page), 'the honeypot must be hidden from screen readers too');
assert.ok(/website: document\.getElementById\("website"\)\.value/.test(src),
  'the honeypot value must be sent so the API can drop the submission');
assert.ok(/elapsedMs: Date\.now\(\) - loadedAt/.test(src),
  'the fill time must be sent so the API can drop instant submissions');

// 3. Raw errors must never reach the visitor — not the fetch error, not the API's body.
assert.ok(!/(?:textContent|innerHTML)\s*=[^;]*err(?:or)?\.message/.test(src),
  'contact.js must not surface a raw error message to the visitor');
assert.ok(!/res\.json\(\)/.test(src),
  'contact.js must not read and display the API error body');

// 4. Failure must stay generic, with exactly one message shared by every failure path.
assert.strictEqual((src.match(/var FAILED =/g) || []).length, 1,
  'there must be exactly one generic failure message');

// 5. Production must never talk to the API over plaintext.
assert.ok(/https:\/\/api\.tzortzoglou\.eu/.test(src), 'production must use the HTTPS API origin');
assert.ok(!/http:\/\/api\.tzortzoglou\.eu/.test(src), 'the API must never be addressed over http');

// 6. Eleventy copies scripts from an explicit map — an unlisted file is silently never
//    copied, so the page would ship referencing a script that does not exist.
assert.ok(/"scripts\/contact\.js": "scripts\/contact\.js"/.test(eleventy),
  'contact.js must be registered in the .eleventy.js passthrough map');
assert.ok(/\/scripts\/contact\.js/.test(page), 'contact.njk must load contact.js');

console.log('contact: all checks passed — consent required, trap intact, failures generic');
