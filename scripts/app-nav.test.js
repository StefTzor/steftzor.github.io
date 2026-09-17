/**
 * The Admin sections agree with the URLs they point at.
 *   node scripts/app-nav.test.js   (runs at the end of npm run build:app)
 *
 * app/scripts/shell.js marks the current link by turning location.pathname into a key -
 * "/admin/messages/" becomes "admin-messages" - and matching it against data-nav. Nothing fails
 * when a navKey is wrong: the page simply loads with no link marked current, which is a state
 * that also occurs legitimately, so it goes unnoticed. This is the only thing that would notice.
 *
 * It also checks each section is actually served, because a section in the list with no page
 * behind it is a 404 reachable from every Admin screen.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sections = require('../app/pages/_data/adminSections.js');
const APP = path.join(__dirname, '..', '_app');

// The same rule as paint() in app/scripts/shell.js. Kept in step by the asserts below, which
// compare it against what the built pages actually carry.
const keyFor = (p) => p.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'home';

assert.ok(sections.length >= 1, 'adminSections is empty');

for (const s of sections) {
  assert.strictEqual(s.navKey, keyFor(s.href),
    `section "${s.label}" has navKey "${s.navKey}", but ${s.href} produces "${keyFor(s.href)}" - ` +
    `shell.js will never mark it as the current page`);

  assert.ok(fs.existsSync(path.join(__dirname, '..', '_includes', 'icons', `${s.icon}.svg`)),
    `section "${s.label}" names icon "${s.icon}", which does not exist`);

  if (!fs.existsSync(APP)) continue;   // headers-only run, nothing built to check against
  const page = path.join(APP, s.href, 'index.html');
  assert.ok(fs.existsSync(page), `section "${s.label}" points at ${s.href}, which is not built`);
  assert.ok(fs.readFileSync(page, 'utf8').includes(`data-nav="${s.navKey}"`),
    `${s.href} does not carry data-nav="${s.navKey}"`);
}

console.log(`app nav: all checks passed — ${sections.length} admin sections resolve`);
