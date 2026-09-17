/**
 * Shared front matter for every page of app.tzortzoglou.eu.
 *
 * These four keys were repeated verbatim in all seven page files, which is how the label came to
 * be written out seven times and would have had to be corrected in seven places when the arrow
 * moved from the text into an icon.
 *
 * What stays per-page is what genuinely differs: navItems, navDrawerOnly and signOut, which
 * separate the signed-in pages from the auth pages.
 *
 * Deliberately no `layout` key, for the same reason as the site's copy of this file: build.njk
 * emits plain text and a default layout would wrap it in a document.
 */
module.exports = {
  // Everything in the footer, and the wordmark, live on the public site; from here they need
  // absolute URLs. The site's own copy of this leaves siteBase empty so its links stay local.
  siteBase: "https://tzortzoglou.eu",
  brandHref: "https://tzortzoglou.eu/",
  crossLink: { label: "tzortzoglou.eu", href: "https://tzortzoglou.eu/" },
  crossBack: true,
};
