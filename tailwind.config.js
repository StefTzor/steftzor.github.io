/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // Enable dark mode with class strategy
  content: [
    "./pages/**/*.{html,njk}",
    "./_includes/**/*.html"
  ], // Include your HTML and JS files
  theme: {
    extend: {},
  },
  variants: {
    extend: {
      textColor: ['hover', 'dark:hover'],
    },
  },
  plugins: [],
};