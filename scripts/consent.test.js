/**
 * Self-check for consent.js — the analytics gate is a legal path, so it is tested.
 * No framework, no deps:  node scripts/consent.test.js
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(__dirname + '/consent.js', 'utf8');

function run(stored) {
  const store = stored === null ? {} : { 'analytics-consent': stored };
  const appended = [];
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
  const doc = {
    body: { appendChild(n) { appended.push(n); byId[n.id] = n; collect(n); } },
    createElement: el,
    getElementById: (id) => byId[id] || null,
    querySelector: (sel) =>
      sel === 'script[data-goatcounter]'
        ? appended.find(n => n._attrs && n._attrs['data-goatcounter']) || null
        : null,
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
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  assert.ok(domReady, 'script must register DOMContentLoaded');
  domReady();

  const analytics = () => appended.filter(n => n._attrs && n._attrs['data-goatcounter']);
  return {
    store,
    banner: () => appended.find(n => n.id === 'consent-banner') || null,
    analyticsLoaded: () => analytics().length > 0,
    analyticsNode: () => analytics()[0],
    click: (id) => byId[id] && byId[id]._listeners.click && byId[id]._listeners.click(),
  };
}

// 1. First visit: ask, and load nothing until told.
let t = run(null);
assert.ok(t.banner(), 'first visit must show the banner');
assert.strictEqual(t.analyticsLoaded(), false, 'analytics must NOT load before consent');

// 2. Declining loads nothing and is remembered.
t = run(null);
t.click('consent-reject');
assert.strictEqual(t.analyticsLoaded(), false, 'decline must not load analytics');
assert.strictEqual(t.store['analytics-consent'], 'denied', 'decline must be persisted');

// 3. Accepting loads it, pointed at the right endpoint.
t = run(null);
t.click('consent-accept');
assert.strictEqual(t.analyticsLoaded(), true, 'accept must load analytics');
assert.strictEqual(t.store['analytics-consent'], 'granted');
const n = t.analyticsNode();
assert.strictEqual(n.src, 'https://gc.zgo.at/count.js', 'must use https, not protocol-relative');
assert.strictEqual(n._attrs['data-goatcounter'], 'https://steftzor.goatcounter.com/count');
assert.strictEqual(n.async, true, 'analytics must not block rendering');

// 4. Returning visitor who accepted: load, do not re-ask.
t = run('granted');
assert.strictEqual(t.analyticsLoaded(), true, 'stored consent must load analytics');
assert.strictEqual(t.banner(), null, 'must not re-ask after a decision');

// 5. Returning visitor who declined: still nothing, still no nagging.
t = run('denied');
assert.strictEqual(t.analyticsLoaded(), false, 'stored refusal must be honoured');
assert.strictEqual(t.banner(), null, 'must not nag someone who declined');

console.log('consent.js: all 5 checks passed — analytics is opt-in and refusal sticks');
