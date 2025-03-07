module.exports = function(eleventyConfig) {
  // Copy the dist folder (Tailwind output) to the final site
  eleventyConfig.addPassthroughCopy("dist");
  // Copy auth.js and main.js, but NOT firebase-config.js
  eleventyConfig.addPassthroughCopy({
    "scripts/auth.js": "scripts/auth.js",
    "scripts/main.js": "scripts/main.js",
  });
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy({"favicon": "/"});

   // Prevent firebase-config.js from being copied
   eleventyConfig.ignores.add("scripts/firebase-config.js");


  return {
    dir: {
      input: "pages",          // Source directory for pages
      includes: "_includes", // Folder for partials like headers/footers
      output: "_site",         // Build output folder (for GitHub Pages)
    },
    pathPrefix: "/", // Important: Set pathPrefix to `/` for GitHub Pages root deployment
  };
};