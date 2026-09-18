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
 *   2. **A city in the table with no drawing is an empty box**, and a drawing nothing points at is
 *      dead weight in every page load. They have to arrive together.
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
const SKYLINES = read('_includes/chrome/city-skylines.njk');
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

// --- 2. the cities and their drawings arrive together -------------------------
{
  const table = APP.slice(APP.indexOf('const CITIES = ['), APP.indexOf('];', APP.indexOf('const CITIES = [')));
  const ids = [...table.matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 1, 'CITIES is empty, so this test is measuring nothing');

  const drawn = [...SKYLINES.matchAll(/<symbol id="city-([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(drawn.includes('generic'),
    'there must be a `generic` skyline: it is what an unmatched place falls back to, and without '
    + 'it the card would show nothing at all rather than something deliberately plain');

  ids.forEach((id) => assert.ok(drawn.includes(id),
    `CITIES lists "${id}" and chrome/city-skylines.njk has no <symbol id="city-${id}"> - the card `
    + 'would fade in an empty box'));

  // `generic` is reachable through the fallback rather than the table, so it is excluded here.
  drawn.filter((d) => d !== 'generic').forEach((d) => assert.ok(ids.includes(d),
    `chrome/city-skylines.njk draws "${d}" and nothing in CITIES can select it - it ships on every `
    + 'page load and is never seen'));

  // The script may only ever point at one of these, never build one.
  assert.ok(/art\.setAttribute\("href", `#city-\$\{id\}`\)/.test(APP),
    'drawCity must set an href on the existing <use> - building SVG from a place name is the one '
    + 'thing the sprite exists to prevent');
  assert.ok(/<use id="cityArt">/.test(PAGE),
    'the page must ship the <use> empty, so no city is drawn before the right one is known');
  ok(`every city in the table is drawn (${ids.join(', ')}), every drawing is reachable, and the script only points at one`);
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
  const scrim = block('.hero-scrim', 'linear-gradient');

  /**
   * Where the digest's last word sits, as a fraction of the card.
   *
   * `max-w-prose` is 65ch, about 520px, and `.hero-body` pads it by 32px on a card that reaches
   * 1536px. That puts the far end of the longest line around 36% across - which is the point
   * where the scrim has faded the most while still having text under it.
   */
  const SAMPLE = 0.36;

  /** The scrim's alpha at that point, interpolated between its own declared stops. */
  const stops = [...scrim.matchAll(/rgb\(var\(--color-surface\)(?:\s*\/\s*(\d+)%)?\)\s+(\d+)%/g)]
    .map((m) => ({ alpha: m[1] === undefined ? 1 : +m[1] / 100, at: +m[2] / 100 }));
  const transparentAt = scrim.match(/transparent\s+(\d+)%/);
  assert.ok(stops.length >= 2 && transparentAt, 'could not read the scrim gradient stops');
  stops.push({ alpha: 0, at: +transparentAt[1] / 100 });

  /**
   * **The gradient has to be well-formed, not merely to contain the right numbers.**
   *
   * Dropping one comma between two stops leaves a declaration CSS throws away entirely - the
   * scrim then does not render at all and the text sits directly on the weather - while this
   * file's stop-matching regex still finds three perfectly good stops and reports the strength it
   * expected. That happened while tuning these very numbers. So the argument list is checked as a
   * list: every part after the angle must be one colour and one position, and nothing else.
   */
  const args = scrim.slice(scrim.indexOf('linear-gradient(') + 'linear-gradient('.length);
  const list = args.slice(0, args.indexOf(');')).split(/,(?![^(]*\))/).map((x) => x.trim());
  assert.ok(/^\d+deg$/.test(list[0]), `the scrim gradient should start with an angle, got "${list[0]}"`);
  list.slice(1).forEach((stop) => assert.ok(
    /^(rgb\(var\(--color-surface\)(\s*\/\s*\d+%)?\)|transparent)\s+\d+%$/.test(stop),
    `"${stop}" is not one colour and one position - a missing comma between two stops makes the `
    + 'whole declaration invalid, the scrim vanishes, and the numbers here still read fine'));

  let scrimAlpha = stops[stops.length - 1].alpha;
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (SAMPLE >= stops[i].at && SAMPLE <= stops[i + 1].at) {
      const t = (SAMPLE - stops[i].at) / (stops[i + 1].at - stops[i].at);
      scrimAlpha = stops[i].alpha + t * (stops[i + 1].alpha - stops[i].alpha);
      break;
    }
  }
  assert.ok(scrimAlpha > 0.4,
    `the scrim is only ${(scrimAlpha * 100).toFixed(0)}% opaque where the digest ends; the text `
    + 'column is what it exists to protect');

  /**
   * **The real paint stack, per condition, rather than one ink at a time.**
   *
   * The first version measured each token alone and passed. The card paints them together: a
   * cloudy dark card puts two veils AND the skyline under the digest, and that stack measured
   * 4.49:1 while every single layer in it measured comfortably above the floor. `--wx-veil2` was
   * not even in the list. Reading the tokens out of each condition's own rule fixes both, and a
   * tenth condition added later is measured without anybody remembering to add it here.
   *
   * The discs are excluded on purpose: they are bounded circles at 74% across, and a separate
   * assertion below keeps them out of the text column. Everything else is full-bleed.
   */
  const POSITIONAL = ['--wx-disc', '--wx-moon'];
  const conditions = new Map();
  // Every condition named in the selector LIST, not just the first. `clear` and `partly` share a
  // rule, as do `cloud` and `fog`; matching one name per rule silently dropped two of the nine and
  // the count guard below is what caught it.
  //
  // Each token is kept with the WEIGHT it actually contributes to the background under a glyph.
  // A wash covers the card, so it counts in full. A streak is 1.5px every 14px and a snowflake is
  // a 2px dot on a 90px tile - modelling those as full-bleed said dark/snow was the worst case on
  // the card at 3.74:1, when the flakes together cover about a quarter of one percent of it. The
  // coverage is computed from the same declaration that draws them.
  const coverageOf = (body, token) => {
    const streak = new RegExp(`repeating-linear-gradient\\([^)]*?var\\(${token}\\)\\s*0\\s*([\\d.]+)px,\\s*transparent\\s*[\\d.]+px\\s*([\\d.]+)px`).exec(body);
    if (streak) return Number(streak[1]) / Number(streak[2]);
    // A field of dots: every radius against the tile it repeats on.
    const dots = [...body.matchAll(new RegExp(`radial-gradient\\(circle at [^,]+,\\s*rgb\\(var\\(${token}\\)[^)]*\\)\\s*([\\d.]+)px`, 'g'))];
    if (!dots.length) return 1;
    const sizes = (body.match(/background-size:\s*([^;]+);/) || [, ''])[1].split(',')
      .map((pair) => pair.trim().split(/\s+/).map((v) => parseFloat(v)))
      .filter(([w, h]) => Number.isFinite(w) && Number.isFinite(h));
    return dots.reduce((sum, d, i) => {
      const [w, h] = sizes[i] || sizes[sizes.length - 1] || [100, 100];
      return sum + (Math.PI * Number(d[1]) ** 2) / (w * h);
    }, 0);
  };

  [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)].forEach(([, selector, body]) => {
    const named = [...selector.matchAll(/\.hero\[data-wx="(\w+)"\]/g)].map((m) => m[1]);
    if (!named.length) return;
    const used = [...new Set([...body.matchAll(/var\((--wx-[a-z-]+)\)/g)].map((m) => m[1]))]
      .filter((t) => !POSITIONAL.includes(t))
      .map((t) => ({ token: t, coverage: coverageOf(body, t) }));
    if (!used.length) return;
    named.forEach((cond) => conditions.set(cond, [...(conditions.get(cond) || []), ...used]));
  });
  assert.ok(conditions.size >= 8,
    `only found ${conditions.size} conditions with ink in them; this test is now guessing, so it fails`);

  // The snow layer names its channel through rgb(var(--wx-snow) / N%) rather than as a finished
  // colour, so its strongest stop is read out of the rule it is used in.
  const snowRule = block('.hero[data-wx="snow"] .hero-fall', 'radial-gradient');
  const snowAlpha = Math.max(...[...snowRule.matchAll(/--wx-snow\)\s*\/\s*(\d+)%/g)].map((m) => +m[1])) / 100;

  // The skyline is ink too and runs the full width under the text, so it is in every stack. It is
  // declared as channels plus a separate alpha rather than as one colour, so it is assembled here.
  //
  // **What this check binds is the COMBINATION, which is worth stating plainly.** At the current
  // scrim strength no single ink can fail it: push the city to 95% or the second cloud bank to
  // 85% and the digest still clears the floor, because 87% of what is under it is surface colour.
  // Weaken the scrim and every ink becomes load-bearing at once - which is exactly what happened
  // while these numbers were being set. At 82.7% the sun-plus-skyline stack measured 4.44:1 and
  // the thunder stack 4.41:1, and this assertion is what said so. It is satisfied by a scrim
  // doing its job, and it fires the moment that stops.
  const cityInk = (source) => {
    const ch = source.match(/--wx-city:\s*([\d ]+);/);
    const al = source.match(/--wx-city-alpha:\s*([\d.]+)%/);
    assert.ok(ch && al, 'could not read the city ink - this test is now guessing, so it fails');
    const [r, g, b] = ch[1].trim().split(/\s+/).map(Number);
    return { r, g, b, a: Number(al[1]) / 100 };
  };

  let worst = { ratio: Infinity };
  [['light', root, hero], ['dark', darkRoot, darkHero]].forEach(([mode, palette, ink]) => {
    const surface = token(mode === 'light' ? root : palette, '--color-surface');
    const text = token(mode === 'light' ? root : palette, '--color-text');
    const muted = token(mode === 'light' ? root : palette, '--color-muted');

    conditions.forEach((tokens, cond) => {
      // surface, then every ink this condition paints, then the skyline, then the scrim over it.
      let bg = surface;
      tokens.forEach(({ token: name, coverage }) => {
        let paint;
        if (name === '--wx-snow') {
          const ch = ink.match(/--wx-snow:\s*([\d ]+);/);
          const [r, g, b] = ch[1].trim().split(/\s+/).map(Number);
          paint = { r, g, b, a: snowAlpha };
        } else {
          paint = token(ink, name);
        }
        bg = over({ ...paint, a: paint.a * coverage }, bg);
      });
      bg = over(cityInk(ink), bg);
      bg = over({ ...surface, a: scrimAlpha }, bg);

      const onHeading = ratio({ ...text, a: 1 }, bg);
      const onDigest = ratio({ ...muted, a: 1 }, bg);
      if (onDigest < worst.ratio) worst = { ratio: onDigest, mode, cond };

      assert.ok(onHeading >= 4.5,
        `${mode}/${cond}: the greeting is ${onHeading.toFixed(2)}:1 over the whole stack `
        + `(${tokens.map((t) => t.token).join(' + ')} + the skyline); large text may legally sit at 3:1 but this card `
        + 'has never been near that and should not start');
      assert.ok(onDigest >= 4.5,
        `${mode}/${cond}: the digest is ${onDigest.toFixed(2)}:1 over the whole stack `
        + `(${tokens.map((t) => t.token).join(' + ')} + the skyline), below the 4.5:1 that body text needs. Every layer `
        + 'in that stack can be fine on its own and the sum still fail, which is the point of '
        + 'measuring it this way');
    });
  });
  ok(`the text clears 4.5:1 over all ${conditions.size} painted stacks in both themes `
    + `(worst: ${worst.mode}/${worst.cond} at ${worst.ratio.toFixed(2)}:1, scrim ${(scrimAlpha * 100).toFixed(0)}% where the digest ends)`);
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

console.log(`\nhero sky: all ${passed} checks passed — every condition draws, every city is drawn, and the text keeps its contrast`);
