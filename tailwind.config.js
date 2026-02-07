/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{html,njk}",
    "./_includes/**/*.html",
    "./scripts/**/*.js"
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
        },
      },
    },
  },
  plugins: [],
};