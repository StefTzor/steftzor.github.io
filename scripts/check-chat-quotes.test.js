/**
 * Self-check for check-chat-quotes.js: a quote on its page passes, a reworded one and a gone page fail,
 * and /docs/ is read from the app build.  node scripts/check-chat-quotes.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check } = require('./check-chat-quotes');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quotes-'));
const page = (dir, p, html) => { fs.mkdirSync(path.join(root, dir, p), { recursive: true }); fs.writeFileSync(path.join(root, dir, p, 'index.html'), html); };
page('site', '/about/', '<p>He works at <b>Data Talks</b> .</p><script>var x="Stockholm"</script>');
page('app', '/docs/', '<p>If nothing matches, the chat gives the fixed reply &amp; stops.</p>');
const run = (quotes) => check(quotes, path.join(root, 'site'), path.join(root, 'app'));

assert.deepStrictEqual(run([{ source: '/about/', quote: 'He works at Data Talks.' }, { source: '/docs/', quote: 'the fixed reply & stops' }]), []);
assert.strictEqual(run([{ source: '/docs/', quote: 'the chat says it does not know' }]).length, 1, 'a reworded sentence fails');
assert.strictEqual(run([{ source: '/gone/', quote: 'x' }, { source: '/gone/', quote: 'y' }]).length, 1, 'a gone page fails, once');
assert.strictEqual(run([{ source: '/about/', quote: 'Stockholm' }]).length, 1, 'script text is not page text');
assert.strictEqual(run([{ source: '/about/', quote: 'He works at Data Talks.', app: true }]).length, 1, 'app: true reads the app build');
fs.rmSync(root, { recursive: true });
console.log('check-chat-quotes: all passed');
