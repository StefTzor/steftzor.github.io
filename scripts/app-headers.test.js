/**
 * The app's nginx headers.  node scripts/app-headers.test.js
 *
 * nginx's add_header does not merge: any location block that sets one add_header discards
 * every add_header inherited from the server block. So security headers set once at the top
 * silently disappear from exactly the locations that set a Cache-Control - which is what the
 * first version of this config did, serving the whole app with no frame-ancestors and no HSTS
 * while the server block looked correct.
 *
 * Static check, so it needs no container: every location that sets a header must also pull in
 * the security snippet.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const conf = fs.readFileSync(path.join(__dirname, '..', 'nginx.app.conf'), 'utf8');
const snippet = fs.readFileSync(path.join(__dirname, '..', 'nginx.app.headers.conf'), 'utf8');

for (const header of ['Content-Security-Policy', 'X-Content-Type-Options',
                      'Referrer-Policy', 'Strict-Transport-Security']) {
  assert.ok(snippet.includes(header), `the security snippet no longer sets ${header}`);
}
assert.ok(/frame-ancestors 'none'/.test(snippet),
  'frame-ancestors is the whole reason this app is served by nginx rather than as static files');

// Each `location ... { ... }` block, one nesting level deep.
const blocks = [...conf.matchAll(/location\s+([^{]+)\{([^}]*)\}/g)];
assert.ok(blocks.length >= 2, `expected the location blocks, found ${blocks.length}`);

let checked = 0;
for (const [, match, body] of blocks) {
  if (!/add_header/.test(body)) continue;   // sets no header, so it inherits correctly
  assert.ok(/include\s+\/etc\/nginx\/snippets\/security\.conf;/.test(body),
    `location ${match.trim()} sets a header but does not include the security snippet, ` +
    `so nginx will drop every inherited security header for it`);
  checked++;
}
assert.ok(checked >= 2, `expected to check at least two locations, checked ${checked}`);

console.log(`app headers: all checks passed — ${checked} locations keep the security headers`);
