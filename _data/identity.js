'use strict';

/**
 * The identity strings, in one place, because they used to live inside PNGs.
 *
 * Three images carried this text as pixels: `images/og-cover.png` (every social share of the
 * site), the LinkedIn banner, and the GitHub profile banner. On 2026-09-19 "Implementation
 * Lead" was removed from ten source files and verified with a grep that returned nothing. It
 * was still in all three images, because no grep reads a PNG, and the GitHub one hid it a
 * second time by URL-encoding it inside a capsule-render query string.
 *
 * So the text lives here and the images are built from it (`npm run cards`). A copy change is
 * one edit and one command, and `checks/surfaces.mjs` in the portfolio skill can assert against
 * a text file instead of trying to read pixels.
 *
 * Keep these in step with `references/job-search.md`, which is canonical for the wording itself.
 */

module.exports = {
  name: 'Stefanos Tzortzoglou',
  nameEl: 'Στέφανος Τζώρτζογλου',
  url: 'tzortzoglou.eu',

  /** The role, as a title rather than a claim. */
  title: 'Technical Customer Success Manager',

  /** job-search.md §2 headline [4]. The same sentence leads the site and the GitHub README. */
  anchor: 'I build the enterprise integrations most CSMs escalate',

  /** The GitHub banner subtitle. Measured at 579px of 1000 — see the JOURNAL for why not longer. */
  githubSubtitle: 'Technical CSM | SQL, REST APIs, CDP & CRM/ERP integrations',

  /** Dot-separated on the cards. Short enough to read at a glance on a shared link. */
  stack: ['SQL', 'REST APIs', 'CDP', 'CRM/ERP integrations'],

  /** Where the work happens. Kept out of the GitHub banner, which is tight for width. */
  place: 'Stockholm',
};
