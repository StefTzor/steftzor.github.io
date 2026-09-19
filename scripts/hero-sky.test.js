'use strict';

/**
 * The home hero's sky, its city, and the contrast it spends.
 *
 * Nothing covered this card before today - not `data-wx`, not `.hero-sky`, not one of the seven
 * conditions. That was survivable while every wash sat under 26% and the card could not be made
 * worse by being ignored. It is not survivable now: the effect was roughly doubled, a skyline was
 * put behind the text, and the thing holding the greeting legible is a single gradient nobody
 * would think to look at.
 *
 * Four things are checked, and each one is a way this breaks silently rather than loudly:
 *
 *   1. **A condition with no sky draws a blank card.** `describe()` is the only thing that picks
 *      the value, and it is total - every WMO code lands on one of nine strings. Add a tenth and
 *      the card simply stops reacting, with nothing in the console to say so.
 *   2. **The skyline arrives from the API as numbers, and numbers are the only thing this page
 *      will accept.** Everything on this card is createElement and textContent; the weather
 *      sprite exists so a weather code can only ever choose a shape somebody already drew. The
 *      skyline is the one drawing that comes from outside, so the boundary is the check: the
 *      client builds the `d` itself out of integers it has bounds-checked, and a `d` handed
 *      over by the API would be the first upstream string in this file to become markup.
 *   3. **Contrast is the price of the whole change.** The card is allowed to be loud because the
 *      scrim buys the text column back. Weaken the scrim or raise a wash and the greeting goes
 *      with it, and no build step would notice.
 *   4. **Reduced motion has to keep up.** Every animation added later must join the block that
 *      silences them, or somebody who asked not to be moved gets moved.
 *
 * All of it is read out of the source rather than restated here. Copies drift.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const CSS = read('src/input.css');
const APP = read('app/scripts/app.js');
const PAGE = read('app/pages/index.njk');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

/**
 * One declaration block by selector, refusing rather than defaulting when it is not there.
 *
 * `contains` disambiguates: several of these selectors appear twice, once in the grouped rule
 * that gives all four layers their position and once in their own rule. Taking the first match
 * would have measured the wrong block and passed - `.hero-scrim` in the grouped rule has no
 * gradient in it at all.
 */
function block(selector, contains) {
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(selector + ' {', from);
    assert.notStrictEqual(at, -1,
      `could not find \`${selector}\`${contains ? ` containing "${contains}"` : ''} in src/input.css `
      + '- this test is now guessing, so it fails');
    const open = CSS.indexOf('{', at);
    const end = CSS.indexOf('\n  }', open);
    assert.notStrictEqual(end, -1, `could not find the end of \`${selector}\``);
    const body = CSS.slice(open, end);
    if (!contains || body.includes(contains)) return body;
    from = end;
  }
}

// --- 1. every condition describe() can produce has a sky ----------------------
{
  // The icon names, read out of describe()'s own returns rather than listed here.
  const fn = APP.slice(APP.indexOf('function describe('), APP.indexOf('\n}', APP.indexOf('function describe(')));
  const icons = [...new Set([...fn.matchAll(/icon:\s*(?:isDay\s*\?\s*"(\w+)"\s*:\s*"(\w+)"|"(\w+)")/g)]
    .flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean))];
  assert.ok(icons.length >= 8,
    `only found ${icons.length} icon names in describe(); this test is now guessing, so it fails`);

  const styled = new Set([...CSS.matchAll(/\.hero\[data-wx="(\w+)"\]/g)].map((m) => m[1]));
  const missing = icons.filter((i) => !styled.has(i));
  assert.deepStrictEqual(missing, [],
    `describe() can return ${missing.join(', ')}, and src/input.css draws no sky for it - the card `
    + 'would go blank for that weather with nothing to say why');

  // And nothing styled that cannot happen: a rule for a condition describe() never returns is a
  // rule nobody will ever see, which is the same defect pointing the other way.
  const unreachable = [...styled].filter((s) => !icons.includes(s));
  assert.deepStrictEqual(unreachable, [],
    `src/input.css styles ${unreachable.join(', ')}, which describe() never returns`);
  ok(`all ${icons.length} conditions describe() can return have a sky, and nothing else does`);
}

