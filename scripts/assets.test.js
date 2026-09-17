/**
 * Every local asset a page references must exist in the build.
 *
 * This gap is why it exists: the shared chrome script was referenced by every page for several
 * commits while not being in the passthrough list at all. Every check passed - the build was
 * green, the CSP test was green, cachebust reported "all checks passed" - because cachebust only
 * counts the references it *did* version and silently skips an asset it cannot find on disk.
 * A script tag pointing at a 404 was invisible to everything.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOTS = (process.argv.slice(2).length ? process.argv.slice(2) : ['_site', '_app'])
  .map((d) => path.join(__dirname, '..', d))
  .filter(fs.existsSync);
assert.ok(ROOTS.length, 'nothing built');

let checked = 0;
for (const root of ROOTS) {
  const pages = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) pages.push(full);
    }
  })(root);

  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    const where = path.relative(path.join(__dirname, '..'), page);
    // Local references only; a third party's availability is not this test's business.
    for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css|woff2|png|svg|ico|webmanifest))["?#]/g)) {
      const onDisk = path.join(root, url);
      assert.ok(fs.existsSync(onDisk),
        `${where} references ${url}, which is not in the build — it would 404`);
      checked++;
    }
  }
}
console.log(`assets: all checks passed — ${checked} local references all exist`);
