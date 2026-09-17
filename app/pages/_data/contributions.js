/**
 * The GitHub contribution calendar, for the app build.
 *
 * A re-export, not a copy. The fetch, the parsing and - most importantly - the decision that a
 * failed fetch returns null rather than failing the build all live in the site's
 * _data/contributions.js, and the home view wants exactly that data.
 *
 * It is re-exported rather than pointing the app's dir.data at the project root, which was the
 * first attempt: dir.data takes one directory, so moving it there took adminSections.js away
 * and every section link in the rail silently vanished. A data directory is not a search path.
 */
module.exports = require("../../../_data/contributions.js");
