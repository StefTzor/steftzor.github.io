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
    "app/scripts/signed-out.js": "scripts/signed-out.js",
    "app/scripts/profile.js": "scripts/profile.js",
    "app/scripts/contact-widget.js": "scripts/contact-widget.js",
    "app/scripts/palette.js": "scripts/palette.js",
    "app/scripts/departures.js": "scripts/departures.js",
    "app/scripts/f1.js": "scripts/f1.js",
    "scripts/chrome.js": "scripts/chrome.js",
    "app/scripts/shell.js": "scripts/shell.js",
    "app/scripts/api-base.js": "scripts/api-base.js",
    "app/scripts/forms.js": "scripts/forms.js",
    "app/scripts/email.js": "scripts/email.js",
    "app/scripts/app.js": "scripts/app.js",
    "app/scripts/queues.js": "scripts/queues.js",
    "app/scripts/private.js": "scripts/private.js",
    "app/scripts/admin-status.js": "scripts/admin-status.js",
    "app/scripts/admin-accounts.js": "scripts/admin-accounts.js",
    "app/scripts/admin-account.js": "scripts/admin-account.js",
    "app/scripts/admin-overview.js": "scripts/admin-overview.js",
    "app/scripts/admin-analytics.js": "scripts/admin-analytics.js",
    "app/scripts/admin-health.js": "scripts/admin-health.js",
    "app/scripts/admin-messages.js": "scripts/admin-messages.js",
    "app/scripts/admin-invites.js": "scripts/admin-invites.js",
  });

  // Same reason as the public site: CI writes the real config after the build.
  eleventyConfig.ignores.add("app/scripts/firebase-config.js");

  return {
    dir: {
      input: "app/pages",
      // Both resolve relative to dir.input, so both need to climb out of it - and they climb
      // to the project root, not to app/, because the chrome is shared with the public site and
      // there is one copy of it. Getting this wrong fails silently: the layout is simply never
      // found and the page renders bare.
      includes: "../../_includes",
      layouts: "../../_includes",
      output: "_app",
    },
    pathPrefix: "/",
  };
};
