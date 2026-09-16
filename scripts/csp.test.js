/**
 * Content-Security-Policy invariants.  node scripts/csp.test.js
 *
 * The policy is generated in .eleventy.js from the built output, so the failure mode is not a
 * broken build - it is a live page whose own script is blocked, visible only in a console the
 * deploy never opens. This walks _site and checks that every page carries a policy which
 * actually permits what that page contains.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Both builds: _site is tzortzoglou.eu, _app is app.tzortzoglou.eu. The app is checked here
// too because it shares the transform - the first version of the app's CSP override silently
// dropped the inline-script hash, and nothing would have caught it if this only walked _site.
const ROOTS = ['_site', '_app'].map((d) => path.join(__dirname, '..', d)).filter(fs.existsSync);
if (!ROOTS.length) {
  console.log('csp: nothing built, skipping (run npm run build first)');
  process.exit(0);
}

const pages = [];
for (const root of ROOTS) {
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  })(root);
}
assert.ok(pages.length > 5, `expected the built site, found ${pages.length} pages`);

const sha256 = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
let hashed = 0;

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const where = path.relative(path.join(__dirname, '..'), page);

  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(meta, `${where} has no Content-Security-Policy`);
  const directives = Object.fromEntries(
    meta[1].split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)])
  );

  // Anything CSP cannot express a hash for. An inline handler or a javascript: URL would be
  // silently dead under this policy, so they must never reach the output.
  assert.ok(!/\son(?:click|load|error|submit|change|focus|mouse[a-z]+)="/.test(html),
    `${where} has an inline event handler, which this policy blocks`);
  assert.ok(!/href="javascript:/.test(html), `${where} has a javascript: URL, which this policy blocks`);

  // Every executable inline script must be hashed. JSON-LD is a data block and is exempt.
  for (const [, attrs, body] of html.matchAll(/<script((?![^>]*\ssrc=)[^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/ld\+json/.test(attrs)) continue;
    assert.ok(directives['script-src'].includes(sha256(body)),
      `${where}: an inline script is not covered by script-src`);
    hashed++;
  }
  for (const [, body] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    assert.ok(directives['style-src-elem'].includes(sha256(body)),
      `${where}: an inline <style> is not covered by style-src-elem`);
    hashed++;
  }

  // Every third party the page actually loads from must be allowed.
  const allowed = (directive, url) => directives[directive].includes(new URL(url).origin);
  for (const [, url] of html.matchAll(/<script[^>]*\ssrc="(https:\/\/[^"]+)"/g)) {
    assert.ok(allowed('script-src', url), `${where}: script-src does not allow ${url}`);
  }
  for (const [, url] of html.matchAll(/<img[^>]*\ssrc="(https:\/\/[^"]+)"/g)) {
    assert.ok(allowed('img-src', url), `${where}: img-src does not allow ${url}`);
  }
  for (const [, url] of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*\shref="(https:\/\/[^"]+)"/g)) {
    assert.ok(allowed('style-src-elem', url), `${where}: style-src-elem does not allow ${url}`);
  }
}

console.log(`csp: all checks passed — ${hashed} inline blocks hashed across ${pages.length} pages`);
