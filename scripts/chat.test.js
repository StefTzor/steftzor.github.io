'use strict';

/**
 * The chat panel: what it does with a stream, what it shows, and what each build ships.
 *   node scripts/chat.test.js
 *
 * chat.js runs in a vm as the browser runs it, with `export ` and its one import stripped (the
 * technique live-buses.test.js uses). There is no DOM here, so a small fake one stands in, and its
 * innerHTML throws: an answer reaching that setter is the failure this file exists to catch.
 *
 * The build checks run real Eleventy builds into a temporary folder, flag off and flag on, so the
 * result does not depend on what _site last held.
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0;
const ok = (what) => { passed += 1; console.log('  pass  ' + what); };

// --- a DOM just big enough ------------------------------------------------------------------

class FakeEl {
  constructor(tag) { this.tag = tag; this.kids = []; this.className = ''; this.own = ''; this.dataset = {}; this.on = {}; this.attrs = {}; }
  addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.on[type] || []) fn({ type, target: this, preventDefault() {} }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  get children() { return this.kids.filter((k) => typeof k !== 'string'); }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  get classList() { return { toggle() {}, add: (c) => { this.className += ' ' + c; } }; }
  remove() {}
  focus() {}
  get textContent() { return this.own + this.kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join(''); }
  set textContent(v) { this.own = String(v); this.kids = []; }
  set innerHTML(v) { throw new Error('innerHTML was written: ' + v); }
  set outerHTML(v) { throw new Error('outerHTML was written: ' + v); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML was called'); }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.own = ''; this.kids = k; }
  all() { return this.kids.filter((k) => typeof k !== 'string').flatMap((k) => [k, ...k.all()]); }
}

const SRC = read('app/scripts/chat.js').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const NAMES = ['mount', 'createParser', 'readEvents', 'newTurn', 'reduce', 'stateLine', 'sourceView', 'pickSuggestions', 'explainLines', 'turnView', 'turnsFrom', 'LINES'];
const chat = { document: { createElement: (t) => new FakeEl(t) }, TextDecoder, AbortController, window: {}, API_BASE: 'https://api.test' };
vm.runInNewContext(`${SRC}\n${NAMES.map((n) => `this.${n} = ${n};`).join('\n')}`, chat);
const { mount, createParser, readEvents, newTurn, reduce, stateLine, sourceView, pickSuggestions, explainLines, turnView, turnsFrom, LINES } = chat;
const plain = (v) => JSON.parse(JSON.stringify(v));
const play = (turn, events) => events.reduce(reduce, turn);

// --- the stream -----------------------------------------------------------------------------

{
  const seen = [];
  const p = createParser((e) => seen.push(e));
  const wire = 'data: {"type":"sentence","text":"One."}\n\ndata: {"type":"done"}\n\n';
  for (const ch of wire) p(ch);
  assert.deepStrictEqual(plain(seen), [{ type: 'sentence', text: 'One.' }, { type: 'done' }]);
  ok('parser: an event split at every byte arrives whole, once');
}

{
  const seen = [];
  const p = createParser((e) => seen.push(e));
  p('data: {"type":"status"}\n\ndata: {"type":"sen');
  assert.strictEqual(seen.length, 1, 'a half-sent event waits');
  p('tence","text":"x"}\n\n');
  assert.deepStrictEqual(plain(seen).map((e) => e.type), ['status', 'sentence']);
  p(': keep-alive\n\nevent: nope\n\ndata: not json\n\ndata: {"type":"done"}\n\n');
  assert.deepStrictEqual(plain(seen).map((e) => e.type), ['status', 'sentence', 'done']);
  ok('parser: holds a partial event, skips comments, other fields and bad JSON');
}

const body = (chunks) => {
  let i = 0;
  return { body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { done: true }) }) } };
};

async function streamChecks() {
  const bytes = Buffer.from('data: {"type":"sentence","text":"Στέφανος €"}\n\n');
  const at = bytes.indexOf(Buffer.from('€')) + 1; // inside the three bytes of the euro sign
  const seen = [];
  await readEvents(body([bytes.subarray(0, at), bytes.subarray(at)]), (e) => seen.push(e));
  assert.strictEqual(seen[0].text, 'Στέφανος €');
  ok('readEvents: a character split across two chunks survives');
}

// --- the states -----------------------------------------------------------------------------

{
  const t = newTurn('Hi');
  assert.strictEqual(stateLine(t), 'Reading the site...');
  assert.strictEqual(stateLine(reduce(t, { type: 'status' })), 'Reading the site...');
  assert.strictEqual(stateLine(reduce(t, { type: 'queued', position: 2 })), 'Number 2 in the queue.');
  ok('states: reading at once, then the queue position');
}

{
  const t = newTurn('Hi');
  assert.strictEqual(LINES.busy, 'A few people are asking right now. Try again in a minute.');
  assert.strictEqual(LINES.resting, 'The chat is resting. The rest of the site works as normal.');
  assert.strictEqual(LINES.limited, "That's plenty of questions for now.");
  assert.strictEqual(stateLine(reduce(t, { type: 'busy' })), LINES.busy);
  assert.strictEqual(stateLine(reduce(t, { type: 'resting' })), LINES.resting);
  assert.strictEqual(stateLine(reduce(t, { type: 'limited' })), LINES.limited);
  ok('states: busy, resting and 429 read as the agreed plain sentences');
}

{
  const t = play(newTurn('Hi'), [{ type: 'status' }, { type: 'notes', count: 2 }, { type: 'sentence', text: 'One.' },
    { type: 'sentence', text: 'Two.' }, { type: 'sources', sources: ['/about/'] },
    { type: 'conversation', id: 'c1' }, { type: 'done' }]);
  assert.strictEqual(t.phase, 'done');
  assert.deepStrictEqual(plain(t.sentences), ['One.', 'Two.']);
  assert.strictEqual(t.notes, 2);
  assert.strictEqual(t.conversation, 'c1');
  assert.strictEqual(stateLine(t), '');
  ok('states: a whole answer ends done, with no status line left behind');
}

{
  const cut = reduce(reduce(newTurn('Hi'), { type: 'sentence', text: 'Half.' }), { type: 'end' });
  assert.strictEqual(cut.phase, 'resting', 'a stream that ends without done did not finish');
  assert.deepStrictEqual(plain(cut.sentences), ['Half.'], 'what arrived stays on screen');
  const done = play(newTurn('Hi'), [{ type: 'done' }, { type: 'end' }]);
  assert.strictEqual(done.phase, 'done');
  const stopped = play(newTurn('Hi'), [{ type: 'stopped' }, { type: 'sentence', text: 'Late.' }, { type: 'end' }]);
  assert.strictEqual(stopped.phase, 'stopped');
  assert.strictEqual(stopped.sentences.length, 0, 'nothing lands after Stop');
  assert.strictEqual(reduce(newTurn('Hi'), { type: 'whatever' }).phase, 'reading');
  ok('states: a cut stream rests, Stop is final, and unknown events change nothing');
}

// --- sources --------------------------------------------------------------------------------

{
  assert.deepStrictEqual(plain(sourceView('/docs/', false)), { label: 'How this is built', href: null });
  assert.deepStrictEqual(plain(sourceView('/docs/', true)), { label: 'How this is built', href: '/docs/' });
  ok('sources: /docs/ is a label on the public site and a link in the app');
}

{
  assert.strictEqual(sourceView('/about/', false).href, '/about/');
  assert.strictEqual(sourceView('/about/', true).href, 'https://tzortzoglou.eu/about/');
  assert.strictEqual(sourceView('/remember/', false).href, null);
  assert.strictEqual(sourceView('/remember/', true).href, '/remember/');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/', '/admin/', '__proto__', 'constructor', '', null]) {
    assert.strictEqual(sourceView(bad, true), null, `${bad} is not a known source`);
  }
  ok('sources: only known pages become anything at all');
  // The live tools' sources: app pages are links there and labels here; status is on the public site.
  for (const [source, label] of [['/f1/', 'Formula 1'], ['/sports/', 'Sports'], ['/transit/', 'Transit'], ['/', 'Home page'], ['/profile/', 'Your profile']]) {
    assert.deepStrictEqual(plain(sourceView(source, true)), { label, href: source });
    assert.deepStrictEqual(plain(sourceView(source, false)), { label, href: null });
  }
  assert.strictEqual(sourceView('/status/', false).href, '/status/');
  assert.strictEqual(sourceView('/status/', true).href, 'https://tzortzoglou.eu/status/');
  assert.strictEqual(sourceView('/login/', false).href, '/login/');
  assert.strictEqual(sourceView('/login/', true).href, '/login/');
  ok('sources: every live tool source has a label, and a link wherever its page is');
}

// --- rendering ------------------------------------------------------------------------------

{
  const evil = '<img src=x onerror=alert(1)>';
  const view = turnView(evil);
  const turn = play(newTurn(evil), [{ type: 'sentence', text: evil }, { type: 'sentence', text: `<script>x()</script>` },
    { type: 'sources', sources: ['/docs/', evil] }]);
  view.paint(turn, false);
  const text = view.root.textContent;
  assert.ok(text.includes(evil), 'the markup shows as text');
  assert.ok(!view.root.all().some((n) => ['img', 'script'].includes(n.tag)), 'and made no element');
  assert.ok(!view.root.all().some((n) => n.tag === 'a'), 'the public site has no source link for /docs/');
  ok('render: an answer that is markup stays text');
}

{
  const view = turnView('Q');
  let turn = reduce(newTurn('Q'), { type: 'sentence', text: 'One.' });
  view.paint(turn, true);
  const first = view.root.all().find((n) => n.textContent === 'One.');
  turn = reduce(turn, { type: 'sentence', text: 'Two.' });
  view.paint(turn, true);
  assert.ok(view.root.all().includes(first), 'an earlier sentence is not redrawn, or a reader hears it twice');
  turn = play(turn, [{ type: 'notes', count: 1 }, { type: 'sources', sources: ['/docs/'] }, { type: 'done' }]);
  view.paint(turn, true);
  const links = view.root.all().filter((n) => n.tag === 'a');
  assert.deepStrictEqual(links.map((a) => [a.href, a.textContent]),
    [['/remember/', 'Using 1 note'], ['/docs/', 'How this is built']]);
  ok('render: sentences append one at a time; the app links notes and sources');
}

{
  const turns = turnsFrom([{ role: 'user', text: 'Q1' }, { role: 'assistant', text: 'A1' }, { role: 'user', text: 'Q2' }]);
  assert.deepStrictEqual(plain(turns.map((t) => [t.question, t.sentences, t.phase])),
    [['Q1', ['A1'], 'done'], ['Q2', [], 'done']]);
  ok('reopen: stored messages become finished turns');
}

{
  for (const f of ['app/scripts/chat.js', 'app/scripts/remember.js']) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), `${f} builds HTML from a string`);
  }
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(read('app/scripts/chat.js')), 'the panel stores nothing in the browser');
  ok('source: no HTML from strings anywhere, and no browser storage');
}

// --- suggestions ----------------------------------------------------------------------------

{
  const hostile = '<img src=x onerror=alert(1)> & "quotes"';
  const t = play(newTurn('Hi'), [{ type: 'sentence', text: 'A glossary line.' }, { type: 'sources', sources: [] },
    { type: 'suggestions', suggestions: ['One?', hostile, 'Three?', 'Four?'] }, { type: 'done' }]);
  assert.deepStrictEqual(plain(t.suggestions), ['One?', hostile, 'Three?'], 'at most three, kept as sent');
  assert.deepStrictEqual(plain(pickSuggestions(['ok', '', '  ', 5, null, 'x'.repeat(501), { a: 1 }])), ['ok']);
  assert.deepStrictEqual(plain(pickSuggestions('nope')), []);
  assert.deepStrictEqual(plain(reduce(newTurn('Hi'), { type: 'suggestions' }).suggestions), []);
  assert.deepStrictEqual(plain(newTurn('Hi').suggestions), []);
  ok('suggestions: the reducer keeps up to three clean strings and ignores the rest');

  const picked = [];
  const v = turnView('Hi', (q) => picked.push(q));
  v.paint(play(newTurn('Hi'), [{ type: 'suggestions', suggestions: ['A?'] }]), false);
  assert.strictEqual(v.root.all().filter((e) => e.tag === 'button').length, 0, 'none while the answer is still arriving');
  v.paint(t, false);
  const group = v.root.all().find((e) => e.attrs.role === 'group');
  assert.strictEqual(group.attrs['aria-label'], 'Suggested questions');
  const pills = group.all().filter((e) => e.tag === 'button');
  assert.deepStrictEqual(pills.map((b) => b.textContent), ['One?', hostile, 'Three?']);
  assert.ok(pills.every((b) => b.attrs.type === 'button' || b.type === 'button'), 'real buttons, so the keyboard reaches them');
  pills[1].fire('click');
  assert.deepStrictEqual(picked, [hostile], 'a tap sends that text as the question');
  v.paint(t, false);
  assert.strictEqual(group.all().length, 3, 'painting again does not add them twice');
  ok('suggestions: pills appear when the answer is done, hostile text stays text, a tap picks it');

  v.retire();
  assert.ok(!group.attrs.role && !group.attrs['aria-label']);
  assert.strictEqual(group.all().filter((e) => e.tag === 'button').length, 0, 'older answers keep no buttons');
  assert.strictEqual(group.textContent, 'One?' + hostile + 'Three?', 'but the questions stay as text');
  const none = turnView('Hi', () => {});
  none.paint(play(newTurn('Hi'), [{ type: 'sentence', text: 'x' }, { type: 'done' }]), false);
  none.retire();
  assert.strictEqual(none.root.textContent.includes('Suggested'), false);
  ok('suggestions: a newer question turns old pills into plain text');

  const g = turnView('What is X?', () => {});
  g.paint(play(newTurn('What is X?'), [{ type: 'sentence', text: 'X is a term.' }, { type: 'sources', sources: ['/about/'] }, { type: 'done' }]), false);
  assert.ok(g.root.textContent.includes('X is a term.'), 'a glossary or kit answer is plain sentence events and renders as any sentence');
  ok('glossary and kit answers render as ordinary sentences');
}

// --- how this was answered ------------------------------------------------------------------

{
  const model = { type: 'explain', kind: 'model', ms: { total: 7100, embed: 310, model: 6800 }, model: 'gemma-4-E2B-it-Q4_K_M', rejected: 1,
    facts: [{ source: '/docs/', score: 0.812 }, { source: '/docs/', score: 0.79 }, { source: '/docs/' }, { source: '/code/' }] };
  assert.deepStrictEqual(plain(explainLines(model)), ['Found 3 facts on /docs/, best match 0.81', 'Found 1 fact on /code/',
    '1 sentence blocked by the fact check', '6.8 s on the model, Gemma 4 E2B', '7.1 s in all, 0.3 s matching']);
  assert.deepStrictEqual(plain(explainLines({ kind: 'library', entry: 'who', sources: ['/about/'], ms: { total: 40 } })),
    ['Ready answer from /about/', '0.0 s in all']);
  assert.deepStrictEqual(plain(explainLines({ kind: 'owner', sources: ['/about/', '/code/'], ms: { total: 12 } }))[0], 'Fixed lines from /about/, /code/');
  assert.deepStrictEqual(plain(explainLines({ kind: 'cache', sources: ['/docs/'], ms: { total: 3 } }))[0], 'From the cache');
  assert.deepStrictEqual(plain(explainLines({ kind: 'tool', tool: 'weather', ms: { total: 300 } }))[0], 'Live tool: weather');
  assert.deepStrictEqual(plain(explainLines({ kind: 'model', facts: [], rejected: 0, ms: { total: 900, model: 800 } })), ['0.8 s on the model', '0.9 s in all']);
  assert.deepStrictEqual(plain(explainLines({ kind: 'miss', ms: { total: 5 } })), ['Nothing matched, so the fixed reply', '0.0 s in all']);
  assert.deepStrictEqual(plain(explainLines(null)), []);
  assert.deepStrictEqual(plain(explainLines({ kind: 'model', facts: 'x', ms: 'y', tool: 5, model: {} })), []);
  ok('explain: plain lines for each kind, and nothing from malformed fields');

  const ev = { type: 'explain', kind: 'tool', tool: '<img src=x onerror=alert(1)>', ms: { total: 300 } };
  const t = play(newTurn('Hi'), [{ type: 'sentence', text: 'Hot.' }, { type: 'done' }, ev]);
  assert.strictEqual(t.explain.kind, 'tool', 'kept though it comes after done');
  assert.strictEqual(play(newTurn('Hi'), [ev]).explain, null, 'ignored before done');
  assert.strictEqual(play(newTurn('Hi'), [{ type: 'busy' }, ev]).explain, null, 'and after a busy');

  const v = turnView('Hi', () => {});
  v.paint(t, true);
  const box = v.root.all().find((e) => e.tag === 'details');
  assert.ok(box && box.className === 'chat-explain', 'a disclosure in the app');
  assert.strictEqual(box.all().find((e) => e.tag === 'summary').textContent, 'How this was answered');
  assert.ok(box.textContent.includes('Live tool: <img src=x onerror=alert(1)>'), 'hostile text stays text');
  v.paint(t, true);
  assert.strictEqual(v.root.all().filter((e) => e.tag === 'details').length, 1, 'painting again adds none');
  const pub = turnView('Hi', () => {});
  pub.paint(t, false);
  assert.ok(!pub.root.all().some((e) => e.tag === 'details'), 'never on the public panel');
  ok('explain: a quiet disclosure under the answer in the app only, textContent only');
}

// --- the panel itself -----------------------------------------------------------------------

function panelParts() {
  const parts = Object.fromEntries(['chatLog', 'chatForm', 'chatInput', 'chatSend', 'chatCount', 'chatCloseForm'].map((id) => [id, new FakeEl('div')]));
  const panel = new FakeEl('dialog');
  panel.open = true;
  panel.querySelector = (sel) => parts[sel.slice(1)] || null;
  panel.getAnimations = () => [];
  panel.close = () => { panel.open = false; };
  parts.chatInput.value = '';
  return { panel, opener: new FakeEl('button'), ...parts };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

async function panelChecks() {
  // The stream never ends by itself: it holds the model slot until the request is aborted.
  let request = null;
  chat.fetch = async (_url, init) => {
    request = init;
    const read = () => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))));
    return { ok: true, body: { getReader: () => ({ read }) } };
  };
  let p = panelParts();
  mount({ panel: p.panel, opener: p.opener });
  p.chatInput.value = 'Hello';
  p.chatForm.fire('submit');
  await tick();
  assert.ok(request && !request.signal.aborted, 'the answer is running');
  p.panel.fire('cancel'); // Escape
  assert.ok(request.signal.aborted, 'closing the panel gives the model slot back');
  assert.strictEqual(p.chatLog.textContent.includes('Stopped.'), true, 'and the turn says so');
  assert.strictEqual(p.chatInput.readOnly, false, 'the field is usable again');
  ok('panel: closing while answering aborts the request');

  // The same again for the close that skips `cancel`: the browser's own, on a second Escape.
  p = panelParts();
  mount({ panel: p.panel, opener: p.opener });
  p.chatInput.value = 'Hello';
  p.chatForm.fire('submit');
  await tick();
  p.panel.fire('close');
  assert.ok(request.signal.aborted, 'a forced close aborts too');
  ok('panel: a forced close aborts as well');

  p = panelParts();
  let answer;
  const asked = [];
  const app = {
    api: (path, init) => {
      asked.push(path);
      return init ? Promise.reject(new Error('no question may be sent')) : new Promise((r) => { answer = r; });
    },
  };
  mount({ panel: p.panel, opener: p.opener, app });
  p.opener.dataset.conversation = 'c1';
  p.opener.fire('click');
  assert.strictEqual(p.chatInput.readOnly, true, 'the field is read-only while the conversation loads');
  p.chatInput.value = 'Too soon';
  p.chatForm.fire('submit');
  await tick();
  assert.deepStrictEqual(asked, ['/me/chat/conversations/c1'], 'and nothing can be sent into it');
  assert.strictEqual(p.chatInput.value, 'Too soon', 'what was typed is kept');
  answer({ id: 'c1', messages: [{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'A' }] });
  await tick();
  assert.strictEqual(p.chatInput.readOnly, false, 'and it comes back when the conversation is there');
  ok('panel: read-only while a conversation reopens');

  // A tap on a suggestion asks it like typed text, and the next question retires the pills.
  const bodies = [];
  chat.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body).question);
    const first = bodies.length === 1;
    const wire = first
      ? 'data: {"type":"sentence","text":"Hi."}\n\ndata: {"type":"suggestions","suggestions":["Next?"]}\n\ndata: {"type":"done"}\n\n'
      : 'data: {"type":"sentence","text":"Ok."}\n\ndata: {"type":"done"}\n\n';
    return { ok: true, ...body([Buffer.from(wire)]) };
  };
  p = panelParts();
  mount({ panel: p.panel, opener: p.opener });
  p.chatInput.value = 'Start';
  p.chatForm.fire('submit');
  await tick();
  const pill = p.chatLog.all().find((e) => e.tag === 'button' && e.textContent === 'Next?');
  assert.ok(pill, 'the pill is in the log');
  pill.fire('click');
  await tick();
  assert.deepStrictEqual(bodies, ['Start', 'Next?'], 'the tap went the same way as typing');
  assert.strictEqual(p.chatLog.all().filter((e) => e.tag === 'button').length, 0, 'and the old pill is no longer a button');
  ok('panel: a suggestion sends as the next question and the old one goes inactive');
}

// --- what each build ships ------------------------------------------------------------------

function build(flag) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
  const env = { ...process.env };
  delete env.CHAT_PUBLIC;
  if (flag) env.CHAT_PUBLIC = flag;
  const run = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/.bin/eleventy'), `--output=${out}`, '--quiet'],
    { cwd: ROOT, env, encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  return out;
}

function files(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full, ext) : e.name.endsWith(ext) ? [full] : [];
  });
}

{
  const off = build(null);
  const pages = files(off, '.html');
  assert.ok(pages.length > 5, 'the build wrote pages');
  for (const p of pages) assert.ok(!fs.readFileSync(p, 'utf8').includes('chatPanel'), `${p} carries the panel with the flag off`);
  assert.ok(!fs.existsSync(path.join(off, 'scripts/chat.js')), 'chat.js ships only when something can load it');
  fs.rmSync(off, { recursive: true, force: true });
  ok('flag off: no public page has a panel, and chat.js is not published');
}

{
  const on = build('1');
  const pages = files(on, '.html').map((p) => [p, fs.readFileSync(p, 'utf8')]);
  const main = pages.find(([p]) => p === path.join(on, 'index.html'))[1];
  assert.ok(main.includes('id="chatPanel"'), 'flag on: the homepage has the panel');
  assert.ok(/data-chat-src="\/scripts\/chat\.js\?v=[a-f0-9]{8}"/.test(main), 'the lazy script is cache-busted');
  assert.ok(pages.find(([p]) => p.endsWith('privacy/index.html'))[1].includes('id="chatPanel"'), 'legal pages have it too');
  assert.ok(fs.existsSync(path.join(on, 'scripts/api-base.js')), 'chat.js imports this, so it must be published');
  assert.ok(/connect-src[^;]*https:\/\/api\.tzortzoglou\.eu/.test(main), 'the policy allows the API');

  for (const [p, html] of pages) {
    assert.ok(!/gstatic|\/scripts\/shell\.js|\/scripts\/auth\.js|firebase-config/.test(html), `${p} loads sign-in code`);
  }
  for (const f of files(on, '.js')) {
    // Comments may name them (api-base.js explains why it is not in shell.js); code may not.
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.ok(!/gstatic|firebase|shell\.js|getIdToken/i.test(code), `${f} carries sign-in code`);
  }
  fs.rmSync(on, { recursive: true, force: true });
  ok('flag on: the panel is everywhere and no sign-in code ships with it');
}

// The privacy copy says what the 30-day record really is: unlinked, not unfindable.
function copyChecks() {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const privacy = read('pages/privacy.njk').replace(/\s+/g, ' ');
  const docs = read('app/pages/docs.njk').replace(/\s+/g, ' ');
  for (const text of [privacy, docs]) {
    assert.ok(!/can't find|cannot find|nothing can find|has nothing to find/i.test(text), 'no claim that a record cannot be found');
    assert.ok(/isn't linked to an account, so erasure doesn't reach it/.test(text));
  }
  assert.ok(/exact text/.test(privacy), 'and no overclaim: the text itself can be searched');
  assert.ok(/With Memory on, a tool answer is stored in the conversation/.test(privacy));
  assert.ok(!/because nothing is kept for a visitor/.test(read('app/scripts/chat.js')));
  ok('the privacy copy, the docs and the panel comment match what is kept');
}

streamChecks().then(panelChecks).then(copyChecks).then(() => console.log(`chat: all checks passed — ${passed}`));
