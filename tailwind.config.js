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
        // Using CSS variables allows for easy switching
        brand: {
          bg: 'var(--color-bg)',
          surface: 'var(--color-surface)',
          text: 'var(--color-text)',
          muted: 'var(--color-muted)',
          accent: 'var(--color-accent)',
          hover: 'var(--color-hover)',
        },
      },
    },
  },
  plugins: [],
};