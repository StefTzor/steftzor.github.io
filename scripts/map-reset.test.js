'use strict';

/**
 * Reset puts the camera back where the page aimed it.
 *
 * The button is one line of behaviour with three ways to become a lie, and none of them shows up
 * as an error:
 *
 *   1. **A camera move that does not go through `homeTo` is a move Reset cannot undo.** Every
 *      move this app makes goes through `goTo`, `frame` or transit's `fit`, and a fourth one
 *      added later would work perfectly and silently make the button return to the wrong view.
 *      So this runs `goTo` and `frame` for real and asserts the recording, rather than reading
 *      the source for a call.
 *   2. **The move is replayed, not re-derived.** Reset repeats the request the page made, so a
 *      reader who asked not to be moved gets the same jump they got the first time. Replaying a
 *      remembered centre and zoom through a fresh flight would ignore that.
 *   3. **A button with nothing to go back to must say so.** A round the calendar has no
 *      coordinate for never moves the globe, so there is a real state in which Reset has no home
 *      - and a pressable button that does nothing is the worse half of the two options.
 *
 * `map.js` is evaluated in a vm against a hand-rolled DOM, so the control is built and pressed
 * here rather than described. Module linkage is invisible that way - `strip()` removes the
 * imports - which is why the wiring inside `createMap` is asserted from the source text, exactly
 * as basemap.test.js does for the satellite toggle and for the same reason.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/map.js'), 'utf8');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

/** Enough of a DOM for a control to be built in, and no more. */
function fakeDocument() {
  const make = (tag) => ({
    tag,
    style: {},
    children: [],
    listeners: {},
    disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    click() {
      // What a browser does, and the reason this is not just calling the handler: a disabled
      // button dispatches no click at all. Without this, "disabled" would be asserted as an
      // attribute nobody had watched do anything.
      if (this.disabled) return;
      (this.listeners.click || []).forEach((fn) => fn());
    },
  });
  return { createElement: make, querySelector: () => null, head: make('head') };
}

function load(reducedMotion = false) {
  const ctx = {
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    document: fakeDocument(),
    WeakMap,
  };
  vm.createContext(ctx);
  vm.runInContext(MAP.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
    .replace(/^export /gm, ''), ctx);
  assert.strictEqual(typeof ctx.resetControl, 'function',
    'resetControl must stay a function declaration, or this suite is testing nothing');
  assert.strictEqual(typeof ctx.homeTo, 'function', 'and homeTo with it');
  return ctx;
}

/** A map that records what it was asked to do, and a Reset button wired to it. */
function withReset(ctx) {
  const moves = [];
  const map = {
    flyTo: (o) => moves.push(['flyTo', o]),
    jumpTo: (o) => moves.push(['jumpTo', o]),
    fitBounds: (b, o) => moves.push(['fitBounds', b, o]),
  };
  const box = ctx.resetControl(map).onAdd();
  return { map, moves, button: box.children[0] };
}

// --- nothing to go back to yet -----------------------------------------------
{
  const { button, moves } = withReset(load());
  assert.strictEqual(button.disabled, true,
    'a map the page has not aimed yet has no home view, and the button says so');
  button.click();
  assert.deepStrictEqual(moves, [], 'and pressing it moves nothing');
  ok('Reset is disabled until the page has aimed the map, which is a state and not a moment');
}

// --- goTo records, and Reset repeats it --------------------------------------
{
  const ctx = load();
  const { map, moves, button } = withReset(ctx);
  ctx.goTo(map, [12.5, 41.9], 11);
  assert.strictEqual(moves.length, 1, 'goTo moves the map once');
  assert.strictEqual(button.disabled, false, 'and the button becomes pressable the moment it does');

  // Somewhere else, the way a reader panning and zooming would - except through the API, because
  // a gesture is not something this stub can produce. The point is only that the LAST thing the
  // PAGE asked for is what comes back, not the last thing that happened to the camera.
  map.flyTo({ center: [0, 0], zoom: 2 });
  button.click();
  assert.strictEqual(moves.length, 3, 'Reset moves the map again');
  assert.deepStrictEqual(moves[2], moves[0],
    'and asks for exactly what the page asked for the first time - the same centre and the same zoom');
  ok('goTo records its move as home, and Reset replays that request rather than the camera');
}

// --- frame records too, with the box it was given ----------------------------
{
  const ctx = load();
  const { map, moves, button } = withReset(ctx);
  const bbox = [9.27, 45.61, 9.30, 45.63];
  assert.strictEqual(ctx.frame(map, bbox), true, 'a real box is framed');
  assert.strictEqual(moves.length, 1, 'once');
  button.click();
  assert.strictEqual(moves.length, 2, 'and Reset frames it again');
  assert.deepStrictEqual(moves[1], moves[0],
    'to the same corners, with the same padding and the same cap');

  // A box frame() refuses must not become home either: it never moved the map, so there is
  // nothing there to go back to, and recording it would leave Reset pointing at a view that was
  // never shown.
  const fresh = withReset(ctx);
  assert.strictEqual(ctx.frame(fresh.map, [1, 2, 3]), false, 'a malformed box is refused');
  assert.strictEqual(fresh.button.disabled, true, 'and does not become the home view');
  ok('frame records the box it framed, and refuses to record one it would not frame');
}

// --- the replay is the original request, reduced motion and all --------------
{
  const ctx = load(true);
  const { map, moves, button } = withReset(ctx);
  ctx.goTo(map, [12.5, 41.9], 11);
  button.click();
  assert.deepStrictEqual(moves.map((m) => m[0]), ['jumpTo', 'jumpTo'],
    'a reader who asked not to be moved is not flown back by the button they pressed');
  ok('prefers-reduced-motion is honoured by the replay, because the replay IS the original move');
}

// --- and createMap actually adds the control ---------------------------------
{
  // The mutation the four sections above survive: everything they assert is about `homeTo`,
  // `goTo`, `frame` and `resetControl`, all of which go on working perfectly with the control
  // never added to any map. A vm cannot see this - `createMap` needs MapLibre - so it is read.
  assert.ok(/addControl\(resetControl\(map\)/.test(MAP),
    'createMap must add the reset control, or every map has a home view and no way back to it');
  // Both maps, which is the whole of the decision: unlike satellite, there is no page this is
  // withheld from, so it belongs in createMap and not behind an option either caller could
  // forget to pass.
  assert.ok(!/resetControl\(map\)\s*,\s*"top-right"\)\s*;?\s*\n\s*\}/.test(MAP)
    || !/if \([a-z]+\) \{[\s\S]{0,200}resetControl/.test(MAP),
    'the reset control is unconditional - a map with a camera has somewhere to put it back to');
  ok('createMap adds Reset to every map it builds, without an option to forget');
}

console.log(`\nmap reset: all ${passed} checks passed — Reset goes back to the view the page chose`);
