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

// Anchored to `frame()`'s own `fit` object and allowing a decimal. Unanchored `/padding:\s*(\d+)/`
// would silently measure the first `padding:` anywhere in the file - a future option on
// createMap, say - and `(\d+)` read `maxZoom: 15.5` as 15 and passed, testing against a cap the
// code did not have.
const FIT = MAP.match(/const fit = \{([^}]*)\}/);
assert.ok(FIT, "could not find frame()'s `fit` object - this test is now guessing, so it fails");
const PADDING = number(FIT[1], /padding:\s*([\d.]+)/, "frame()'s padding");
const MAX_ZOOM = number(FIT[1], /maxZoom:\s*([\d.]+)/, "frame()'s maxZoom");
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

/**
 * The two card sizes the map is actually laid out at, with the heights read off the markup.
 *
 * Height is the binding dimension for most of these circuits, so it is an input to the
 * arithmetic on exactly the same footing as the padding - and a layout pass that shrank the card
 * is precisely the change that would eat the margin while a hardcoded 384 kept agreeing with
 * itself. The widths stay stated: they are the column the card sits in, which no single class
 * declares, and they are not what binds.
 */
const TAILWIND_H = { 'h-64': 256, 'h-72': 288, 'h-80': 320, 'h-96': 384, 'h-[32rem]': 512 };

/**
 * The height `#f1Map` is given at one breakpoint, in pixels.
 *
 * `prefix` is '' for the base class and 'sm:' for the one that overrides it. Refusing an
 * unrecognised height rather than defaulting is the whole point: a card silently measured at the
 * wrong size is the same failure as a constant silently read wrong, and this file exists because
 * of one of those.
 */
function cardHeight(prefix) {
  const el = read('app/pages/f1.njk').match(/id="f1Map"[^>]*class="([^"]*)"/);
  assert.ok(el, 'could not find the #f1Map element to read its height from');
  const want = el[1].split(/\s+/).filter((c) => c.startsWith(`${prefix}h-`)
    && c.slice(prefix.length).indexOf(':') === -1)
    .map((c) => c.slice(prefix.length));
  assert.strictEqual(want.length, 1,
    `#f1Map should declare exactly one "${prefix}h-" height, found ${JSON.stringify(want)}`);
  const px = TAILWIND_H[want[0]];
  assert.ok(px, `#f1Map's "${prefix}${want[0]}" is a height this test does not know. Add it to `
    + `TAILWIND_H rather than letting the framing be measured against a card that is not the `
    + `real one - the height is what binds most of these circuits.`);
  return px;
}

const CARDS = [['phone', 380, cardHeight('')], ['desktop', 680, cardHeight('sm:')]];

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

