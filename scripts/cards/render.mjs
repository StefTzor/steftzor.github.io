#!/usr/bin/env node
/**
 * Renders the three identity cards from _data/identity.js.
 *
 *   npm run cards            all three
 *   npm run cards -- og      just one
 *
 * Headless Chrome from the Puppeteer cache, because Chrome is a Flatpak here and playwright
 * cannot find it — see the portfolio skill's references/verification.md. No new dependency.
 *
 * Only og-cover.png is committed and served; the other two are exports you upload by hand,
 * so they land in dist-cards/ which is gitignored. LinkedIn and GitHub have no API for this.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const identity = createRequire(import.meta.url)(join(ROOT, '_data', 'identity.js'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dots = identity.stack.map(esc).join(' &nbsp;·&nbsp; ');

/** Each card: the class the template styles, the pixel box, the markup, and where it lands. */
const CARDS = {
  og: {
    size: [1200, 630],
    out: join(ROOT, 'images', 'og-cover.png'),
    html: `<div class="card og"><div class="inner">
      <img class="photo" src="../../images/stefanos_profile.png" alt="">
      <div>
        <div class="name">${esc(identity.name)}</div>
        <div class="name-el">${esc(identity.nameEl)}</div>
        <div class="rule"></div>
        <div class="role">${esc(identity.title)}</div>
        <div class="claim">${esc(identity.anchor)}</div>
        <div class="stack">${dots}</div>
        <div class="url">${esc(identity.url)}</div>
      </div></div></div>`,
  },
  linkedin: {
    size: [1584, 396],
    out: join(ROOT, 'dist-cards', 'linkedin-banner.png'),
    html: `<div class="card li"><div class="inner">
      <div class="name">${esc(identity.name)}</div>
      <div class="rule"></div>
      <div class="role">${esc(identity.title)}</div>
      <div class="claim">${esc(identity.anchor)}</div>
      <div class="stack">${dots} &nbsp;·&nbsp; ${esc(identity.place)}</div>
      </div></div>`,
  },
  github: {
    size: [1000, 280],
    out: join(ROOT, 'dist-cards', 'github-banner.png'),
    html: `<div class="card gh"><div class="inner">
      <div class="name">${esc(identity.name)}</div>
      <div class="subtitle">${esc(identity.githubSubtitle)}</div>
      <div class="stack">${esc(identity.url)}</div>
      </div></div>`,
  },
};

const chromeDir = join(process.env.HOME, '.cache', 'puppeteer', 'chrome');
if (!existsSync(chromeDir)) throw new Error(`no Chrome in ${chromeDir} — see verification.md`);
const CHROME = join(chromeDir, readdirSync(chromeDir).sort().pop(), 'chrome-linux64', 'chrome');

const template = readFileSync(join(HERE, 'card.html'), 'utf8');
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const todo = wanted.length ? wanted : Object.keys(CARDS);

mkdirSync(join(ROOT, 'dist-cards'), { recursive: true });

for (const key of todo) {
  const card = CARDS[key];
  if (!card) throw new Error(`unknown card "${key}" — one of ${Object.keys(CARDS).join(', ')}`);
  const [w, h] = card.size;

  // Written beside the template so the relative font and photo paths resolve.
  const page = join(HERE, `.render-${key}.html`);
  writeFileSync(page, template.replace('<div id="card"></div>', card.html));

  // --force-device-scale-factor=1 and an exact window: the screenshot must be the declared
  // pixel size, not whatever the display would have chosen.
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${w},${h}`,
    '--virtual-time-budget=8000', `--screenshot=${card.out}`, `file://${page}`,
  ], { stdio: 'pipe' });

  // Trust the file, not the exit code: read the PNG header back and assert the real dimensions.
  const buf = readFileSync(card.out);
  const gotW = buf.readUInt32BE(16);
  const gotH = buf.readUInt32BE(20);
  if (gotW !== w || gotH !== h) throw new Error(`${key}: expected ${w}x${h}, got ${gotW}x${gotH}`);
  console.log(`  ${key.padEnd(9)} ${gotW}x${gotH}  ${(buf.length / 1024).toFixed(0)} KB  ${card.out.replace(ROOT + '/', '')}`);
}
