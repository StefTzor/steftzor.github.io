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
      // Every script in the build, not only the ones a page names in a src attribute: the app's
      // modules import each other, so most of them appear in no markup at all.
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
// Weather glyphs are pointed at by id from app.js and defined as <symbol> in the sprite. A
// mismatch renders an empty box - visible instantly to a person, invisible to every other check
// here, which is the same shape as the missing chrome.js that this file was written for.
for (const root of ROOTS) {
  const appJs = path.join(root, 'scripts', 'app.js');
  const home = path.join(root, 'index.html');
  if (!fs.existsSync(appJs) || !fs.existsSync(home)) continue;
  const wanted = [...fs.readFileSync(appJs, 'utf8').matchAll(/icon:\s*"([a-z]+)"/g)].map((m) => m[1]);
  const have = new Set([...fs.readFileSync(home, 'utf8').matchAll(/<symbol id="wx-([a-z]+)"/g)].map((m) => m[1]));
  assert.ok(wanted.length, `${path.basename(root)}: app.js names no weather icons — the regex has rotted`);
  for (const name of new Set(wanted)) {
    assert.ok(have.has(name), `app.js asks for #wx-${name}, which the sprite does not define`);
  }
  checked += wanted.length;
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

    // A relative import must land on a file that was actually copied into the build. This is the
    // missing-chrome.js hole one rung up: these modules import each other, so a module left out
    // of the passthrough list is referenced by no markup at all and every check above passes
    // while the browser 404s the import and runs none of the importing file.
    const from = node.source && node.source.value;
    if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration'
        || node.type === 'ExportAllDeclaration') && typeof from === 'string' && from.startsWith('.')) {
      // firebase-config.js is the one file that is legitimately absent here: it holds the real
      // Firebase keys and is written into the build by CI AFTER this runs, from GitHub Secrets.
      // The committed copy is placeholders and is kept out of the build on purpose.
      if (!from.endsWith('firebase-config.js')) {
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), from)),
          `${where} imports ${from}, which is not in the build — the import would 404`);
        checked++;
      }
    }
  }
}

console.log(`assets: all checks passed — ${checked} local references exist, ${scripts.size} scripts parse`);
