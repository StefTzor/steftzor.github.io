module.exports = function(eleventyConfig) {
    // Copy Tailwind output folder to the final site
    eleventyConfig.addPassthroughCopy("dist");
  
    return {
      dir: {
        input: "pages",         // Source directory for pages
        includes: "../_includes", // Folder for partials like headers/footers
        output: "_site",         // Build output folder (for GitHub Pages)
      },
    };
  };
  