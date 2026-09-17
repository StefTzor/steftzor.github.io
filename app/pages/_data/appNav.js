/**
 * The app's own navigation, in one place.
 *
 * This list was written out five times - once in the front matter of each signed-in page and
 * once in app/pages/admin/admin.11tydata.js - which meant adding Transit would have been five
 * edits, and four of them silently optional. A nav that disagrees with itself between two pages
 * of the same app is a bug nobody reports, because each page looks fine on its own.
 *
 * Two templates read it: the rail in _includes/app-shell.njk on wide screens, and the drawer in
 * _includes/chrome/header.njk on narrow ones.
 *
 * ORDER is the order it is shown in, and it is deliberate: Home first because it is where you
 * start, then the two things you came to look at, then the role-gated destinations you go to on
 * purpose. Anything with a `minRole` is drawn at the bottom of the rail and hidden until the
 * profile says otherwise - which decides what is DRAWN and nothing else. The API re-reads the
 * role from Firestore on every request.
 *
 * `icon` names a file in _includes/icons. `navKey` must equal the page's path with the slashes
 * turned into hyphens; app/scripts/shell.js matches it to mark the current link.
 */
module.exports = [
  { label: "Home", href: "/", navKey: "home", icon: "fa-solid-house" },
  { label: "Transit", href: "/transit/", navKey: "transit", icon: "fa-solid-bus" },
  { label: "Formula 1", href: "/f1/", navKey: "f1", icon: "fa-solid-flag-checkered" },
  { label: "Private", href: "/private/", navKey: "private", icon: "fa-solid-heart-lock", minRole: "SuperUser" },
  { label: "Admin", href: "/admin/", navKey: "admin", icon: "fa-solid-layer-group", minRole: "Admin" },
];
