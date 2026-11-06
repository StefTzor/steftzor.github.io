'use strict';

/**
 * The Admin chat page's drawing, run without a browser, the way analytics-render.test.js does it:
 * the imports and the one side effect at the bottom go, and the rest runs against a small DOM.
 * Its innerHTML throws, because a stranger's question reaching that setter is the failure this
 * file exists to catch.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../app/scripts/admin-chat.js'), 'utf8');
let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

function element(tag) {
  return {
    tag, className: '', children: [], attrs: {}, own: '',
    get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this.own = String(v); this.children = []; },
    get innerHTML() { throw new Error('innerHTML read'); },
    set innerHTML(v) { throw new Error('innerHTML written'); },
    appendChild(kid) { this.children.push(kid); return kid; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
  };
}

function load() {
  const byId = new Map();
  const document = {
    createElement: element,
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, Object.assign(element('div'), { id })); return byId.get(id); },
  };
  const body = SRC.split('\n').filter((l) => !l.startsWith('import ')).join('\n').replace(/profile\.then\([\s\S]*$/, '');
  const ctx = { document, el: document.getElementById, Date, Number, Math, Map };
  vm.createContext(ctx);
  vm.runInContext(body + '\nthis.renderSummary = renderSummary; this.renderTraces = renderTraces;', ctx);
  return { ctx, get: document.getElementById };
}

const TRACE = { id: '1', at: '2026-11-06T10:00:00.000Z', question: 'how is it built?', route: 'model', outcome: 'done', tool: null, msTotal: 4200, msEmbed: 40, msModel: 4100 };

{
  const { ctx, get } = load();
  ctx.renderSummary({ total: 1200, outcomes: [{ outcome: 'rejected', count: 3 }, { outcome: 'surprise', count: 1 }], medianMs: 4200, worstMs: 21000, cacheRate: 0.25, fallBackRate: 0, refusalRate: 0.5 });
  assert.strictEqual(get('chatMedian').textContent, '4.2 s');
  assert.strictEqual(get('chatWorst').textContent, '21.0 s');
  assert.strictEqual(get('chatCache').textContent, '25%');
  assert.strictEqual(get('chatFallBack').textContent, '0%', 'a measured nought is a nought');
  assert.strictEqual(get('chatRefusal').textContent, '50%');
  assert.strictEqual(get('chatTotal').attrs['data-loading'], undefined);
  const rows = get('chatOutcomes').children.map((r) => r.children.map((c) => c.textContent));
  assert.strictEqual(rows[0][0], 'Answer rejected');
  assert.strictEqual(rows[1][0], 'surprise', 'an outcome this page does not know still shows');
  ok('summary: figures, outcome names and an unknown outcome');
}

{
  const { ctx, get } = load();
  ctx.renderSummary({ total: 0, outcomes: [], medianMs: null, worstMs: null, cacheRate: null, fallBackRate: null, refusalRate: null });
  for (const id of ['chatMedian', 'chatWorst', 'chatCache', 'chatFallBack', 'chatRefusal']) assert.strictEqual(get(id).textContent, '—', id);
  assert.match(get('chatOutcomes').textContent, /No questions/);
  ctx.renderTraces([]);
  assert.match(get('chatTraces').textContent, /No traces yet/);
  assert.strictEqual(get('chatTraces').children[0].children[0].attrs.colspan, '8', 'the row spans the eight columns');
  ok('an empty week is dashes and words, never noughts');
}

{
  const { ctx, get } = load();
  const evil = '<img src=x onerror=alert(1)>';
  ctx.renderTraces([{ ...TRACE, question: evil, tool: 'weather', outcome: 'tool', msEmbed: null }, { ...TRACE, question: null, route: null }]);
  const [first, second] = get('chatTraces').children;
  assert.strictEqual(first.children.length, 8, 'one cell per column');
  assert.strictEqual(first.children[1].textContent, evil, 'the question arrives as text');
  assert.strictEqual(first.children[1].children.length, 0, 'and builds no element');
  assert.strictEqual(first.children[3].textContent, 'Live tool');
  assert.strictEqual(first.children[4].textContent, 'weather');
  assert.deepStrictEqual(first.children.slice(5).map((c) => c.textContent), ['4.2 s', '—', '4.1 s']);
  assert.strictEqual(second.children[1].textContent, 'Not kept');
  assert.strictEqual(second.children[2].textContent, '—');
  ok('traces: a question is text, a memory-off question says so, a missing time is a dash');
}

assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')), 'admin-chat.js has no HTML sink');
ok('no HTML sink anywhere in the script');
console.log(`\nadmin-chat: all checks passed - ${passed} groups`);
