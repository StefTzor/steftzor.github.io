const shared = require("./eleventy.common");

module.exports = function(eleventyConfig) {
  shared(eleventyConfig);

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
  eleventyConfig.addPassthroughCopy({ "CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy("robots.txt");
  // IndexNow ownership key file (served at site root)
  eleventyConfig.addPassthroughCopy("4fd3d9a15a8ed562e65c15e73e6682df.txt");

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