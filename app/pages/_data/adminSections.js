/**
 * The sections of the Admin area, in one place.
 *
 * Two templates draw this list - the sidebar disclosure in _includes/app-shell.njk on wide
 * screens, and the row of links in _includes/chrome/admin-sections.njk on narrow ones. They were
 * never going to be kept in step by hand, and a navigation that disagrees with itself about what
 * exists is worse than one that is merely plain.
 *
 * Adding a section is: a page in app/pages/admin/, a script, and one entry here.
 *
 * `icon` names a file in _includes/icons. `navKey` must equal the page's path with the slashes
 * turned into hyphens - that is what app/scripts/shell.js matches to mark the current link.
 */
module.exports = [
  {
    label: "Overview",
    href: "/admin/",
    navKey: "admin",
    icon: "fa-solid-layer-group",
  },
  {
    label: "Accounts",
    href: "/admin/accounts/",
    navKey: "admin-accounts",
    icon: "fa-solid-users",
  },
  {
    label: "Messages",
    href: "/admin/messages/",
    navKey: "admin-messages",
    icon: "fa-solid-envelope-open-text",
  },
  {
    label: "Invites",
    href: "/admin/invites/",
    navKey: "admin-invites",
    icon: "fa-solid-user-plus",
  },
  {
    label: "Health",
    href: "/admin/health/",
    navKey: "admin-health",
    icon: "fa-solid-shield-alt",
  },
  {
    label: "Analytics",
    href: "/admin/analytics/",
    navKey: "admin-analytics",
    icon: "fa-solid-chart-line",
  },
];
