'use strict';

/**
 * The /f1/ map opens framed to the chosen circuit. This checks that the framing actually reaches
 * the zoom at which the circuit is drawn.
 *
 * **This is a regression test for a bug that shipped and was only found by a reader.** The map
 * opened at a fixed zoom of 4; the outline fades in between zoom 8 and 11; so 133 KB of circuit
 * geometry was downloaded, joined, drawn, and never once seen unless somebody thought to zoom.
 * Nothing failed - every part worked exactly as written, and the two numbers were three files
 * apart.
 *
 * That is the shape this file exists to catch, so it reads all three from source rather than
 * restating any of them: the padding and zoom cap from map.js's `frame`, the opacity stops from
 * f1-page.js's outline layers, and the geometry from the vendored file. Raise the padding, move
 * a stop, or replace the outlines with a coarser set, and the arithmetic is redone here against
 * whatever the code now says. A copy of the numbers would have agreed with itself while the map
 * went back to being empty.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const MAP = read('app/scripts/map.js');
const PAGE = read('app/scripts/f1-page.js');
const CIRCUITS = JSON.parse(read('vendor/f1-circuits.json')).features;

/** One number out of the source, refusing rather than defaulting when it is not there. */
function number(source, re, what) {
  const m = source.match(re);
  assert.ok(m, `could not read ${what} out of the source - this test is now guessing, so it fails`);
  return Number(m[1]);
}

const PADDING = number(MAP, /padding:\s*(\d+)/, "frame()'s padding");
const MAX_ZOOM = number(MAP, /maxZoom:\s*(\d+)/, "frame()'s maxZoom");
// The zoom at which the outline reaches full opacity. Both line layers carry the same ramp; the
// test reads the first and asserts the second matches, because two ramps that drift apart would
// make "the outline is visible" depend on which of the two you meant.
const stops = [...PAGE.matchAll(/"line-opacity":\s*\["interpolate",\s*\["linear"\],\s*\["zoom"\],\s*(\d+),\s*0,\s*(\d+),\s*1\]/g)]
  .map((m) => [Number(m[1]), Number(m[2])]);
assert.strictEqual(stops.length, 2, 'the outline and its casing each carry one opacity ramp');
assert.deepStrictEqual(stops[0], stops[1], 'the casing fades in with the outline, not before or after it');
const [FADE_FROM, SOLID_AT] = stops[0];

/**
 * The zoom MapLibre's fitBounds solves for, given a box and a viewport.
 *
 * Web Mercator with a 512px tile, which is what MapLibre uses - a 256 here would be one whole
 * zoom level out and the test would pass while claiming the wrong thing.
 */
function framedZoom(bbox, width, height) {
  const [west, south, east, north] = bbox;
  const w = width - 2 * PADDING;
  const h = height - 2 * PADDING;
  assert.ok(w > 0 && h > 0, `padding of ${PADDING} leaves no room in a ${width}x${height} card`);
  const merc = (lat) => {
    const r = (Math.max(Math.min(lat, 85.05), -85.05) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  const dx = (east - west) / 360;
  const dy = Math.abs(merc(north) - merc(south));
  assert.ok(dx > 0 && dy > 0, 'a box with no width or no height is not a box');
  return Math.min(Math.log2(w / (512 * dx)), Math.log2(h / (512 * dy)), MAX_ZOOM);
}

// The two card sizes the map is actually laid out at. f1.njk is `h-96 sm:h-[32rem]`, so 384px
// tall below the sm breakpoint and 512 above it; the widths are the column it sits in on a small
// phone and on a desktop. The narrow one is the binding case and is the one worth having.
const CARDS = [['phone', 380, 384], ['desktop', 680, 512]];

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

assert.ok(CIRCUITS.length >= 20, `the outlines file holds ${CIRCUITS.length} circuits`);
const boxed = CIRCUITS.filter((f) => Array.isArray(f.bbox) && f.bbox.length === 4);
assert.strictEqual(boxed.length, CIRCUITS.length,
  'every circuit carries the bbox that frame() is given - one without it would silently fall back');
ok(`all ${CIRCUITS.length} circuits carry a bbox, which is what the map is framed to`);

{
  const worst = [];
  CARDS.forEach(([name, w, h]) => {
    boxed.forEach((f) => worst.push([framedZoom(f.bbox, w, h), name, f.properties.Name]));
  });
  worst.sort((a, b) => a[0] - b[0]);
  const [lowest, card, circuit] = worst[0];
  // **The whole point.** Not "some circuit is visible" - every circuit, on every card size. A
  // floor here would be the same defect as the bug: satisfied by the easy cases and silent about
  // the one that matters.
  assert.ok(lowest >= SOLID_AT,
    `every circuit must frame at zoom ${SOLID_AT} or closer, where the outline is fully drawn. `
    + `Worst is ${circuit} on ${card} at ${lowest.toFixed(2)}. `
    + `The outline fades in from ${FADE_FROM} and is solid at ${SOLID_AT}; `
    + `frame() pads by ${PADDING}px and caps at ${MAX_ZOOM}.`);
  ok(`the worst-framed circuit (${circuit}, ${card}) lands at ${lowest.toFixed(2)}, past the ${SOLID_AT} the outline is solid at`);

  const highest = worst[worst.length - 1][0];
  assert.ok(highest <= MAX_ZOOM, 'nothing frames past the cap');
  ok(`and the closest lands at ${highest.toFixed(2)}, inside the ${MAX_ZOOM} cap`);
}

{
  // The fallback, for a round whose circuit is not in the file at all. It has no box to frame,
  // so it gets a zoom - and that zoom must not put us back where this started.
  const place = number(PAGE, /const PLACE_ZOOM = (\d+);/, 'PLACE_ZOOM');
  assert.ok(place >= SOLID_AT,
    `PLACE_ZOOM is ${place}; below ${SOLID_AT} an unmatched round would open where the old bug did`);
  ok(`the no-outline fallback opens at ${place}, not back at the zoom the outline is invisible from`);
}

console.log(`\nf1 framing: all ${passed} checks passed — every circuit is drawn at the zoom the map opens at`);
