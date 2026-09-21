const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * `scripts/firebase-config.js` is deliberately NOT versioned.
 *
 * It exists only in the app build now - the public site carries no Firebase at all. The
 * committed copy holds only {{PLACEHOLDER}} values; the container build overwrites it with the
 * real config *after* Eleventy runs. Hashing it here would therefore hash the placeholders and
 * produce a version that never changes, which is worse than no version at all - it would look
 * busted while being permanently stale.
 *
 * Versioning it at build time instead would only half-work: shell.js, auth.js, action.js and
 * private.js all reach it through `import "./firebase-config.js"`, and a query string on the
 * <script> tag does not reach that import. So one of the two fetch paths would stay unversioned
 * either way.
 */
const UNVERSIONED = new Set(["/scripts/firebase-config.js"]);
const versionCache = new Map();
function assetVersion(urlPath) {
  if (versionCache.has(urlPath)) return versionCache.get(urlPath);
  let v;
  try {
    v = crypto.createHash("sha1")
      .update(fs.readFileSync(path.join(__dirname, urlPath)))
      .digest("hex")
      .slice(0, 8);
  } catch (err) {
    // Asset missing at build time: skip rather than invent a version.
    v = null;
  }
  versionCache.set(urlPath, v);
  return v;
}

/**
 * Everything the public site and the signed-in app build the same way.
 *
 * There are two Eleventy configs - `.eleventy.js` for tzortzoglou.eu and `eleventy.app.js` for
 * app.tzortzoglou.eu - and the parts that must never disagree live here: the cache-busting and
 * CSP transforms, the icon shortcode, and the assets both sites serve. A second copy of the CSP
 * transform would rot the first time one of them was edited, and the symptom would be a console
 * error on a page nobody had open.
 *
 * @param {object} eleventyConfig
 * @param {{cspOverrides?: object}} opts  directives to replace in the generated policy
 */
