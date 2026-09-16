/**
 * Schema.org data shared across pages.
 *
 * `person` is the bare node, used where it nests inside another type (index's ProfilePage).
 * `personStandalone` is the same node with @context, used where it is the top-level object.
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
    "Stakeholder Communication"
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
  // mainEntityOfPage has to name the page carrying the schema. It used to be pasted as
  // /about/ into all four pages, so three of them told Google they were the about page.
  personFor: (url) => ({ ...person, mainEntityOfPage: `https://tzortzoglou.eu${url}` }),
  standaloneFor: (url) => ({ "@context": "https://schema.org/", ...person, mainEntityOfPage: `https://tzortzoglou.eu${url}` }),
};
