/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // Enable dark mode with class strategy
  content: [
    "./pages/**/*.{html,njk}",
    "./_includes/**/*.html",
    "./scripts/**/*.js"
  ], // Include your HTML and JS files
  theme: {
    extend: {
      colors: {
        background: "#0F172A", // Dark Navy
        primary: "#22D3EE",    // Neon Cyan
        secondary: "#64748B",  // Cool Gray
        accent: "#F4F4F4",     // Light Gray
      },
    },
  },
  variants: {
    extend: {
      textColor: ['hover', 'dark:hover'],
    },
  },
  plugins: [],
};