// --- 2. the skyline crosses the boundary as numbers, and lands in its own band ---
{
  // The client builds the path. If it ever takes one, this is the line that notices.
  assert.ok(/setAttribute\("d", /.test(APP),
    'app.js must build the skyline path itself');
  assert.ok(!/\bdata\.(d|path)\b/.test(APP) && !/setAttribute\("d", *(data|res|json)/.test(APP),
    'app.js must never set `d` from something the API sent - the whole point of shipping integers '
    + 'is that no upstream string becomes markup on this page');

  // Every guard the boundary depends on, named individually: dropping any one of them lets a
  // different malformed answer through, and none of them fails loudly at runtime.
  const guard = APP.slice(APP.indexOf('function skylinePath('), APP.indexOf('async function drawCity'));
  assert.ok(guard.length > 200, 'could not find skylinePath - this test is now guessing, so it fails');
  [
    // Named on the STEP's own values, not just `Number.isInteger`: the box dimensions are
    // checked on an earlier line with the same call, so matching the bare name kept passing
    // after the step check was deleted.
    ['Number.isInteger(x)', 'a non-integer x would put a float, or NaN, straight into the path'],
    ['Number.isInteger(up)', 'a non-integer height would do the same, one axis over'],
    ['Array.isArray', 'a string in place of the steps array would be iterated character by character'],
    ['x < 0', 'a negative x would draw left of the box'],
    ['> w', 'an x past the width would paint outside the band'],
    ['> h', 'a height past the box would paint up through the text'],
    ['x <= previous', 'steps that go backwards fold the silhouette over itself'],
  ].forEach(([needle, why]) => assert.ok(guard.includes(needle),
    `skylinePath no longer checks \`${needle}\`: ${why}`));

  assert.ok(/return null/.test(guard) && /if \(!d\) return;/.test(APP),
    'a rejected skyline must draw nothing at all, not a partial path');

  assert.ok(/<path id="cityArt"/.test(PAGE) && !/<use id="cityArt"/.test(PAGE),
    'the page ships an empty <path>, so nothing is drawn before there is a real city');
  assert.ok(/preserveAspectRatio="xMidYMax slice"/.test(PAGE),
    'the skyline must be xMidYMax slice: bottom-anchored, and cropping the sides rather than the '
    + 'top, which is where the landmark is');

  // **The band and the scrim may not overlap.** This is the composition, and it is the thing
  // that was broken: with the scrim over the whole card, 12 of 1153 columns showed the city at
  // a strength anybody could see. The mask is what keeps them apart, and it has to be measured
  // in the band's own units - a percentage is measured against a card whose height changes with
  // the text in it, which is the same mistake the wide scrim's stops were written to avoid.
  const scrim = block('.hero-scrim', 'mask-image');
  const mask = scrim.slice(scrim.indexOf('--wx-mask:'), scrim.indexOf(';', scrim.indexOf('--wx-mask:')));
  assert.ok(mask.length > 20, 'could not read --wx-mask - this test is now guessing, so it fails');
  // BOTH stops, and no percentage anywhere in it. Checking only that the band is mentioned kept
  // passing when the transparent stop was changed back to `96%` - which is the original mistake,
  // a stop measured against a card whose height changes with the text in it.
  assert.strictEqual((mask.match(/var\(--wx-band\)/g) || []).length, 2,
    `both of the mask's stops must be measured from the band; found ${(mask.match(/var\(--wx-band\)/g) || []).length}`);
  // A BARE percentage stop - `transparent 96%`. The `100%` inside each calc() is fine and is the
  // point of them: it means the bottom of the card, which is what the band is measured back from.
  const bare = mask.match(/(?:#[0-9a-f]{3,8}|transparent)\s+\d+%/i);
  assert.ok(!bare,
    `the mask has a bare percentage stop in it ("${bare && bare[0]}"); percentages are measured `
    + 'against the card, whose height changes with the text in it, and were wrong at every width '
    + 'but the one they were tuned at');
  assert.ok(/[^-]mask-image:\s*var\(--wx-mask\)/.test(scrim) && /-webkit-mask-image:/.test(scrim),
    'the mask needs both the plain and the -webkit- property, or it does nothing in Safari and '
    + 'the scrim covers the city there and nowhere else');

  // And the band has to be reserved rather than borrowed from whatever is left over, because at
  // 390px there is nothing left over: the card is 356px tall and the text block is 354px of it.
  // Twice: once unconditionally and once at `sm`, where the padding itself changes. Reading one
  // block found the `sm` copy and stayed green when the unconditional one was deleted - which is
  // the phone, and the phone is the width with no spare room at all.
  const reserved = [...CSS.matchAll(/padding-bottom:\s*calc\([^)]*var\(--wx-band\)\)/g)];
  assert.ok(reserved.length >= 2,
    `.hero-body reserves the band in ${reserved.length} place(s); it needs one for the base case `
    + 'and one for `sm`, or the text sits on top of the skyline at whichever width is missing');

  // The band grows with the card. A 10:1 drawing in a band flatter than 10:1 is cropped at the
  // TOP by `slice`, and the top is the landmark: a fixed 4rem band took 43% off Uppsala
  // cathedral at 1280px. Three sizes, each within a few percent of the art's own aspect.
  const bands = [...CSS.matchAll(/--wx-band:\s*([\d.]+)rem/g)].map((m) => Number(m[1]));
  assert.ok(bands.length >= 3,
    `the band is declared at ${bands.length} sizes; it has to grow with the card or the widest `
    + 'one crops the spire off the top');
  assert.deepStrictEqual([...bands].sort((a, b) => a - b), bands,
    `the band sizes must increase with the breakpoints, got ${bands.join(', ')}`);
  ok('the skyline crosses as checked integers, and the band it lands in is reserved and unscrimmed');
}

// --- 3. what the effect costs the text ----------------------------------------
{
  /** `rgb(r g b / a%)` or bare `r g b` channels, both of which this stylesheet uses. */
  const colour = (value) => {
    const m = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)%\s*)?\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] / 100 };
    const bare = value.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    assert.ok(bare, `could not read a colour out of "${value}"`);
    return { r: +bare[1], g: +bare[2], b: +bare[3], a: 1 };
  };

  const token = (source, name) => {
    const m = source.match(new RegExp(`${name}:\\s*([^;]+);`));
    assert.ok(m, `could not read ${name} - this test is now guessing, so it fails`);
    return colour(m[1]);
  };

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const root = block(':root', '--color-surface');
  const darkRoot = block('.chrome-dark', '--color-surface');
  const hero = block('.hero', '--wx-sun');
  const darkHero = block('.chrome-dark .hero', '--wx-sun');

  const POSITIONAL = ['--wx-disc', '--wx-moon'];

  /**
   * Which inks each condition paints.
   *
   * **Every ink counts in full, including the streaks and the flakes.** An earlier version
   * weighted them by the fraction of the card they cover - 1.5px of streak every 14px reads as
   * 11% - and that is the wrong model for legibility: WCAG measures a glyph against the pixels
   * immediately behind it, and a streak at 74 degrees crosses essentially every glyph on a line.
   * Locally it is entirely there. The weighting also bought about 0.02 of ratio for thirty lines
   * of regex, and it silently mis-attributed a token used twice in one rule. Gone.
   *
   * Every condition named in the selector LIST, not just the first: `clear` and `partly` share a
   * rule, as do `cloud` and `fog`, and matching one name per rule dropped two of the nine.
   */
  const conditions = new Map();
  [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)].forEach(([, selector, body]) => {
    const named = [...selector.matchAll(/\.hero\[data-wx="(\w+)"\]/g)].map((m) => m[1]);
    if (!named.length) return;
    // **Which layer it is painted on, because the city goes between them.** `.hero-fall` sits in
    // FRONT of the skyline - that is the whole reason precipitation was split out of `.hero-sky`
    // - so rain and snow composite over the buildings, not under them. Modelling every ink as one
    // group put the fall layer underneath and flattered exactly the three conditions that have
    // one: dark/snow read 4.66:1 that way and 4.45:1 in the real order.
    const layer = /\.hero-fall/.test(selector) ? 'fall' : 'sky';
    const used = [...new Set([...body.matchAll(/var\((--wx-[a-z0-9-]+)\)/g)].map((m) => m[1]))]
      .filter((t) => !POSITIONAL.includes(t))
      .map((token) => ({ token, layer }));
    if (!used.length) return;
    named.forEach((cond) => {
      const already = conditions.get(cond) || [];
      const fresh = used.filter((u) => !already.some((a) => a.token === u.token));
      conditions.set(cond, [...already, ...fresh]);
    });
  });
  assert.ok(conditions.size >= 8,
    `only found ${conditions.size} conditions with ink in them; this test is now guessing, so it fails`);

  /**
   * **No ink may go unmeasured.** `--wx-flash` reaches the thunder stack only because its rule's
   * selector happens to name thunder. Move it to a bare `.hero-fall::after` - a natural refactor,
   * since only thunder has one - and it drops out of every stack silently, the condition count
   * stays at nine, and the reported worst case IMPROVES because the biggest contributor to it has
   * gone. So the palette is the checklist: anything declared has to be painted somewhere.
   */
  // --wx-city, --wx-city-alpha and --wx-band are not ink in this stack: the first two paint the
  // skyline, which is in the band and under no text, and the third is the band's height.
  const NOT_INK = ['--wx-city', '--wx-city-alpha', '--wx-band', '--wx-mask'];
  const declared = [...new Set([...block('.hero', '--wx-sun').matchAll(/(--wx-[a-z0-9-]+):/g)].map((m) => m[1]))]
    .filter((t) => !POSITIONAL.includes(t) && !NOT_INK.includes(t));
  // **The palette count, because a regex that cannot see a digit shrinks this list in silence.**
  // `[a-z-]+` stops at `veil` and then fails on the `2`, so `--wx-veil2` appeared in neither list
  // and the guard below compared two sets that were both missing it - passing vacuously, which is
  // the exact failure it exists to prevent. A count is what notices.
  assert.ok(declared.length >= 10,
    `only ${declared.length} inks read out of the palette (${declared.join(', ')}); the pattern `
    + 'that reads them has stopped matching something, and every check below is now weaker');

  // And the two layers have to stay two. Collapsing them composites the rain UNDER the buildings,
  // which is the opposite of what the card does and flatters every condition that has a fall
  // layer - dark/snow reads 4.66:1 that way and 4.45:1 in the real order.
  ['rain', 'snow', 'thunder'].forEach((cond) => assert.ok(
    (conditions.get(cond) || []).some((t) => t.layer === 'fall'),
    `${cond} paints nothing on .hero-fall, so the precipitation is being modelled behind the city `
    + 'rather than in front of it'));
  assert.ok([...conditions.values()].flat().some((t) => t.layer === 'sky'),
    'nothing is painted on .hero-sky, so the layers are not being told apart at all');

  const painted = new Set([...conditions.values()].flat().map((u) => u.token));
  const unmeasured = declared.filter((t) => !painted.has(t));
  assert.deepStrictEqual(unmeasured, [],
    `${unmeasured.join(', ')} is declared in the palette and appears in no condition's stack, so `
    + 'nothing measures it. Either it is dead, or it is painted from a rule this cannot see');

  // The snow layer names its channel through rgb(var(--wx-snow) / N%) rather than as a finished
  // colour, so its strongest stop is read out of the rule it is used in.
  const snowRule = block('.hero[data-wx="snow"] .hero-fall', 'radial-gradient');
  const snowAlpha = Math.max(...[...snowRule.matchAll(/--wx-snow\)\s*\/\s*(\d+)%/g)].map((m) => +m[1])) / 100;

  /**
   * **The skyline is NOT in these stacks any more, and that is a claim worth checking.**
   *
   * It used to be: the layer covered the card, so it sat under the text and had to be counted.
   * It now lives in the band, which contains no text at all - which is exactly why the ink could
   * be raised to a strength somebody can see. Read straight from the stylesheet rather than
   * assumed, because if the drawing ever escapes the band it is back in the stack and every
   * ratio below is measuring a card that no longer exists.
   */
  const cityBox = block('.hero-city svg', 'height:');
  assert.ok(/bottom-0/.test(cityBox) && /height:\s*var\(--wx-band\)/.test(cityBox),
    'the skyline must be exactly the band, pinned to the bottom. If it covers more than that it '
    + 'is under the text again, and the contrast measured below is not the contrast on the page');

  /**
   * **The wide scrim is checked structurally, because it is now built not to need a sample point.**
   *
   * Its stops are `calc(2rem + 65ch + …)` - the body padding, the prose measure, and a fade after
   * it - so the opaque region ends exactly where the text does, at any width and in any font. That
   * is the fix for the thing two sample points in a row got wrong: `max-w-prose` is a FIXED 650px
   * in Poppins while the card shrinks with the window, so the digest's right edge climbs across
   * the card as the viewport narrows - 46% of it at 1920, 57% at 1280, 73% at 1024, 81% at 768.
   * Percentage stops tuned at one width were wrong at every other one, and measured on rendered
   * pixels the digest sat on 1.00:1 at 768px.
   *
   * So there is nothing to interpolate here: if the fully opaque stop reaches the end of the
   * measure, the text is on plain surface and the ratio is the palette's own. What is asserted is
   * that the three numbers still agree with the three the layout uses.
   */
  const wide = block('@media (min-width: 1280px)', 'background: linear-gradient(100deg');
  const opaque = wide.match(/rgb\(var\(--color-surface\)\)\s+calc\(([^)]*)\)/);
  assert.ok(opaque, 'the wide scrim must hold full opacity to a calc() stop, not to a percentage');
  const measure = opaque[1].replace(/\s+/g, '');
  assert.strictEqual(measure, '2rem+65ch',
    `the wide scrim holds opaque to ${measure}; it has to reach the end of the text, which is the `
    + 'body padding plus the prose measure. Any other value is a guess about where the words stop');

  // ...and those two numbers have to be the ones the layout actually uses.
  assert.ok(/\.hero-body\s*\{[^}]*sm:p-8/.test(CSS) || /sm:p-8/.test(block('.hero-body', '@apply')),
    'the wide scrim assumes 2rem of padding, which is `sm:p-8` on .hero-body');
  assert.ok(/max-w-prose/.test(block('.hero-digest', '@apply')),
    'the wide scrim assumes a 65ch measure, which is `max-w-prose` on .hero-digest');
  ok('the wide scrim holds opaque to the end of the text measure, in the same units the text uses');

  /**
   * The narrow scrim still needs a point, because it runs down the card and the text's height is
   * what varies. MEASURED, not computed: two attempts at deriving this from the markup were
   * optimistic in the same direction, so it comes from the browser. At 360px with the longest
   * digest paintDigest() can compose - three clauses, wrapping to five lines - the card is 488px
   * tall and the digest ends 68% down.
   *
   * **The chip below it is not the sample point, and taking it as one is a mistake this made.**
   * It sits lower - 82% at 360 - but it is a `.wx-chip`, with its own surface and its own border
   * painted over everything here, so the scrim owes it nothing. Measuring to the chip reported
   * dark/thunder at 4.16:1 while the rendered page was at 5.71:1.
   */
  const LAYOUTS = [
    // `background:` and not just `linear-gradient(180deg`: the mask is a 180deg gradient too,
    // and matching on the function name alone returned the MASK's rule - whose stops are in
    // calc() and matched nothing, so the check died rather than measuring the wrong thing. It
    // could just as easily have measured the wrong thing.
    { name: 'narrow', at: 0.68, gradient: block('.hero-scrim', 'background: linear-gradient(180deg') },
  ];

  let worst = { ratio: Infinity };
  LAYOUTS.forEach((layout) => {
    const stops = [...layout.gradient.matchAll(/rgb\(var\(--color-surface\)(?:\s*\/\s*(\d+)%)?\)\s+(\d+)%/g)]
      .map((m) => ({ alpha: m[1] === undefined ? 1 : +m[1] / 100, at: +m[2] / 100 }));
    const clear = layout.gradient.match(/transparent\s+(\d+)%/);
    assert.ok(stops.length >= 2 && clear, `could not read the ${layout.name} scrim's stops`);
    stops.push({ alpha: 0, at: +clear[1] / 100 });

    // The gradient must be well formed, not merely contain the right numbers: one missing comma
    // makes CSS discard the whole declaration, the scrim never renders, and this file's stop
    // matching still finds three perfectly good stops. That happened while tuning these.
    const args = layout.gradient.slice(layout.gradient.indexOf('linear-gradient(') + 'linear-gradient('.length);
    const list = args.slice(0, args.indexOf(');')).split(/,(?![^(]*\))/).map((x) => x.trim());
    assert.ok(/^\d+deg$/.test(list[0]), `the ${layout.name} scrim should start with an angle, got "${list[0]}"`);
    list.slice(1).forEach((stop) => assert.ok(
      /^(rgb\(var\(--color-surface\)(\s*\/\s*\d+%)?\)|transparent)\s+\d+%$/.test(stop),
      `"${stop}" is not one colour and one position - a missing comma between two stops makes the `
      + 'whole declaration invalid, the scrim vanishes, and the numbers here still read fine'));

    let scrimAlpha = stops[stops.length - 1].alpha;
    for (let i = 0; i < stops.length - 1; i += 1) {
      if (layout.at >= stops[i].at && layout.at <= stops[i + 1].at) {
        const t = (layout.at - stops[i].at) / (stops[i + 1].at - stops[i].at);
        scrimAlpha = stops[i].alpha + t * (stops[i + 1].alpha - stops[i].alpha);
        break;
      }
    }
    assert.ok(scrimAlpha > 0.4,
      `the ${layout.name} scrim is only ${(scrimAlpha * 100).toFixed(0)}% opaque where the digest `
      + 'ends; the text column is what it exists to protect');

    [['light', root, hero], ['dark', darkRoot, darkHero]].forEach(([mode, palette, ink]) => {
      const surface = token(mode === 'light' ? root : palette, '--color-surface');
      const text = token(mode === 'light' ? root : palette, '--color-text');
      const muted = token(mode === 'light' ? root : palette, '--color-muted');

      conditions.forEach((tokens, cond) => {
        const paint = (bg, name) => {
          if (name === '--wx-snow') {
            const ch = ink.match(/--wx-snow:\s*([\d ]+);/);
            const [r, g, b] = ch[1].trim().split(/\s+/).map(Number);
            return over({ r, g, b, a: snowAlpha }, bg);
          }
          return over(token(ink, name), bg);
        };
        // The card's own paint order where the TEXT is: sky, then whatever falls past it, then
        // the scrim. The city is not in it - it is in the band, below every word on this card.
        let bg = tokens.filter((t) => t.layer === 'sky').reduce((acc, t) => paint(acc, t.token), surface);
        bg = tokens.filter((t) => t.layer === 'fall').reduce((acc, t) => paint(acc, t.token), bg);
        bg = over({ ...surface, a: scrimAlpha }, bg);

        const onHeading = ratio({ ...text, a: 1 }, bg);
        const onDigest = ratio({ ...muted, a: 1 }, bg);
        const where = `${layout.name}/${mode}/${cond}`;
        if (onDigest < worst.ratio) worst = { ratio: onDigest, where };

        assert.ok(onHeading >= 4.5,
          `${where}: the greeting is ${onHeading.toFixed(2)}:1 over ${tokens.map((t) => t.token).join(' + ')}; `
          + 'large text may legally sit at 3:1 but this card has never been near that');
        assert.ok(onDigest >= 4.5,
          `${where}: the digest is ${onDigest.toFixed(2)}:1 over ${tokens.map((t) => t.token).join(' + ')}, `
          + 'below the 4.5:1 body text needs. Every layer in that stack can be fine alone and the '
          + 'sum still fail, which is why the stack is what is measured');
      });
    });
  });

  ok(`the text clears 4.5:1 over all ${conditions.size} stacks in both themes on a narrow card `
    + `(worst: ${worst.where} at ${worst.ratio.toFixed(2)}:1); the wide card is covered structurally above`);
}

