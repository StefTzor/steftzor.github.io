module.exports = function(eleventyConfig) {
  // Copy the dist folder (Tailwind output) to the final site
  eleventyConfig.addPassthroughCopy("dist");

  // Add a global baseUrl variable to handle GitHub Pages URLs
  eleventyConfig.addGlobalData("baseUrl", process.env.GITHUB_URL || "/");

  return {
    dir: {
      input: "pages",          // Source directory for pages
      includes: "../_includes", // Folder for partials like headers/footers
      output: "_site",         // Build output folder (for GitHub Pages)
    },
  };
};