module.exports = function (eleventyConfig, { cspOverrides = {} } = {}) {
  // Copy the dist folder (Tailwind output) to the final site
  eleventyConfig.addPassthroughCopy("dist");
  eleventyConfig.addPassthroughCopy("images");
  // Self-hosted webfonts; scripts/ and fonts/ are not copied wholesale elsewhere.
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy({"favicon": "/"});
  // Build date for sitemap <lastmod> (YYYY-MM-DD)
  eleventyConfig.addGlobalData("buildDate", () => new Date().toISOString().split("T")[0]);
  // Full ISO 8601 datetime for JSON-LD dateModified (Google ProfilePage requires a datetime, not a date)
  eleventyConfig.addGlobalData("buildDateTime", () => new Date().toISOString());


  /**
   * Inlines one of the SVGs in _includes/icons. These replaced the devicon webfont, which
   * cost 777 KB of TTF from a CDN to draw nine logos - the heaviest asset on the site by a
   * wide margin. Inlined they are about 11 KB, need no request, and cannot fail to load.
   * fill="currentColor" keeps them tinted by the surrounding text colour, as the font was.
   */
  eleventyConfig.addShortcode("icon", (name, cls = "") => {
    const file = path.join(__dirname, "_includes", "icons", `${name}.svg`);
    return fs.readFileSync(file, "utf8")
      .replace("<svg", `<svg class="${cls}" aria-hidden="true" focusable="false"`);
  });

  /**
   * Stamps a schema.org node with the URL of the page carrying it. mainEntityOfPage used to be
   * pasted into four pages by hand, so three of them claimed to be /about/. A filter rather than
   * a function in _data, because data functions do not survive an incremental rebuild.
   */
  eleventyConfig.addFilter("forPage", (node, url) => ({
    ...node,
    mainEntityOfPage: `https://tzortzoglou.eu${url}`,
  }));

  /**
   * JSON for embedding inside a <script> element, which is not the same thing as JSON.
   *
   * `dump` is `JSON.stringify`, and it escapes quotes and backslashes but not `<`. Inside a
   * `<script>` the HTML parser is still looking for `</script`, so a string containing that
   * sequence closes the element early and everything after it parses as markup. `| safe` is
   * mandatory at these call sites (without it the JSON is HTML-escaped, and a browser does not
   * HTML-decode inside `<script>`, so the block breaks either way), which means autoescape
   * cannot be the thing that saves us. This filter is.
   *
   * `\u003c` is valid JSON and parses back to `<`, so a consumer reads exactly what was meant.
   * U+2028 and U+2029 are escaped for the one call site that is a real script rather than
   * `application/ld+json` (`redirect.njk`): they are literal line terminators in a JS string
   * before ES2019 and would break the statement.
   *
   * This replaces guardrail 12's "nothing in _data/schema.js may contain `</script`", which
   * asked a human to remember something a function can enforce.
   *
   * One behaviour change worth knowing: this throws on `undefined`, where `dump` emitted the
   * bare token `undefined` into the JSON. A page missing a `title` or `description` now fails
   * the build instead of shipping a block that does not parse. Louder is correct here.
   */
  eleventyConfig.addFilter("jsonInScript", (value) => JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029"));

  /**
   * Cache-busting. Rewrites every /dist and /scripts URL in the built HTML to carry a
   * ?v= content hash, so a deploy cannot leave a visitor running last week's auth.js,
   * consent.js or stylesheet. Done as a transform rather than per-template so nothing
   * has to be remembered when a page or a script is added.
   */
  eleventyConfig.addTransform("cachebust", function (content) {
    if (!this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;
    return content.replace(
      /(href|src)="(\/(?:dist|scripts)\/[^"?#]+\.(?:css|js))"/g,
      (match, attr, urlPath) => {
        if (UNVERSIONED.has(urlPath)) return match;
        const v = assetVersion(urlPath);
        return v ? `${attr}="${urlPath}?v=${v}"` : match;
      }
    );
  });


  /**
   * Content-Security-Policy.
   *
   * GitHub Pages cannot set response headers, so the policy ships as a <meta>. That costs
   * frame-ancestors, report-uri and sandbox, which are header-only - clickjacking stays
   * covered by nothing, and is the one thing this cannot do.
   *
   * The hashes are computed from the built output rather than written into the layout by
   * hand. A hand-kept hash rots the moment anyone edits the theme script or the calendar
   * CSS, and the only symptom is a console error on the live site: the build stays green.
   * Third-party origins are read off the page's own <script src> and <img src>, so a page
   * that stops loading something stops allowing it in the same commit. External stylesheets
   * are deliberately not picked up that way: there are none left, and re-introducing one
   * should fail the build (scripts/csp.test.js) rather than quietly widen the policy.
   */
  const CHARSET = '<meta charset="UTF-8">';
  const sha256 = (s) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;
  const originsIn = (html, re) =>
    [...new Set([...html.matchAll(re)].map((m) => new URL(m[1]).origin))];

  eleventyConfig.addTransform("csp", function (content) {
    if (!this.page.outputPath || !this.page.outputPath.endsWith(".html")) return content;

    // Only executable scripts are matched against script-src. A <script type="application/ld+json">
    // is a data block - the HTML parser returns before the CSP check - so the schema needs no hash.
    const scriptHashes = [...content.matchAll(/<script((?![^>]*\ssrc=)[^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attrs]) => !/ld\+json/.test(attrs))
      .map(([, , body]) => sha256(body));
    const styleHashes = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => sha256(m[1]));

    const policy = {
      "default-src": ["'self'"],
      // Nothing third-party by default: the page counter is a beacon to my own API rather
      // than a script somebody else serves, so script-src never has to widen for it. No
      // gstatic either - the public site loads no Firebase. The app needs both the SDK and
      // the identity endpoints, and says so in its own cspOverrides.
      "script-src": ["'self'"],
      // style-src-elem and -attr are what current browsers honour; the plain style-src is the
      // fallback for those that do not know them. The attribute source has to stay
      // 'unsafe-inline': the inlined Font Awesome icons carry style="display:inline-block"
      // to survive Preflight's svg{display:block}, and no hash can cover a style attribute.
      "style-src": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'"],
      "style-src-attr": ["'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      // The contact form and the page-view beacon, both of which talk to the same API.
      "connect-src": ["'self'", "https://api.tzortzoglou.eu"],
      "form-action": ["'self'"],
      "frame-src": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
    };

    // Lets the app widen or narrow a directive without a second copy of this transform.
    // Only the hand-written sources are overridable: the hashes and the origins below are
    // derived from the page itself, and an override that dropped them would silently block
    // the page's own scripts - which is exactly what the first version of this did.
    Object.assign(policy, cspOverrides);

    policy["script-src"] = [...policy["script-src"],
      ...originsIn(content, /<script[^>]*\ssrc="(https:\/\/[^"]+)"/g), ...scriptHashes];
    policy["style-src-elem"] = [...policy["style-src-elem"], ...styleHashes];
    policy["img-src"] = [...policy["img-src"],
      ...originsIn(content, /<img[^>]*\ssrc="(https:\/\/[^"]+)"/g)];

    const meta = `<meta http-equiv="Content-Security-Policy" content="${Object.entries(policy)
      .map(([name, sources]) => `${name} ${sources.join(" ")}`)
      .join("; ")}">`;
    return content.replace(CHARSET, () => `${CHARSET}\n  ${meta}`);
  });

};
