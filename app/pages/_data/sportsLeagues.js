/**
 * The leagues with a page under /sports/. Same slugs as api src/leagues.js, which is the list
 * that decides what exists; this one only decides which pages are built. A slug added there and
 * not here has data and no page, and the overview simply does not link it.
 */
module.exports = [
  { slug: "allsvenskan", name: "Allsvenskan", sport: "football" },
  { slug: "shl", name: "SHL", sport: "hockey" },
  { slug: "hockeyallsvenskan", name: "HockeyAllsvenskan", sport: "hockey" },
];