// --- 4. reduced motion silences everything the hero starts --------------------
{
  const animated = new Set();
  const heroRules = [...CSS.matchAll(/\.hero(?:\[[^\]]+\])?\s*([^{]*)\{([^}]*)\}/g)];
  heroRules.forEach(([, , body]) => {
    if (/animation:/.test(body)) animated.add(true);
  });
  assert.ok(animated.size > 0, 'no animations found under .hero at all, so this check is vacuous');

  // **All of them, not the first.** This stylesheet has five prefers-reduced-motion blocks - the
  // weather skies are one, the public site's hero mesh and the contribution calendar are others -
  // and taking `indexOf` alone measured a block that has nothing to do with this card, then
  // reported the hero as unsilenced when it was silenced two hundred lines further down.
  const blocks = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{/g)]
    .map((m) => CSS.slice(m.index, CSS.indexOf('\n  }\n', m.index)));
  assert.ok(blocks.length > 0, 'the reduced-motion blocks are gone');
  const quiet = blocks.join('\n');

  // Every element that carries an `animation:` under .hero must be named in the block that turns
  // them off. Read from the selectors rather than listed, so a fifth layer cannot be forgotten.
  const carriers = new Set();
  [...CSS.matchAll(/(\.hero[^{]*)\{([^}]*animation:[^}]*)\}/g)].forEach(([, selector]) => {
    const m = selector.match(/\.hero-[a-z]+(::[a-z]+)?/g);
    if (m) m.forEach((s) => carriers.add(s));
  });
  assert.ok(carriers.size >= 2,
    `found ${carriers.size} animated hero layers; this test is now guessing, so it fails`);
  carriers.forEach((layer) => assert.ok(quiet.includes(layer),
    `${layer} declares an animation and the prefers-reduced-motion block does not silence it`));
  assert.ok(/animation:\s*none\s*!important/.test(quiet), 'and it must actually set animation: none');
  ok(`prefers-reduced-motion silences every animated layer (${[...carriers].join(', ')})`);
}

