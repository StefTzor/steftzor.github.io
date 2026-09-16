/**
 * The signed-in app at app.tzortzoglou.eu.
 *
 * A second Eleventy config rather than more pages in the first one, because the two sites are
 * deployed to different places by different pipelines: tzortzoglou.eu is static on GitHub Pages,
 * this is a container on the VPS. Everything they must agree about - cache-busting, the CSP
 * transform, the icon shortcode, the fonts and the stylesheet - comes from eleventy.common.js,
 * so there is exactly one copy of each.
 *
 * The auth pages live HERE and not on the public site. Browser auth state is per-origin, so a
 * login at tzortzoglou.eu would not be a login at app.tzortzoglou.eu; splitting them across two
 * origins breaks sign-in rather than merely being untidy.
 *
 *   npm run build:app   ->  _app/
 */
const shared = require("./eleventy.common");

module.exports = function (eleventyConfig) {
  shared(eleventyConfig, {
    cspOverrides: {
      // No GoatCounter here: the app is not analytics territory, and nothing behind a login
      // should be able to phone out to a host that only the marketing site has a reason to use.
      "script-src": ["'self'", "https://www.gstatic.com"],
      "connect-src": ["'self'", "https://api.tzortzoglou.eu",
        "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com",
        "https://firestore.googleapis.com"],
      // blob: because the private view fetches its photos over an authenticated request and
      // renders them from createObjectURL - a blob: URL is not covered by 'self', so without
      // this the images are blocked and the page looks broken for the one person it is for.
      "img-src": ["'self'", "data:", "blob:"],
    },
  });

  eleventyConfig.addPassthroughCopy({
    "app/scripts/auth.js": "scripts/auth.js",
    "app/scripts/action.js": "scripts/action.js",
    "app/scripts/shell.js": "scripts/shell.js",
    "app/scripts/app.js": "scripts/app.js",
    "app/scripts/private.js": "scripts/private.js",
    "app/scripts/admin.js": "scripts/admin.js",
  });

  // Same reason as the public site: CI writes the real config after the build.
  eleventyConfig.ignores.add("app/scripts/firebase-config.js");

  return {
    dir: {
      input: "app/pages",
      // Both resolve relative to dir.input, so both need to climb out of it. Getting this
      // wrong fails silently - the layout is simply never found and the page renders bare.
      includes: "../_includes",
      layouts: "../_includes",
      output: "_app",
    },
    pathPrefix: "/",
  };
};
