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
    "scripts/contact.js": "scripts/contact.js"
  });
  eleventyConfig.addPassthroughCopy("images");
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

  return {
    dir: {
      input: "pages",          // Source directory for pages
      includes: "_includes", // Folder for partials like headers/footers
      layouts: "../_includes", // Layouts live at the project root, not under pages/
      output: "_site",         // Build output folder (for GitHub Pages)
    },
    pathPrefix: "/", // Important: Set pathPrefix to `/` for GitHub Pages root deployment
  };
};