// --- the join, executed rather than reasoned about --------------------------
{
  /**
   * **Everything above this point is arithmetic, and arithmetic cannot see a disconnected wire.**
   *
   * The review of the commit that added this file proved it: delete `round: Number(r.round)` from
   * circuitOutlines and `tracks.features.find((f) => f.properties.round === chosen)` returns
   * undefined for every round forever, aim() falls through to PLACE_ZOOM, the per-circuit framing
   * is dead - and every check above still passed. That is the same silent, plausible-looking
   * fallback as the bug this file was written for, in the file written to catch it.
   *
   * So the real function runs. `circuitOutlines` is a function declaration, which is what `vm`
   * puts on the context (a `const` arrow would not be there at all), and its only dependency is
   * `fetch`, stubbed here to hand it the vendored file off disk.
   */
  const vm = require('vm');
  const body = PAGE.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
    .replace(/profile\.then\([\s\S]*$/, '');
  const ctx = {
    fetch: async () => ({ ok: true, json: async () => ({ features: CIRCUITS }) }),
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} } }) },
    console: { error: () => {} },
    el: () => null, say: () => {}, api: async () => ({}), profile: { then: () => {} },
    teamColour: () => '#000', createMap: async () => null, goTo: () => {}, frame: () => true,
    window: { matchMedia: () => ({ matches: false }) },
    getComputedStyle: () => ({ getPropertyValue: () => '0 0 0' }),
  };
  vm.createContext(ctx);
  vm.runInContext(body, ctx);
  assert.strictEqual(typeof ctx.circuitOutlines, 'function',
    'circuitOutlines must stay a function declaration for this test to reach it');

  // Two real circuits, given to the joiner the way the calendar gives them: a coordinate on the
  // track and a round number. Monza and Silverstone, read out of the file itself so the fixture
  // cannot drift from the data.
  const pick = (name) => CIRCUITS.find((f) => f.properties.Name.includes(name));
  const rounds = [['Monza', 7], ['Silverstone', 12]].map(([name, round]) => {
    const f = pick(name);
    assert.ok(f, `${name} is missing from the outlines file`);
    return { round, lon: (f.bbox[0] + f.bbox[2]) / 2, lat: (f.bbox[1] + f.bbox[3]) / 2, over: false };
  });

  return ctx.circuitOutlines(rounds).then((joined) => {
    assert.strictEqual(joined.features.length, 2, 'both rounds matched an outline by coordinate');
    ok('circuitOutlines joins a round to its circuit, running for real against the vendored file');

    // The lookup aim() does, with the values aim() has. This is the assertion that dies when the
    // wire is cut, and it executes the `===` rather than describing it.
    rounds.forEach(({ round }) => {
      const chosen = Number(round);
      const shape = joined.features.find((f) => f.properties.round === chosen);
      assert.ok(shape, `aim() can find round ${chosen}'s outline - if this fails, every round `
        + `silently falls back to PLACE_ZOOM and the framing is gone with no other symptom`);
      assert.ok(Array.isArray(shape.bbox) && shape.bbox.length === 4,
        'and the shape it finds carries the four-element box frame() is given');
      assert.strictEqual(typeof shape.properties.round, 'number',
        'round is a number on both sides of the ===, so it cannot fail on a string');
    });
    ok('the round-to-outline lookup aim() performs resolves, and carries the box frame() needs');

    // **frame() is the other half of the wire**, so it runs too: map.js is an ES module, which
    // `require` cannot load, and the vm trick that reaches circuitOutlines reaches this the same
    // way once `export` is stripped off the declaration.
    const mapCtx = { window: { matchMedia: () => ({ matches: false }) }, document: { querySelector: () => null } };
    vm.createContext(mapCtx);
    vm.runInContext(MAP.split('\n').filter((l) => !l.startsWith('import '))
      .join('\n').replace(/^export /gm, ''), mapCtx);
    assert.strictEqual(typeof mapCtx.frame, 'function', 'frame must stay a function declaration');

    const asked = [];
    const stub = { fitBounds: (bounds, opts) => asked.push({ bounds, opts }) };

    const box = joined.features[0].bbox;
    assert.strictEqual(mapCtx.frame(stub, box), true, 'a real circuit box is framed');
    assert.strictEqual(asked.length, 1, 'and fitBounds is actually called with it');
    // Flattened and spread into a host array before comparing: the arrays frame() built live in
    // the vm's realm, so their prototype is that realm's Array.prototype and deepStrictEqual
    // rejects them for that alone, with a diff showing two identical-looking values.
    assert.deepStrictEqual([...asked[0].bounds.flat()], [box[0], box[1], box[2], box[3]],
      'as south-west and north-east corners, in that order');
    assert.strictEqual(asked[0].opts.padding, PADDING, 'with the padding this file measured');
    assert.strictEqual(asked[0].opts.maxZoom, MAX_ZOOM, 'and the cap');

    // The shapes that are not boxes. The six-element one is the dangerous case: GeoJSON allows
    // `[w, s, minElevation, e, n, maxElevation]`, and destructuring that positionally reads east
    // as an elevation - a finite number, so nothing throws and the map frames a rectangle
    // reaching from the circuit to a longitude somewhere near sea level in metres.
    [[box[0], box[1], 0, box[2], box[3], 400], [], [1, 2, 3], [1, 2, 3, NaN],
     [1, 2, 3, '4'], null, undefined, 'bbox'].forEach((bad) => {
      const before = asked.length;
      assert.strictEqual(mapCtx.frame(stub, bad), false,
        `${JSON.stringify(bad)} is refused rather than framed`);
      assert.strictEqual(asked.length, before, 'and nothing was asked of the map');
    });
    ok('frame() calls fitBounds with the real box, and refuses every shape that is not one');

    console.log(`\nf1 framing: all ${passed} checks passed — every circuit is drawn at the zoom the map opens at`);
  });
}
