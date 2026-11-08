'use strict';
/**
 * Fail a PR whose built pages drop a sentence the chat quotes. The API serves its quotes at
 * GET /chat/quotes; each must still be in the page it cites, in _site, or in _app for /docs/.
 * The same check runs on the API's deploy against the live pages, where a miss stops the deploy.
 *   node scripts/check-chat-quotes.js [siteDir] [appDir]
 * The API unreachable is a warning, not a failure: the check cannot run, nothing is known to be wrong.
 */
const fs = require('fs');
const path = require('path');

const URL_ = process.env.CHAT_QUOTES_URL || 'https://api.tzortzoglou.eu/chat/quotes';
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// As the API's scripts/check-facts.js reads a page, so both agree on what "found" means.
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] || m);
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const pageText = (raw) => squash(decode(raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))).replace(/ ([.,;:!?)])/g, '$1');
const found = (quote, text) => text.includes(squash(quote).replace(/ ([.,;:!?)])/g, '$1'));
const inApp = (q) => q.app === true || q.source.startsWith('/docs/');

// The problems, one line each: a page that is gone, or a quote that is no longer on it.
function check(quotes, siteDir, appDir) {
  const pages = new Map();
  const bad = [];
  for (const q of quotes) {
    const file = path.join(inApp(q) ? appDir : siteDir, q.source, 'index.html');
    if (!pages.has(file)) pages.set(file, fs.existsSync(file) ? pageText(fs.readFileSync(file, 'utf8')) : null);
    const text = pages.get(file);
    if (text === null) bad.push(`${q.source}: the page is gone, and the chat quotes it`);
    else if (!found(q.quote, text)) bad.push(`${q.source}: the chat quotes "${q.quote}", which is no longer on the page`);
  }
  return [...new Set(bad)];
}

async function main([siteDir = '_site', appDir = '_app'] = []) {
  let quotes;
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quotes = await res.json();
  } catch (e) {
    console.warn(`::warning::chat quotes not checked: ${URL_} gave ${e.message}`);
    return 0;
  }
  const bad = check(quotes, siteDir, appDir);
  for (const b of bad) console.error(`::error::${b}`);
  if (bad.length) {
    console.error('Change the page back, or update the chat\'s quote in tzortzoglou-api (src/chat/facts.json or src/chat/library) first.');
    return 1;
  }
  console.log(`chat quotes ok: ${quotes.length} found in the build`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
module.exports = { check, pageText };
