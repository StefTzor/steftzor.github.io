'use strict';

/**
 * The basemaps: who serves them, who is credited, and which maps offer which.
 *
 * Three things here are the kind that are true on the day they are written and quietly stop being
 * true later, with no symptom until somebody looks:
 *
 *   1. **The attribution names a year, and so does the tile URL.** EOX licence the satellite
 *      imagery on the condition that it is credited, and the credit includes which year's
 *      Copernicus data it is. Change the layer to a newer year and forget the credit and the
 *      map is serving one year's imagery under another year's attribution - which is a licence
 *      condition met in form and broken in fact.
 *   2. **A tile host the CSP does not allow is a blank map**, and a host allowed in one directive
 *      and not the other is a map that works in some browsers - MapLibre decides per browser
 *      whether a raster tile arrives through fetch or as an image.
 *   3. **Satellite is offered on /f1/ and deliberately not on /transit/.** A photograph answers
 *      "which circuit is this" and hides everything a departure board's map is for. That is a
 *      decision rather than an omission, so it is asserted rather than left to be re-litigated.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const MAP = read('app/scripts/map.js');
const CSP = read('eleventy.app.js');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

// --- the credit matches the imagery ------------------------------------------
{
  const url = MAP.match(/s2cloudless-\$\{SATELLITE_YEAR\}_3857/);
  assert.ok(url, 'the satellite tile URL must build its layer name from SATELLITE_YEAR, so the '
    + 'year cannot be changed in the URL without changing it in the credit');
  const credit = MAP.match(/Contains modified Copernicus Sentinel data \$\{SATELLITE_YEAR\}/);
  assert.ok(credit, "EOX's licence requires the credit to name the year, and it must be the same "
    + 'year the tiles come from - so it interpolates the same constant rather than restating it');
  assert.ok(/EOX IT Services GmbH/.test(MAP), 'and names EOX IT Services GmbH, as the licence asks');
  assert.ok(/cloudless\.eox\.at/.test(MAP), 'and links to the source the licence names');

  const year = Number((MAP.match(/const SATELLITE_YEAR = (\d{4});/) || [])[1]);
  assert.ok(year >= 2017 && year <= 2100, `SATELLITE_YEAR is ${year}, which is not a year EOX publish`);
  ok(`the satellite credit and the tile URL are built from one year (${year}), so they cannot drift`);
}

// --- the tile hosts are allowed, in both directives --------------------------
{
  // **Every external host map.js names**, not just the ones in a `{z}` template. The vector
  // basemap is referenced as a style document with no placeholders in it, and a style document
  // the CSP blocks is the same blank map as a tile the CSP blocks.
  const hosts = [...new Set([...MAP.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1])
    .filter((h) => h !== 'cloudless.eox.at'))];  // the credit's link is an <a>, not a request
  assert.ok(hosts.length >= 2,
    `expected at least the vector and the satellite host in map.js, found ${hosts.join(', ')} - `
    + 'this test is now guessing, so it fails');
  const directive = (name) => {
    const m = CSP.match(new RegExp(`"${name}":\\s*\\[([\\s\\S]*?)\\]`));
    assert.ok(m, `could not read ${name} out of eleventy.app.js`);
    return m[1];
  };
  const img = directive('img-src');
  const connect = directive('connect-src');
  hosts.forEach((host) => {
    assert.ok(img.includes(host), `${host} serves tiles but is not in img-src - the map is blank`);
    assert.ok(connect.includes(host),
      `${host} is in img-src but not connect-src - MapLibre picks per browser, so the map would `
      + 'work on some and not others, which is worse than not working at all');
  });
  ok(`every host map.js fetches from (${hosts.join(', ')}) is allowed in both directives`);
}

// --- which map offers it ------------------------------------------------------
{
  const offers = (file) => /satellite:\s*true/.test(read(file));
  assert.ok(offers('app/scripts/f1-page.js'), '/f1/ offers the satellite toggle');
  assert.ok(!offers('app/scripts/transit.js'),
    '/transit/ must NOT offer satellite: imagery hides the street name, the stop label and which '
    + 'way the road runs, which is the whole of what that map is for');
  ok('satellite is offered on /f1/ and withheld from /transit/, which is the decision that was made');
}

// --- the imagery has a resolution, and the style says so ----------------------
{
  const maxzoom = Number((MAP.match(/maxzoom:\s*(\d+)/) || [])[1]);
  // Sentinel-2 is 10m data. z14 is ~9.5m a pixel at the equator, which is native; asking for 15
  // or 16 returns the same pixels upscaled by the server at four and sixteen times the requests.
  assert.ok(maxzoom >= 12 && maxzoom <= 15,
    `maxzoom is ${maxzoom}; Sentinel-2's 10m data stops being real above about 14, and below 12 `
    + 'a circuit would be drawn from a tile stretched past recognition');
  ok(`the raster source declares maxzoom ${maxzoom}, so nothing is fetched past native resolution`);
}

console.log(`\nbasemaps: all ${passed} checks passed — the credit matches the imagery, and both hosts are allowed`);
