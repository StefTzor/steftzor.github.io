/**
 * The sitemap and the IndexNow list must describe the same set of pages.
 * node scripts/urls.test.js   (runs at the end of npm run build)
 *
 * These were two hand-maintained lists and drifted apart; the SEO reference calls that the
 * commonest regression on this site. They come from one Eleventy collection now, and this
 * fails the build if they ever stop agreeing, or if a noindex page reaches either of them.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', '_site');
if (!fs.existsSync(SITE)) {
  console.log('urls: _site not built, skipping');
  process.exit(0);
}

const sitemapXml = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
const indexnow = JSON.parse(fs.readFileSync(path.join(SITE, 'indexnow.json'), 'utf8'));

const sitemapUrls = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]).sort();
const indexnowUrls = [...indexnow.urlList].sort();

assert.ok(sitemapUrls.length > 5, `sitemap looks empty: ${sitemapUrls.length} urls`);
assert.deepStrictEqual(
  sitemapUrls,
  indexnowUrls,
  'sitemap.xml and indexnow.json disagree — they must come from the same collection'
);

// The IndexNow key has to match the verification file actually served at the root, or every
// ping is rejected. That pairing broke once before when the key file was deleted.
const keyFile = `${indexnow.key}.txt`;
assert.ok(
  fs.existsSync(path.join(SITE, keyFile)),
  `IndexNow key file ${keyFile} is not served at the site root`
);
assert.strictEqual(indexnow.keyLocation, `https://tzortzoglou.eu/${keyFile}`);

// Nothing marked noindex may appear in either list.
for (const url of sitemapUrls) {
  const rel = url.replace('https://tzortzoglou.eu', '');
  const file = path.join(SITE, rel === '/' ? 'index.html' : path.join(rel, 'index.html'));
  assert.ok(fs.existsSync(file), `${url} is listed but was not built`);
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(
    !/<meta name="robots"[^>]*noindex/.test(html),
    `${url} is noindex but appears in the sitemap`
  );
  // Bing Webmaster flags descriptions outside 25-160 characters; 8 of 12 pages were over it.
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  assert.ok(desc !== undefined, `${url} has no meta description`);
  const len = desc.replace(/&(#39|quot|amp|lt|gt);/g, '_').length;
  assert.ok(len >= 25 && len <= 160, `${url} meta description is ${len} chars, keep it 25-160`);
  // Bing also flags titles over 70 characters.
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const tlen = title.replace(/&(#39|quot|amp|lt|gt);/g, '_').length;
  assert.ok(tlen > 0 && tlen <= 70, `${url} title is ${tlen} chars, keep it 1-70`);
}

// And every indexable page that was built must be listed - the failure that matters is a new
// page silently missing from both, which is what happened before.
const built = fs
  .readdirSync(SITE, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(SITE, e.name, 'index.html')))
  .map((e) => `https://tzortzoglou.eu/${e.name}/`);
const missing = built.filter((u) => {
  const rel = u.replace('https://tzortzoglou.eu', '');
  const html = fs.readFileSync(path.join(SITE, rel, 'index.html'), 'utf8');
  return !/<meta name="robots"[^>]*noindex/.test(html) && !sitemapUrls.includes(u);
});
assert.deepStrictEqual(missing, [], `built and indexable but absent from the sitemap: ${missing}`);

console.log(`urls: all checks passed — ${sitemapUrls.length} pages, sitemap and IndexNow agree`);
