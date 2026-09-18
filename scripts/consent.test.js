/**
 * Self-check for consent.js — the analytics gate is a legal path, so it is tested.
 * The property that matters is negative: no beacon leaves the browser without consent.
 * No framework, no deps:  node scripts/consent.test.js
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(__dirname + '/consent.js', 'utf8');
const ENDPOINT = 'https://api.tzortzoglou.eu/hit';

// `opts.beacon: false` removes navigator.sendBeacon, which is how an older browser looks
// and is the only way the fetch fallback is ever reached.
// `opts.storage: false` makes every localStorage call throw, which is how a browser with site
// data blocked looks - Safari in Lockdown Mode, a private window with storage denied, a
// content blocker. The banner still has to appear and the choice still has to hold for the
// page it was made on.
function run(stored, opts) {
  opts = opts || {};
  const store = stored === null ? {} : { 'analytics-consent': stored };
  const appended = [];
  const sent = [];                        // every request the page tried to make
  let domReady;

  const el = (tag) => ({
    tagName: tag, id: '', className: '', innerHTML: '', textContent: '',
    _attrs: {}, _listeners: {}, _children: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    appendChild(c) { this._children.push(c); },
    remove() { this.removed = true; },
    focus() { this.focused = true; },
    querySelector() { return null; },
  });

  const byId = {};
  // /cookies/ is the only page carrying the toggle, the state line and the note; seeded here
  // because clicking that toggle is the only way one page load reaches a decision twice, which
  // is what the once-per-load guard exists for. On any other page consent.js finds none of
  // them and does nothing with them, exactly as it does here when a check ignores them.
  ['consent-withdraw', 'consent-state', 'consent-note'].forEach((id) => {
    byId[id] = el('span');
    byId[id].id = id;
  });

  const doc = {
    body: { appendChild(n) { appended.push(n); byId[n.id] = n; collect(n); } },
    referrer: 'https://www.linkedin.com/in/someone/?utm_source=x',
    createElement: el,
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    addEventListener(t, fn) { if (t === 'DOMContentLoaded') domReady = fn; },
  };
  // the banner's buttons live in innerHTML, so register them for getElementById
  function collect(node) {
    const ids = (node.innerHTML || '').match(/id="([^"]+)"/g) || [];
    ids.forEach(m => {
      const id = m.slice(4, -1);
      byId[id] = byId[id] || el('button');
      byId[id].id = id;
    });
  }

  const ctx = {
    document: doc,
    location: { hostname: 'tzortzoglou.eu', pathname: '/about/' },
    // A viewport, because the beacon reads one. `opts.width` lets a test choose it; the default
    // is a laptop. This is the only browser global the counting path touches that is not one of
    // the four already faked below, and leaving it out is how the field was found missing.
    window: { innerWidth: opts.width === undefined ? 1280 : opts.width },
    Blob: class { constructor(parts, o) { this.text = parts.join(''); this.type = o && o.type; } },
    navigator: opts.beacon === false ? {} : {
      sendBeacon(url, blob) {
        sent.push({ via: 'beacon', url, body: blob.text, type: blob.type });
        return true;
      },
    },
    fetch(url, init) {
      sent.push({ via: 'fetch', url, body: init.body, init });
      return { catch() { return this; } };
    },
    localStorage: opts.storage === false ? {
      getItem() { throw new Error('storage is blocked'); },
      setItem() { throw new Error('storage is blocked'); },
    } : {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  assert.ok(domReady, 'script must register DOMContentLoaded');
  domReady();

  return {
    store,
    sent,
    banner: () => appended.find(n => n.id === 'consent-banner') || null,
    click: (id) => byId[id] && byId[id]._listeners.click && byId[id]._listeners.click(),
    text: (id) => byId[id] && byId[id].textContent,
  };
}

// 1. First visit: ask, and send nothing until told.
let t = run(null);
assert.ok(t.banner(), 'first visit must show the banner');
assert.deepStrictEqual(t.sent, [], 'nothing may be sent before consent');

// 2. Declining sends nothing and is remembered.
t = run(null);
t.click('consent-reject');
assert.deepStrictEqual(t.sent, [], 'decline must send nothing');
assert.strictEqual(t.store['analytics-consent'], 'denied', 'decline must be persisted');

// 3. Accepting sends exactly one beacon, to the right endpoint, carrying no identifier.
t = run(null);
t.click('consent-accept');
assert.strictEqual(t.sent.length, 1, 'accept must send exactly one beacon');
assert.strictEqual(t.store['analytics-consent'], 'granted');
const hit = t.sent[0];
assert.strictEqual(hit.via, 'beacon', 'sendBeacon is preferred where it exists');
assert.strictEqual(hit.url, ENDPOINT, 'must post to the first-party endpoint over https');
// text/plain keeps the beacon a CORS-simple request, so no OPTIONS is sent before it. The
// endpoint parses both; this asserts the client half of that bargain, because reverting it to
// application/json would cost a preflight per page view and nothing would otherwise notice.
assert.strictEqual(hit.type, 'text/plain');
const body = JSON.parse(hit.body);
// This assertion is a tripwire on the one thing /privacy/ enumerates: what the browser sends.
// It fired on purpose when `w` was added, and it is meant to fire again for the next field. A
// fourth key here without a fourth entry in the privacy notice is the failure it exists to catch.
assert.deepStrictEqual(Object.keys(body).sort(), ['path', 'referrer', 'w'],
  'the body carries the page, the referrer and the window width — no id, no session, no client-chosen property');
// The identifier is computed on the server from things the browser did not choose to send. It is
// not in this body and must never be: a client-supplied visitor number would be a value anybody
// could set to anybody else's.
assert.ok(!('visitorId' in body) && !('id' in body), 'the visitor number is the server’s, not the client’s');
assert.strictEqual(body.w, 1280, 'the width is the viewport the page was laid out in');
// The number itself, not a bracket. The bucketing is the server's, because a client that decided
// its own bracket would be a client deciding what is stored about it - the same reason `property`
// is read from the Origin rather than taken from the body.
assert.strictEqual(typeof body.w, 'number', 'sent as a number, bucketed on the server');
assert.strictEqual(body.path, '/about/', 'the path must arrive without a query string or fragment');

// 4. Returning visitor who accepted: count once, do not re-ask.
t = run('granted');
assert.strictEqual(t.sent.length, 1, 'stored consent must count the page view');
assert.strictEqual(t.sent[0].url, ENDPOINT);
assert.strictEqual(t.banner(), null, 'must not re-ask after a decision');

// 5. Returning visitor who declined: still nothing, still no nagging.
t = run('denied');
assert.deepStrictEqual(t.sent, [], 'stored refusal must be honoured');
assert.strictEqual(t.banner(), null, 'must not nag someone who declined');

// 6. Without sendBeacon the fallback still fires, and still only after consent.
t = run('denied', { beacon: false });
assert.deepStrictEqual(t.sent, [], 'the fallback must be gated by consent too');
t = run('granted', { beacon: false });
assert.strictEqual(t.sent.length, 1);
assert.strictEqual(t.sent[0].via, 'fetch');
assert.strictEqual(t.sent[0].init.keepalive, true, 'the fallback must survive the page unloading');
// The fallback is a fetch, which is preflighted whatever it carries, so it keeps the JSON
// content type rather than pretending to be simple.
assert.strictEqual(t.sent[0].init.headers['Content-Type'], 'application/json');

// 7. One page load is one view, however many times a decision is made on it.
// Someone on /cookies/ who turns analytics off and straight back on has granted consent twice
// on one page, and the second grant must not count the page again. Deleting the `counted`
// guard passes every check above and fails this one.
t = run('granted');
assert.strictEqual(t.sent.length, 1, 'the stored grant counts the page once');
t.click('consent-withdraw');                  // granted -> denied
t.click('consent-withdraw');                  // denied -> granted again
assert.strictEqual(t.sent.length, 1, 'a second grant on the same page load must not count it twice');
assert.strictEqual(t.store['analytics-consent'], 'granted', 'the toggle still persists the choice');

// 8. A browser blocking site storage: still asked, still silent until told, still obeyed.
// This is the path where every read and write throws, so a missing try/catch would take the
// banner down with it and leave someone with no way to consent and no way to refuse.
t = run(null, { storage: false });
assert.ok(t.banner(), 'blocked storage must still be asked');
assert.deepStrictEqual(t.sent, [], 'nothing may be sent before a choice, storage or no storage');
t.click('consent-accept');
assert.strictEqual(t.sent.length, 1, 'accepting counts even when the choice cannot be persisted');
assert.strictEqual(t.text('consent-state'), 'Analytics is ON. You accepted.',
  'the in-memory fallback must hold the choice for the page it was made on');

console.log('consent.js: all 8 checks passed — counting is opt-in, refusal sticks, one page load is one view, and the beacon still chooses no identifier of its own');