// --- 5. the panel survives the browser asking for permission ------------------
//
// Not about the sky, and here anyway: it is the one control that sits on this card, and the
// alternative is a third test file holding two assertions. Both of these were live bugs, both
// were invisible from the code, and both made "Use my location" look broken without failing.
{
  // `disabled` on the button you are standing on hands focus to the body, which fires the panel's
  // own focusout and shuts it - so the button hid its own explanation the moment it was pressed.
  const geo = APP.slice(APP.indexOf('function setupGeo('), APP.indexOf('\n}', APP.indexOf('function setupGeo(')));
  assert.ok(!/btn\.disabled\s*=/.test(geo),
    'setupGeo must not set `disabled` on the geo button: disabling the focused element moves focus '
    + 'to the body, the panel closes on focusout, and the answer is written where nobody can read it. '
    + 'Use aria-disabled and a guard.');
  // **Anchored to the call, not to the word.** `/aria-disabled/` alone matched the comment four
  // lines above the code explaining why aria-disabled is used, so deleting the setAttribute
  // outright left this green - a screen reader would get no busy state from a button that
  // silently swallows the press, and the suite would have said nothing. Watched it fail.
  assert.ok(/btn\.setAttribute\("aria-disabled"/.test(geo),
    'and it must still say it is busy to assistive technology');
  assert.ok(/if \(busy\) return;/.test(geo), 'and actually refuse the second press');

  // A null relatedTarget means focus left the document - a permission prompt, another window -
  // which is not a decision to close anything.
  const out = APP.slice(APP.indexOf('wrap.addEventListener("focusout"'), APP.indexOf('});', APP.indexOf('wrap.addEventListener("focusout"')));
  assert.ok(/if \(e\.relatedTarget && !wrap\.contains\(e\.relatedTarget\)\) set\(false\);/.test(out),
    'the panel\'s focusout must ignore a null relatedTarget, or the browser\'s own location prompt '
    + 'closes the panel behind itself');
  ok('the weather panel stays open while the browser asks for permission, and the button keeps its focus');
}

console.log(`\nhero sky: all ${passed} checks passed — every condition draws, the skyline crosses as checked numbers into a band of its own, and the text keeps its contrast`);
