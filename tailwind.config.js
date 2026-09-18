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
          // The one border colour. It replaced ~80 hand-picked `border-brand-muted/10|15|20`
          // hairlines, which worked in dark mode - muted is light there, so a 10% wash reads as
          // a lighter edge - and disappeared in light mode, where muted is dark and the same
          // wash is a smudge. One token per theme is the whole elevation system.
          border: 'rgb(var(--color-border) / <alpha-value>)',
          // The /f1/ map key's swatches, so the legend and the dots it describes cannot drift:
          // both sides read the same two custom properties. See src/input.css for the measured
          // separations and why `past` is not simply `muted`.
          'map-past': 'rgb(var(--color-map-past) / <alpha-value>)',
          'map-now': 'rgb(var(--color-map-now) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};