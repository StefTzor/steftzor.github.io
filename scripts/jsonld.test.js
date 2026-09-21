'use strict';

/**
 * Every JSON-LD block in the build must parse, and must contain no raw `<`.
 *
 * The parse check catches a trailing comma, which silently kills a rich result. The `<` check is
 * the security one: `| safe` is mandatory at these call sites, so autoescape cannot help, and a
 * string holding `</script` would close the element early and hand the rest to the HTML parser.
 * Verified on 2026-09-21 by injecting `</script><img src=x onerror=alert(1)>` into
 * `_data/schema.js` — with the `jsonInScript` filter the block still parses and nothing reaches
 * the DOM; with `dump` restored, the JSON breaks and the img element is live in the page.
 *
 * Usage: node scripts/jsonld.test.js _site --expect-blocks
 *        node scripts/jsonld.test.js _app
 *
 * `--expect-blocks` fails if none is found, which is right for the public site and wrong for the
 * app: the app is behind a login and carries no Person schema. The `<` check still runs on the
 * app, so the day a page there does emit JSON-LD it is covered from the first build.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
assert.ok(root, 'usage: node scripts/jsonld.test.js <build-dir>');

const html = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.html')) html.push(full);
  }
})(root);

assert.ok(html.length, `${root} contains no HTML — did the build run?`);

let blocks = 0;
for (const file of html) {
  const src = fs.readFileSync(file, 'utf8');
  for (const [, body] of src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    blocks++;
    const where = path.relative(root, file);

    // A raw `<` cannot be correct here: jsonInScript emits <, which is valid JSON and parses
    // back to `<`, so nothing legitimate needs the literal character.
    assert.ok(!body.includes('<'),
      `${where}: a JSON-LD block contains a raw "<" — the jsonInScript filter was bypassed, and a `
      + `"</script" in that value would end the element and inject the rest as markup`);

    try {
      JSON.parse(body);
    } catch (err) {
      assert.fail(`${where}: JSON-LD does not parse (${err.message})`);
    }
  }
}

if (process.argv.includes('--expect-blocks')) {
  assert.ok(blocks, `${root}: no JSON-LD found at all — the schema stopped being emitted`);
}
console.log(`json-ld: all checks passed — ${blocks} blocks parse and none carries a raw "<" across ${html.length} pages in ${root}`);
