/**
 * Schema.org data shared across pages.
 *
 * `person` is the bare node, used where it nests inside another type (index's ProfilePage).
 * `personStandalone` is the same node with @context, used where it is the top-level object.
 *
 * Both are plain objects on purpose. Exporting a function that stamped mainEntityOfPage was
 * tidier to read and broke the dev server: Eleventy carries functions through a cold build but
 * drops them on an incremental rebuild, so `npm run build` passed while `npm run dev` failed on
 * the second save. The per-page stamping is an Eleventy filter instead - see `forPage` in
 * .eleventy.js.
 * Keeping one source means the four pages that each carried a copy can no longer disagree -
 * which is exactly how they all came to claim the same mainEntityOfPage.
 */
const person = {
    "@type": "Person",
    "alternateName": [
      "Στέφανος Τζώρτζογλου",
      "Stefanos Tzortzoglu"
    ],
    "familyName": "Tzortzoglou",
    "givenName": "Stefanos",
    "homeLocation": {
      "@type": "Place",
      "address": {
        "@type": "PostalAddress",
        "addressCountry": "SE",
        "addressLocality": "Uppsala",
        "addressRegion": "Uppsala län"
      }
    },
    "image": "https://tzortzoglou.eu/images/stefanos_profile.png",
    "jobTitle": [
      "Technical Customer Success Manager",
      "Implementation Lead",
      "Technical Account Manager"
    ],
    "knowsAbout": [
      "SaaS Implementation",
      "API Architecture",
      "Data Strategy",
      "SQL",
      "Snowflake",
      "Enterprise Customer Success",
    "Project Management",
    "Stakeholder Management"
    ],
  
    "name": "Stefanos Tzortzoglou",
    "sameAs": [
      "https://www.linkedin.com/in/stzortzoglou/",
      "https://github.com/steftzor"
    ],
    "url": "https://tzortzoglou.eu",
    "workLocation": {
      "@type": "Place",
      "address": {
        "@type": "PostalAddress",
        "addressCountry": "SE",
        "addressLocality": "Stockholm",
        "addressRegion": "Stockholms län"
      }
    }
  };

module.exports = {
  person,

  personStandalone: { "@context": "https://schema.org/", ...person },
};
