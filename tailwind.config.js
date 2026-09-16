/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{html,njk}",
    "./_includes/**/*.{html,njk}",
    "./scripts/**/*.js",
    // The app builds from the same config and the same input.css, so brand tokens cannot
    // drift between the two sites - there is only ever one definition of each.
    "./app/**/*.{html,njk,js}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: 'rgb(var(--color-bg) / <alpha-value>)',
          surface: 'rgb(var(--color-surface) / <alpha-value>)',
          text: 'rgb(var(--color-text) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
          accent: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-hover) / <alpha-value>)',
          onaccent: 'rgb(var(--color-onaccent) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};