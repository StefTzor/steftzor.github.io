/**
 * Shared front matter for every page under pages/.
 *
 * The navigation lives here rather than in each page so there is one list, and so adding a page
 * to the site does not mean remembering to add it to five other files.
 *
 * Deliberately no `layout` key: sitemap.njk and indexnow.njk emit XML and JSON, and a default
 * layout would wrap them in a document and destroy them.
 */
module.exports = {
  navItems: [
    { label: "Home", href: "/", navKey: "home" },
    { label: "About", href: "/about/", navKey: "about" },
    { label: "Portfolio", href: "/portfolio/", navKey: "portfolio" },
    { label: "Code", href: "/code/", navKey: "code" },
    { label: "Contact", href: "/contact/", navKey: "contact" },
  ],
  crossLink: { label: "Open the app \u2192", href: "https://app.tzortzoglou.eu/" },
};
