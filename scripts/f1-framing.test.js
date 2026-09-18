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

// --- the join and the call site, executed rather than reasoned about --------
//
// **Everything above this point is arithmetic, and arithmetic cannot see a disconnected wire.**
//
// The review of the commit that added this file proved it: delete `round: Number(r.round)` from
// circuitOutlines and the lookup in aim() returns undefined for every round forever, aim() falls
// through to PLACE_ZOOM, the per-circuit framing is dead - and every check above still passed.
// Then the review of the commit that fixed THAT proved the same thing one level up: the two
// halves were each executed, and nothing executed the line that joins them, so deleting the
// `frame()` call from aim() altogether also passed.
//
// So this block drives the real path. `startGlobe` and `showOnMap` are function declarations,
// which is what `vm` puts on a context - the module's `let globe/tracks/chosen/target` are
// lexical and are not reachable from outside, which is precisely why going in through the front
// door is the only honest way to test this and also the right one.
//
// Wrapped in an async IIFE rather than left as a top-level `return`. In CommonJS that `return`
// exits the module wrapper, so a check appended below it - the natural place for the next one -
// would never run. Verified: an `assert.ok(false)` after it did not fail the suite.
//
// **The limit of this technique, stated because everything below looks like it has none.**
// `strip()` removes the `import` lines, so module linkage is structurally invisible here. Delete
// `import { createMap, goTo, frame } from "./map.js"` from f1-page.js and this suite passes AND
// `npm run build:app` passes - the asset check parses each script, and a missing import is valid
// syntax. In a browser it is a ReferenceError on the first round change and the map dies
// entirely. Nothing in this repository catches that, and nothing in this approach can: the whole
// reason the functions are reachable is that their imports were taken away. A reader who sees
// startGlobe running for real will assume otherwise, so it is written down here.
(async () => {
  const vm = require('vm');
  const strip = (src) => src.split('\n').filter((l) => !l.startsWith('import ')).join('\n');

  /**
   * The map's surface, as much of it as startGlobe, draw() and mark() actually touch.
   *
   * **It records rather than swallows.** The first version answered every call with nothing, which
   * made it a sink: `draw()` could stop being called from startGlobe, or `addRounds` could stop
   * adding the outline layers entirely, and the suite would go on asserting that every circuit
   * frames past the zoom those layers are solid at - layers that were no longer there.
   */
  const layers = [];
  const paints = [];
  const fakeMap = () => ({
    getCanvas: () => ({ setAttribute() {}, tabIndex: 0 }),
    on() {}, getSource: () => null, addSource() {},
    addLayer: (l) => { layers.push(l.id); paints.push(l.paint || {}); },
    getLayer: () => ({}), setFilter() {},
  });

  const moves = [];
  const ctx = {
    fetch: async () => ({ ok: true, json: async () => ({ features: CIRCUITS }) }),
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} } }) },
    console: { error: () => {} },
    el: () => ({ textContent: '', hidden: false }),
    say: () => {}, api: async () => ({}), profile: { then: () => {} },
    teamColour: () => '#000',
    createMap: async () => fakeMap(),
    // The two ways the camera can be told to move. Recorded rather than performed, because which
    // of them is called IS the behaviour under test.
    goTo: (m, centre, zoom) => moves.push(['goTo', zoom]),
    frame: (m, bbox) => { moves.push(['frame', bbox]); return true; },
    window: { matchMedia: () => ({ matches: false }) },
    // **A different value per token, which the divergence check below depends on.** Returning
    // one constant made every `ink()` call equal, so two layers painted from DIFFERENT tokens
    // compared identical and the check passed on a map that was visibly wrong. A stub that
    // flattens the thing under test is the same fault as an assertion that never fails.
    getComputedStyle: () => ({
      getPropertyValue: (prop) => {
        let h = 0;
        for (const c of String(prop)) h = (h * 31 + c.charCodeAt(0)) % 251;
        return `${h} ${(h * 7) % 251} ${(h * 13) % 251}`;
      },
    }),
  };
  vm.createContext(ctx);
  vm.runInContext(strip(PAGE).replace(/profile\.then\([\s\S]*$/, ''), ctx);
  assert.strictEqual(typeof ctx.circuitOutlines, 'function',
    'circuitOutlines must stay a function declaration for this test to reach it');
  assert.strictEqual(typeof ctx.startGlobe, 'function', 'and startGlobe likewise');

  // Two real circuits, given to the joiner the way the calendar gives them: a coordinate on the
  // track and a round number. Read out of the file itself so the fixture cannot drift from the
  // data it is a fixture for.
  const pick = (name) => {
    const f = CIRCUITS.find((c) => c.properties.Name.includes(name));
    assert.ok(f, `${name} is missing from the outlines file`);
    return f;
  };
  const roundFor = (name, round) => {
    const f = pick(name);
    return { round, lon: (f.bbox[0] + f.bbox[2]) / 2, lat: (f.bbox[1] + f.bbox[3]) / 2, over: false };
  };
  const rounds = [roundFor('Monza', 7), roundFor('Silverstone', 12)];

  const joined = await ctx.circuitOutlines(rounds);
  assert.strictEqual(joined.features.length, 2, 'both rounds matched an outline by coordinate');
  ok('circuitOutlines joins a round to its circuit, running for real against the vendored file');

  assert.ok(joined.features.every((f) => typeof f.properties.round === 'number'),
    'round is a number on the outline side of the ===, so it cannot fail against a Number()d one');
  assert.ok(joined.features.every((f) => Array.isArray(f.bbox) && f.bbox.length === 4),
    'and every joined shape carries the four-element box frame() is given');

  // The lookup itself is not asserted here any more. It used to be, and it was a restatement of
  // aim()'s line rather than an execution of it - the drive-through below now runs the real
  // `===` inside the real aim(), against a round that is deliberately not the first in the list.

  // **The call site.** showOnMap -> aim -> frame, driven end to end. This is the assertion that
  // dies when somebody removes the frame() call, which every other check in this file survives.
  //
  // **Silverstone and not Monza, deliberately.** Monza is round 7, the first fixture round, and so
  // also `features[0]` - which means replacing the whole lookup with `tracks.features[0]` would
  // have satisfied this. The second round is the one that proves a lookup happened.
  await ctx.startGlobe(rounds);
  // The four layer ids, read from source so a rename cannot make this silently check nothing.
  const layerId = (name) => {
    const m = PAGE.match(new RegExp(`const ${name} = "([^"]+)"`));
    assert.ok(m, `could not read the ${name} layer id out of f1-page.js`);
    return m[1];
  };
  const want = ['ALL', 'HERE', 'TRACK_BED', 'TRACK'].map(layerId);
  assert.deepStrictEqual(layers.slice().sort(), want.slice().sort(),
    'startGlobe draws the dots AND the outline layers - check 2 above asserts every circuit '
    + 'frames past the zoom those layers are solid at, which means nothing if they are not added');
  ok('starting the globe adds the dot layers and the circuit outline with its casing');

  // **Every layer that branches on `over` must resolve to the SAME pair of colours.**
  //
  // That rule lived only as prose in a Nunjucks comment - f1.njk says the outline "takes its
  // colour from the same raced/still-to-come flag as the dot beneath it, so this row describes a
  // shape and not a fourth colour" - which is exactly how it managed to stop being true without
  // anything noticing. The dots were retokenised to `map-past`; the outline was not; a raced
  // round drew a grey dot on a different grey outline and the key went on promising three states.
  //
  // It names no colour, deliberately. Transcribing the paint expression into a second file would
  // catch this once and then fail on every future palette change for no reason. This fails only
  // on DIVERGENCE, which is the actual bug class: two layers that must agree, drifting. Same
  // shape as basemap.test.js asserting the credit and the tile URL are built from one year.
  // Colour properties only. `circle-opacity` also branches on `over` - the raced dots are drawn
  // at 0.7 - and it is a second encoding of the same flag rather than a second colour scheme, so
  // including it would make the set two and the check meaningless.
  const overPairs = new Set(
    paints.flatMap((p) => Object.entries(p))
      .filter(([prop, v]) => prop.endsWith('-color')
        && Array.isArray(v) && v[0] === 'case'
        && JSON.stringify(v[1]) === JSON.stringify(['get', 'over']))
      .map(([, v]) => JSON.stringify([v[2], v[3]])),
  );
  assert.ok(overPairs.size > 0, 'at least one layer branches on the raced flag');
  assert.strictEqual(overPairs.size, 1,
    `raced and still-to-come are drawn in ${overPairs.size} different colour pairs, and the key `
    + `below the map promises one: ${[...overPairs].join(' vs ')}`);
  ok('every layer that branches on the raced flag resolves to one pair of colours');

  moves.length = 0;                      // startGlobe aims once itself; this is about the next one
  ctx.showOnMap({ ...roundFor('Silverstone', 12), circuit: 'Silverstone Circuit' });
  assert.deepStrictEqual(moves.map((m) => m[0]), ['frame'],
    'showOnMap -> aim -> frame: choosing a round frames the map to a box, and does NOT fall '
    + 'through to goTo - a fallback here is the whole feature dying with no symptom');
  assert.strictEqual(moves[0][1][0], pick('Silverstone').bbox[0],
    "and frames it to that round's own circuit, not to the first one in the list");
  ok('choosing a round drives showOnMap through aim into frame, with the right circuit');

  // **The other limb of `if (shape && frame(...))`, which nothing had ever executed.** The stub
  // answered true unconditionally, so `aim()` only ever took the framing branch - and deleting
  // the `goTo` fallback underneath it passed. At runtime that costs a round with no outline any
  // camera movement at all: the map stays on the previous circuit while the header beside it
  // names the new one, which is worse than the bug this whole file exists for. Returning `false`
  // rather than throwing was justified entirely by the caller reading it, so the caller reading
  // it is the thing to assert.
  const PZ = number(PAGE, /const PLACE_ZOOM = (\d+);/, 'PLACE_ZOOM');
  moves.length = 0;
  ctx.showOnMap({ round: 99, lon: -30, lat: 0, circuit: 'somewhere with no outline' });
  assert.deepStrictEqual(moves, [['goTo', PZ]],
    `a round with no outline still moves the camera, to PLACE_ZOOM (${PZ}) - not nowhere`);

  // A box frame() refuses. The stub must still RECORD while answering false, or this passes for
  // the wrong reason: `() => false` alone yields ['goTo'] and looks like success.
  moves.length = 0;
  ctx.frame = (m, bbox) => { moves.push(['frame', bbox]); return false; };
  ctx.showOnMap({ ...roundFor('Monza', 7), circuit: 'Autodromo Nazionale Monza' });
  assert.deepStrictEqual(moves.map((m) => m[0]), ['frame', 'goTo'],
    'and a box frame() refuses falls through to the same fallback rather than not moving at all');
  ctx.frame = (m, bbox) => { moves.push(['frame', bbox]); return true; };
  ok('both limbs of the guard move the camera: a framed box, and a fallback when there is none');

  // --- frame() itself, both branches -----------------------------------------
  const inMap = (reducedMotion) => {
    const c = { window: { matchMedia: () => ({ matches: reducedMotion }) },
      document: { querySelector: () => null } };
    vm.createContext(c);
    vm.runInContext(strip(MAP).replace(/^export /gm, ''), c);
    assert.strictEqual(typeof c.frame, 'function', 'frame must stay a function declaration');
    return c;
  };

  const box = pick('Monza').bbox;
  {
    const asked = [];
    const flying = inMap(false);
    assert.strictEqual(flying.frame({ fitBounds: (b, o) => asked.push({ b, o }) }, box), true,
      'a real circuit box is framed');
    assert.strictEqual(asked.length, 1, 'and fitBounds is actually called with it');
    // Destructured rather than flattened. It solves the cross-realm problem the same way - the
    // arrays frame() built live in the vm's realm, so deepStrictEqual rejects them on prototype
    // alone - but it THROWS on anything that is not two pairs, where .flat() silently accepts a
    // flat [w,s,e,n] and the message goes on claiming it checked the corners.
    const [[swLng, swLat], [neLng, neLat]] = asked[0].b;
    assert.deepStrictEqual([swLng, swLat, neLng, neLat], [box[0], box[1], box[2], box[3]],
      'as south-west and north-east corners, in that order');
    assert.strictEqual(asked[0].o.padding, PADDING, 'with the padding this file measured');
    assert.strictEqual(asked[0].o.maxZoom, MAX_ZOOM, 'and the cap');

    // The shapes that are not boxes. The six-element one is the dangerous case: GeoJSON allows
    // `[w, s, minElevation, e, n, maxElevation]`, and destructuring that positionally reads east
    // as an elevation - finite, so nothing throws and the map frames a rectangle reaching from
    // the circuit to a longitude somewhere near sea level in metres.
    [[box[0], box[1], 0, box[2], box[3], 400], [], [1, 2, 3], [1, 2, 3, NaN],
     [1, 2, 3, '4'], [1, 2, 3, Infinity], null, undefined, 'bbox'].forEach((bad) => {
      const before = asked.length;
      assert.strictEqual(flying.frame({ fitBounds: () => asked.push({}) }, bad), false,
        `${JSON.stringify(bad)} is refused rather than framed`);
      assert.strictEqual(asked.length, before, 'and nothing was asked of the map');
    });
    ok('frame() calls fitBounds with the real box, and refuses every shape that is not one');
  }
  {
    // **The branch a test with motion on never runs.** Losing the `true` from it costs exactly
    // the readers who cannot see the flight: aim() reads false, falls through, and moves the
    // camera a second time on top of the framing it had just done.
    const jumped = [];
    const still = inMap(true);
    assert.strictEqual(still.frame({ fitBounds: (b, o) => jumped.push(o) }, box), true,
      'a reduced-motion reader is framed too, so aim() does not then move the map a second time');
    assert.strictEqual(jumped.length, 1, 'and is framed exactly once');
    assert.strictEqual(jumped[0].duration, 0, 'without the flight');
    assert.strictEqual(jumped[0].padding, PADDING, 'and with the same padding as everyone else');
    ok('prefers-reduced-motion gets the framing without the journey, and reports that it did');
  }

  console.log(`\nf1 framing: all ${passed} checks passed — every circuit is drawn at the zoom the map opens at`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
