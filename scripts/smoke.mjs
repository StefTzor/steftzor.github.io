#!/usr/bin/env node
/**
 * The post-deploy smoke test: production, in a real browser, the way a reader gets it.
 *
 *   CHROME=/path/to/chrome node scripts/smoke.mjs [outDir]
 *   SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD  optional; without them the signed-in pages are skipped
 *   SMOKE_ONLY=<regex>  only the checks whose name matches, e.g. SMOKE_ONLY=status
 *
 * Every page is loaded at desktop and phone width, public pages in both themes, and fails on:
 * a non-200 document, a console error or uncaught exception (CSP violations arrive as these), a
 * failed request to our own hosts, horizontal overflow, or a layout shift above CLS_MAX. The two
 * bugs nobody would have caught by reading - a 7.5px shift and signed-in chrome flashing - were
 * both visual; this is the net for that class.
 *
 * Screenshots are written to outDir for a person to look at (CI uploads them). They are not
 * pixel-diffed: the pages carry live weather, time of day and status, so a diff would fail on
 * the sky rather than on a bug. ponytail: add pixel diffs with frozen fixtures if a visual bug
 * slips past the layout checks.
 *
 * No puppeteer: Node 22's global WebSocket drives Chrome's DevTools protocol directly.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = process.env.SMOKE_SITE || 'https://tzortzoglou.eu'; // a local preview, for trying a fix
const APP = 'https://app.tzortzoglou.eu';
const PUBLIC = ['/', '/about/', '/portfolio/', '/process/', '/code/', '/contact/', '/status/', '/privacy/'];
const APP_OUT = ['/login/'];
const APP_IN = ['/', '/transit/', '/f1/', '/profile/'];
const VIEWPORTS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};
// Google's "good" is 0.1. Tighter, because the shifts worth catching here are small ones.
const CLS_MAX = 0.05;
// Known debts, capped at what was measured so they cannot get worse. Lower each one as it is fixed.
// /transit/ reserves twelve board rows and at night there are fewer departures, so the board
// shrinks; /f1/ cannot reserve the round, which is 200px of sessions or 836px of results.
const CLS_KNOWN = { 'app-in-transit-': 0.3, 'app-in-f1-': 0.6 }; // measured 2026-09-26
const OURS = /^https:\/\/(app\.|api\.)?tzortzoglou\.eu\//;
const OUT = process.argv[2] || 'smoke-out';
const ONLY = process.env.SMOKE_ONLY ? new RegExp(process.env.SMOKE_ONLY) : null;
const wanted = (name) => !ONLY || ONLY.test(name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Chrome and the protocol ----------------------------------------------------------------

async function launch() {
  const chrome = process.env.CHROME;
  if (!chrome) throw new Error('set CHROME to a Chrome or Chromium binary');
  const profile = mkdtempSync(join(tmpdir(), 'smoke-'));
  const proc = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('chrome exited: ' + err.slice(-500))));
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  return { proc, profile, ws: page.webSocketDebuggerUrl };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    }
  };
  return new Promise((resolve) => {
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        pending.set(++id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      on: (event, fn) => listeners.set(event, [...(listeners.get(event) || []), fn]),
      close: () => ws.close(),
    });
  });
}

// --- one page ---------------------------------------------------------------------------------

/** Loads url and returns what went wrong, as a list of strings. Empty means it passed. */
async function check(cdp, state, url, viewport, shot) {
  const known = Object.entries(CLS_KNOWN).find(([prefix]) => shot.startsWith(prefix));
  const clsMax = known ? known[1] : CLS_MAX;
  state.errors = [];
  state.doc = null;
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORTS[viewport]);
  const loaded = new Promise((r) => { state.onLoad = r; });
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(2500); // late requests: the API calls the page makes after load
  await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });

  const { result } = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `({
      path: location.pathname,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cls: window.__cls || 0,
      moved: Object.entries(window.__moved || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]).join(', '),
      height: document.documentElement.scrollHeight,
    })`,
  });
  const page = result.value;
  const problems = [...state.errors];
  if (state.doc !== 200) problems.push(`document answered ${state.doc}`);
  if (page.overflow > 0) problems.push(`scrolls sideways by ${page.overflow}px`);
  if (page.cls > clsMax) problems.push(`layout shift ${page.cls.toFixed(3)} (max ${clsMax}): ${page.moved || 'unknown'}`);

  const { width } = VIEWPORTS[viewport];
  const shotRes = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(page.height, 8000), scale: 1 },
  });
  writeFileSync(join(OUT, shot + '.png'), Buffer.from(shotRes.data, 'base64'));
  return { problems, path: page.path };
}

