/**
 * Every local asset a page references must exist in the build, and every script it loads must
 * survive being evaluated.
 *
 * This gap is why it exists: the shared chrome script was referenced by every page for several
 * commits while not being in the passthrough list at all. Every check passed - the build was
 * green, the CSP test was green, cachebust reported "all checks passed" - because cachebust only
 * counts the references it *did* version and silently skips an asset it cannot find on disk.
 * A script tag pointing at a 404 was invisible to everything.
 *
 * The second check is here for the same reason one rung up. `async` followed by a docblock and
 * then `function` is valid syntax - `node --check` passes it - but the line terminator inside the
 * comment ends the async function declaration, so it parses as a bare `async` identifier and the
 * module dies with a ReferenceError before a single line of it runs. Nothing caught it: the build
 * is green because nothing here parses what it ships, only copies it.
 *
 * A statement that is nothing but a name can never do anything, so it is always a mistake.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOTS = (process.argv.slice(2).length ? process.argv.slice(2) : ['_site', '_app'])
  .map((d) => path.join(__dirname, '..', d))
  .filter(fs.existsSync);
assert.ok(ROOTS.length, 'nothing built');

let checked = 0;
const scripts = new Set();
for (const root of ROOTS) {
  const pages = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html')) pages.push(full);
      // Every script in the build, not only the ones a page names in a src attribute:
      // auth.js is reached by a dynamic import() from auth-boot.js and appears in no markup.
      else if (e.name.endsWith('.js')) scripts.add(full);
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
for (const file of scripts) {
  const where = path.relative(path.join(__dirname, '..'), file);
  let ast;
  try {
    ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (err) {
    assert.fail(`${where} does not parse: ${err.message}`);
  }
  for (const node of ast.body) {
    assert.ok(!(node.type === 'ExpressionStatement' && node.expression.type === 'Identifier'),
      `${where} has a statement that is only the name \`${node.expression && node.expression.name}\` — ` +
      'it does nothing, and at module scope it throws a ReferenceError that kills the whole file');
  }
}

console.log(`assets: all checks passed — ${checked} local references exist, ${scripts.size} scripts parse`);
