const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * `scripts/firebase-config.js` is deliberately NOT versioned.
 *
 * The committed copy holds only {{PLACEHOLDER}} values; CI overwrites it with the real
 * config from GitHub Secrets *after* the build. Hashing it here would therefore hash the
 * placeholders and produce a version that never changes, which is worse than no version
 * at all - it would look busted while being permanently stale.
 *
 * Versioning it on build time instead would only half-work: auth.js and exclusive.js
 * reach it through `import "./firebase-config.js"`, and a query string on the <script>
 * tag does not reach that import. So one of the two fetch paths would stay unversioned
 * either way. GitHub Pages serves it with max-age=600, which bounds the staleness to ten
 * minutes - acceptable for a file that only changes when Firebase secrets are rotated.
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

module.exports = function(eleventyConfig) {
  // Copy the dist folder (Tailwind output) to the final site
  eleventyConfig.addPassthroughCopy("dist");
  // Copy auth.js and main.js, but NOT firebase-config.js
  eleventyConfig.addPassthroughCopy({
    "scripts/auth.js": "scripts/auth.js",
    "scripts/main.js": "scripts/main.js",
    "scripts/hero.js": "scripts/hero.js",
    "scripts/consent.js": "scripts/consent.js",
    "scripts/exclusive.js": "scripts/exclusive.js",
    "scripts/contact.js": "scripts/contact.js",
    "scripts/auth-boot.js": "scripts/auth-boot.js"
  });
  eleventyConfig.addPassthroughCopy("images");
  // Self-hosted webfonts; scripts/ and fonts/ are not copied wholesale elsewhere.
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy({"favicon": "/"});
  eleventyConfig.addPassthroughCopy({ "CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy("robots.txt");
  // IndexNow ownership key file (served at site root)
  eleventyConfig.addPassthroughCopy("4fd3d9a15a8ed562e65c15e73e6682df.txt");

  // Build date for sitemap <lastmod> (YYYY-MM-DD)
  eleventyConfig.addGlobalData("buildDate", () => new Date().toISOString().split("T")[0]);
  // Full ISO 8601 datetime for JSON-LD dateModified (Google ProfilePage requires a datetime, not a date)
  eleventyConfig.addGlobalData("buildDateTime", () => new Date().toISOString());

   // Prevent firebase-config.js from being copied
   eleventyConfig.ignores.add("scripts/firebase-config.js");


  /**
   * Every page that should be in the sitemap and pinged to IndexNow.
   *
   * Those two lists used to be hand-maintained in pages/sitemap.njk and in the urlList in
   * deploy.yml, and the SEO reference names them as the most common regression here: update one,
   * forget the other. They now come from this collection, so adding a page registers it in both
   * or in neither.
   *
   * A page is indexable unless it says otherwise - noindex front matter, or no output at all
   * (the permalink: false stubs). That way a new page is included by default rather than
   * forgotten, and opting out is explicit.
   */
  eleventyConfig.addCollection("indexable", (api) =>
    api
      .getAll()
      .filter(
        (p) =>
          p.outputPath &&
          String(p.outputPath).endsWith(".html") &&
          p.url &&
          !p.data.noindex
      )
      .sort((a, b) => (a.data.sitemapOrder ?? 50) - (b.data.sitemapOrder ?? 50))
  );

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
      // gstatic serves the Firebase SDK modules that scripts/auth.js imports; gc.zgo.at is
      // GoatCounter, injected by consent.js after consent, so no hash can ever cover it.
      "script-src": ["'self'", "https://www.gstatic.com", "https://gc.zgo.at",
        ...originsIn(content, /<script[^>]*\ssrc="(https:\/\/[^"]+)"/g), ...scriptHashes],
      // style-src-elem and -attr are what current browsers honour; the plain style-src is the
      // fallback for those that do not know them. The attribute source has to stay
      // 'unsafe-inline': the inlined Font Awesome icons carry style="display:inline-block"
      // to survive Preflight's svg{display:block}, and no hash can cover a style attribute.
      "style-src": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'", ...styleHashes],
      "style-src-attr": ["'unsafe-inline'"],
      "img-src": ["'self'", "data:", ...originsIn(content, /<img[^>]*\ssrc="(https:\/\/[^"]+)"/g)],
      "font-src": ["'self'"],
      // Firebase Auth and Firestore, the contact form and the auth gate, and GoatCounter's beacon.
      "connect-src": ["'self'", "https://api.tzortzoglou.eu", "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com", "https://firestore.googleapis.com",
        "https://steftzor.goatcounter.com"],
      "form-action": ["'self'"],
      "frame-src": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
    };

    const meta = `<meta http-equiv="Content-Security-Policy" content="${Object.entries(policy)
      .map(([name, sources]) => `${name} ${sources.join(" ")}`)
      .join("; ")}">`;
    return content.replace(CHARSET, () => `${CHARSET}\n  ${meta}`);
  });

  return {
    dir: {
      input: "pages",          // Source directory for pages
      includes: "_includes", // Folder for partials like headers/footers
      layouts: "../_includes", // Layouts live at the project root, not under pages/
      data: "../_data",        // Same again: dir.data is resolved relative to dir.input
      output: "_site",         // Build output folder (for GitHub Pages)
    },
    pathPrefix: "/", // Important: Set pathPrefix to `/` for GitHub Pages root deployment
  };
};