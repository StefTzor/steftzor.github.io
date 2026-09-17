/**
 * Shared front matter for every page in the Admin area.
 *
 * The three pages differ only in their title, their script and their content; everything that
 * makes them app pages was identical in all three, which is how the same five keys came to be
 * copied around four files before this directory existed.
 *
 * `layout` is safe to set here, unlike in app/pages/pages.11tydata.js: nothing in this
 * directory emits anything but HTML.
 *
 * The drawer's list on narrow screens is app/pages/_data/appNav.js, shared with every other
 * page. It keeps ONE Admin entry - the sections themselves are reached from the row that admin
 * pages render under their heading, because a drawer listing "Home, Transit, Formula 1, Admin,
 * Accounts, Messages, Invites" as one flat column says nothing about which live inside which.
 */
module.exports = {
  layout: "app-shell.njk",
  shell: true,
  signOut: true,
  navDrawerOnly: true,
  bodyClass: "bg-brand-bg text-brand-text antialiased min-h-screen flex flex-col",
};
