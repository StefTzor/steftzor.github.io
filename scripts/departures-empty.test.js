'use strict';

/**
 * app/scripts/departures.js render() without a browser: an empty first board keeps the card on
 * screen at the height it was holding. Removing it moved everything below after first paint,
 * which is what failed the smoke run every night.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app/scripts/departures.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^profile\.then[\s\S]*$/m, '');

const node = (extra) => Object.assign({
  textContent: '', children: [], style: {}, dataset: {}, attrs: {},
  removeAttribute(k) { delete this.attrs[k]; },
  appendChild(c) { this.children.push(c); },
}, extra);

const nodes = {
  departures: node({ dataset: { card: 'loading' } }),
  depList: node({ offsetHeight: 190, attrs: { 'aria-busy': 'true' } }),
  depNote: node(), depStop: node(), depOperator: node(), depAge: node(),
};
const remembered = {};
const ctx = {
  document: { getElementById: (id) => nodes[id], createElement: () => node() },
  remember: (id, n) => { remembered[id] = n; },
  shortStop: (s) => s, towardsOf: (s) => s, inWords: (m) => `${m} min`,
};
vm.runInNewContext(SRC + '\nrender({ departures: [], stop: "Portalgatan" });', ctx);

assert.strictEqual(nodes.departures.dataset.card, 'ready', 'an empty board keeps the card');
assert.strictEqual(nodes.depList.style.minHeight, '190px', 'the list keeps its reserved height');
assert.strictEqual(nodes.depList.children[0].textContent, 'Nothing leaving in the next hour.');
assert.strictEqual(nodes.depStop.textContent, 'Portalgatan');
assert.strictEqual(remembered.depList, 0, 'the next visit reserves nothing');

console.log('departures-empty: ok');
