/**
 * Contrast measured from RENDERED PIXELS, not from a model.  MANUAL - needs a browser.
 *
 *   npm run build:app
 *   python3 -m http.server 8137 --directory _app &
 *   node scripts/manual/hero-contrast-pixels.mjs
 *
 * Needs `puppeteer-core` and a Chrome binary, NEITHER of which is a dependency of this repo - on
 * purpose, because a 300MB browser in devDependencies to run one script by hand is the wrong
 * trade. Install it wherever you like and point the import at it. It also wants a probe page at
 * _app/hero-probe.html: the hero markup and the two sprites from _app/index.html, in a document
 * with the compiled stylesheet and `class="dark"` on <html>.
 *
 * Not in `npm test` because it needs Chrome and a server, and the suite runs on a CI box with
 * neither. It is the authority all the same: scripts/hero-sky.test.js models this, and the model
 * was wrong three times before this existed.
 *
 * Serves the real built app so Poppins actually loads - a file:// render falls back to Liberation
 * Sans, whose `ch` is 0.55em against Poppins' 0.625em, which is how the sample point was derived
 * 14% too far left. Hides the text, samples the background where the glyphs were, and reports the
 * worst contrast against --color-muted.
 */
import puppeteer from 'puppeteer-core';
const WIDTHS = [390, 768, 1024, 1280, 1536, 1920];
const STATES = ['clear', 'cloud', 'rain', 'snow', 'thunder'];
const b = await puppeteer.launch({ executablePath: process.env.HOME + '/.cache/puppeteer/chrome/linux-152.0.7977.54/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const rows = [];
for (const w of WIDTHS) {
  await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
  await p.goto('http://127.0.0.1:8137/hero-probe.html', { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 250));
  for (const state of STATES) {
    const out = await p.evaluate(async (st) => {
      const hero = document.getElementById('hero');
      hero.dataset.wx = st; hero.dataset.city = 'uppsala'; hero.dataset.night = 'false';
      hero.querySelector('use').setAttribute('href', '#city-uppsala');
      hero.querySelector('.hero-city').style.opacity = '1';
      // freeze every animation at its most intense frame, then hide the text
      document.querySelectorAll('.hero-sky,.hero-fall').forEach(e => { e.style.animationPlayState='paused'; });
      const d = document.getElementById('digest');
      const box = d.getBoundingClientRect();
      const h = hero.getBoundingClientRect();
      d.style.visibility = 'hidden';
      document.getElementById('greeting').style.visibility = 'hidden';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { box: { x: box.x, y: box.y, w: box.width, h: box.height }, hero: { x: h.x, y: h.y, w: h.width, h: h.height },
               muted: getComputedStyle(document.documentElement).getPropertyValue('--color-muted').trim() };
    }, state);
    const shot = await p.screenshot({ clip: { x: out.box.x, y: out.box.y, width: Math.max(1, out.box.w), height: Math.max(1, out.box.h) } });
    rows.push({ w, state, shot, muted: out.muted, frac: ((out.box.x + out.box.w - out.hero.x) / out.hero.w) });
    await p.evaluate(() => { document.getElementById('digest').style.visibility=''; document.getElementById('greeting').style.visibility=''; });
  }
}
await b.close();
// decode the PNGs in a second pass, in-browser (no image lib installed)
const b2 = await puppeteer.launch({ executablePath: process.env.HOME + '/.cache/puppeteer/chrome/linux-152.0.7977.54/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'] });
const p2 = await b2.newPage();
await p2.goto('data:text/html,<body>');
const worst = new Map();
for (const r of rows) {
  const ratio = await p2.evaluate(async (dataUrl, muted) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const [mr, mg, mb] = muted.split(/\s+/).map(Number);
    const L = (r, gg, bb) => { const f = v => { const s = v/255; return s <= 0.03928 ? s/12.92 : ((s+0.055)/1.055)**2.4; };
      return 0.2126*f(r) + 0.7152*f(gg) + 0.0722*f(bb); };
    const lm = L(mr, mg, mb);
    let low = 99;
    for (let i = 0; i < px.length; i += 4) {
      const lb = L(px[i], px[i+1], px[i+2]);
      const [hi, lo] = lm > lb ? [lm, lb] : [lb, lm];
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < low) low = ratio;
    }
    return low;
  }, 'data:image/png;base64,' + Buffer.from(r.shot).toString('base64'), r.muted);
  const k = r.w;
  if (!worst.has(k) || ratio < worst.get(k).ratio) worst.set(k, { ratio, state: r.state, frac: r.frac });
}
await b2.close();
console.log('viewport  worst digest contrast (dark)   condition   digest right edge');
for (const [w, v] of worst) console.log(`  ${String(w).padEnd(6)}  ${v.ratio.toFixed(2)}:1${v.ratio < 4.5 ? '  FAIL' : '  ok  '}                  ${v.state.padEnd(9)}   ${(v.frac*100).toFixed(1)}% of card`);