async function signIn(cdp, state, email, password) {
  await check(cdp, state, APP + '/login/', 'desktop', 'app-login-before-sign-in');
  // The credentials go in as JSON literals, never through argv or a log line.
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('email', ${JSON.stringify(email)});
      set('password', ${JSON.stringify(password)});
      document.getElementById('loginForm').requestSubmit();
    })()`,
  });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true });
    if (result.value !== '/login/') return true;
  }
  return false;
}

// --- the run ----------------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { proc, profile, ws } = await launch();
  const cdp = await connect(ws);
  const state = { errors: [], doc: null, onLoad: null };

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    // Also records which elements moved, so a failure says where to look.
    source: `window.__cls = 0; window.__moved = {}; try { new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__cls += e.value;
        for (const s of e.sources || []) { const n = s.node; if (!n || !n.tagName) continue;
          const k = n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList && n.classList[0] ? '.' + n.classList[0] : '');
          window.__moved[k] = (window.__moved[k] || 0) + e.value; } }
    }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}`,
  });
  cdp.on('Page.loadEventFired', () => state.onLoad && state.onLoad());
  cdp.on('Network.responseReceived', (p) => {
    if (p.type === 'Document') state.doc = p.response.status;
    else if (OURS.test(p.response.url) && p.response.status >= 400) {
      state.errors.push(`${p.response.status} from ${p.response.url}`);
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => state.errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0]));
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') state.errors.push('console: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') state.errors.push(`${entry.source}: ${entry.text.slice(0, 200)}`);
  });

  const runs = [];
  for (const path of PUBLIC) {
    for (const viewport of Object.keys(VIEWPORTS)) {
      for (const theme of ['dark', 'light']) {
        const url = SITE + path + (theme === 'light' ? `?theme=light&theme-at=${Date.now()}` : '');
        runs.push({ url, viewport, name: `site${path.replace(/\//g, '-')}${viewport}-${theme}` });
      }
    }
  }
  for (const path of APP_OUT) {
    for (const viewport of Object.keys(VIEWPORTS)) runs.push({ url: APP + path, viewport, name: `app${path.replace(/\//g, '-')}${viewport}` });
  }

  let failed = 0;
  const report = (name, problems) => {
    if (problems.length) failed += 1;
    console.log(`${problems.length ? 'FAIL' : 'pass'}  ${name}`);
    problems.forEach((p) => console.log('        ' + p));
  };

  for (const r of runs.filter((x) => wanted(x.name))) {
    const { problems } = await check(cdp, state, r.url, r.viewport, r.name);
    report(r.name, problems);
  }

  const email = process.env.SMOKE_USER_EMAIL;
  const password = process.env.SMOKE_USER_PASSWORD;
  if (email && password && APP_IN.some((p) => wanted('app-in' + p.replace(/\//g, '-')))) {
    if (!(await signIn(cdp, state, email, password))) {
      report('app sign-in', ['still on /login/ after 20s']);
    } else {
      // Dark only: each signed-in page costs about five API calls against a limit of 100 per
      // 15 minutes per address, and the themes are already covered on the public pages.
      for (const path of APP_IN) {
        for (const viewport of Object.keys(VIEWPORTS)) {
          const name = `app-in${path.replace(/\//g, '-')}${viewport}`;
          if (!wanted(name)) continue;
          const { problems, path: landed } = await check(cdp, state, APP + path, viewport, name);
          if (landed !== path) problems.push(`landed on ${landed}, not ${path}: signed out?`);
          report(name, problems);
        }
      }
    }
  } else {
    console.log('skip  signed-in pages (no SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD)');
  }

  cdp.close();
  proc.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  console.log(failed ? `\nsmoke: ${failed} page(s) failed` : '\nsmoke: every page loaded clean');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('smoke:', err.message); process.exit(2); });
