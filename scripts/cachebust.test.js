/**
 * Cache-busting invariants.  node scripts/cachebust.test.js
 * Runs against the built _site, so it fails if the transform is dropped or stops matching.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', '_site');
if (!fs.existsSync(SITE)) {
  console.log('cachebust: _site not built, skipping (run npm run build first)');
  process.exit(0);
}

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) pages.push(full);
  }
})(SITE);

assert.ok(pages.length > 5, `expected the built site, found ${pages.length} pages`);

let versioned = 0;

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(SITE, page);

  for (const m of html.matchAll(/(?:href|src)="(\/(?:dist|scripts)\/[^"]+\.(?:css|js))(\?v=([a-f0-9]+))?"/g)) {
    const [, url, , version] = m;
    assert.ok(version, `${rel}: ${url} is not cache-busted — a deploy could leave a visitor on a stale copy`);
    assert.strictEqual(version.length, 8, `${rel}: ${url} has an odd version string "${version}"`);
    versioned++;
  }
}

// Tied to the page count rather than a hand-tuned constant: every page loads the stylesheet, so
// this cannot pass while the transform is doing nothing, and it does not have to be re-tuned
// every time a script is added or - as when the public site shed Firebase - removed.
assert.ok(versioned >= pages.length,
  `expected at least one versioned reference per page, got ${versioned} across ${pages.length} pages`);

// The versions must be real content hashes, not one shared build id: two different files
// sharing a version would mean the transform stopped reading file contents.
const seen = new Map();
for (const page of pages) {
  for (const m of fs.readFileSync(page, 'utf8').matchAll(/"(\/(?:dist|scripts)\/[^"?]+)\?v=([a-f0-9]+)"/g)) {
    const [, url, version] = m;
    if (seen.has(url)) {
      assert.strictEqual(seen.get(url), version, `${url} has two different versions across pages`);
    }
    seen.set(url, version);
  }
}
assert.ok(new Set(seen.values()).size > 1, 'every asset shares one version — the transform is not hashing content');

console.log(`cachebust: all checks passed — ${versioned} references versioned across ${pages.length} pages`);
