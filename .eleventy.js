module.exports = function(eleventyConfig) {
  // Copy the dist folder (Tailwind output) to the final site
  eleventyConfig.addPassthroughCopy("dist");
  eleventyConfig.addPassthroughCopy("scripts");
  eleventyConfig.addPassthroughCopy("images");

  return {
    dir: {
      input: "pages",          // Source directory for pages
      includes: "_includes", // Folder for partials like headers/footers
      output: "_site",         // Build output folder (for GitHub Pages)
    },
    pathPrefix: "/", // Important: Set pathPrefix to `/` for GitHub Pages root deployment
  };
};