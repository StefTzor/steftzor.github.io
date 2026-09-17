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
      // Still no third-party analytics host here. The app IS counted now - see
      // app/scripts/hit.js - but it is counted by the API this app already talks to, so nothing
      // behind the login phones out to anywhere it did not already go and connect-src below is
      // unchanged. The rule that kept GoatCounter out was never "do not count"; it was "do not
      // let a page behind a login report to a host that has no other business with it".
      "script-src": ["'self'", "https://www.gstatic.com"],
      // tiles.openfreemap.org is the basemap: the style document, the vector tiles, the glyph
      // ranges and the sprite metadata all come from that one origin, and all of them are fetched
      // rather than loaded as elements. It is the only third party either property talks to, and
      // the only one the browser reaches directly rather than through the API - because tiles are
      // requested one per tile as you pan, and proxying them would mean serving them.
      "connect-src": ["'self'", "https://api.tzortzoglou.eu",
        "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com",
        "https://firestore.googleapis.com", "https://tiles.openfreemap.org"],
      // blob: because the private view fetches its photos over an authenticated request and
      // renders them from createObjectURL - a blob: URL is not covered by 'self', so without
      // this the images are blocked and the page looks broken for the one person it is for.
      // The basemap host serves the sprite sheet and a shaded-relief raster layer as images.
      "img-src": ["'self'", "data:", "blob:", "https://tiles.openfreemap.org"],
      // MapLibre renders in a Worker, and there was no worker-src directive at all before this -
      // which means workers fell back to default-src 'self' and the blob: path was blocked.
      // 'self' covers the module worker it loads as a sibling of /vendor/maplibre-gl.mjs; blob:
      // covers the fallback it constructs when that URL is not usable. Both, because which one
      // runs is the library's decision and not ours.
      "worker-src": ["'self'", "blob:"],
    },
  });

  // MapLibre, self-hosted, exactly as the fonts and the icons are. A CDN would put a third party
  // in script-src on every page that draws a map, and this repo spent a whole pass removing the
  // last of those. Copied as a directory because the four files must stay siblings: the library
  // resolves its worker as `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, so renaming or
  // flattening any of them breaks it at runtime and not at build time.
  eleventyConfig.addPassthroughCopy("vendor");

  eleventyConfig.addPassthroughCopy({
    "app/scripts/auth.js": "scripts/auth.js",
    "app/scripts/action.js": "scripts/action.js",
    "app/scripts/signed-out.js": "scripts/signed-out.js",
    "app/scripts/profile.js": "scripts/profile.js",
    "app/scripts/contact-widget.js": "scripts/contact-widget.js",
    "app/scripts/palette.js": "scripts/palette.js",
    "app/scripts/departures.js": "scripts/departures.js",
    "app/scripts/transit.js": "scripts/transit.js",
    "app/scripts/stop-format.js": "scripts/stop-format.js",
    "app/scripts/rows.js": "scripts/rows.js",
    "app/scripts/f1.js": "scripts/f1.js",
    "app/scripts/f1-page.js": "scripts/f1-page.js",
    "app/scripts/f1-teams.js": "scripts/f1-teams.js",
    "scripts/chrome.js": "scripts/chrome.js",
    "app/scripts/shell.js": "scripts/shell.js",
    "app/scripts/api-base.js": "scripts/api-base.js",
    "app/scripts/hit.js": "scripts/hit.js",
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
    "app/scripts/admin-data.js": "scripts/admin-data.js",
    "app/scripts/admin-erasure.js": "scripts/admin-erasure.js",
    "app/scripts/map.js": "scripts/map.js",
    "app/scripts/docs.js": "scripts/docs.js",
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
