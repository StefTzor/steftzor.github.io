/**
 * Team colours, maintained here because the API does not carry them.
 *
 * Jolpica gives a constructor an id, a name, a nationality and a Wikipedia URL — and nothing
 * else. Every F1 site colours its tables, and every one of them keeps a map like this. Keeping
 * it in one file means the colour of a team is decided once rather than in each table that
 * happens to draw one.
 *
 * Keyed on `constructorId`, which is upstream's stable identifier rather than the display name:
 * a team that renames itself keeps its id, and "Red Bull" has been written four different ways.
 *
 * **This will go out of date**, and that is a known cost rather than an oversight. A team joining
 * or rebranding needs a line here. An unknown one gets grey rather than nothing, so a new entrant
 * is visible — and that grey is the signal that this file needs a line adding.
 *
 * The colour is drawn as a bar beside the name, never as a background behind text. That is how
 * these tables normally read, and it means no combination of team colour and theme can produce
 * an unreadable row — there is no text on the colour to have contrast against.
 */
const COLOURS = {
  alpine: "#0093cc",
  aston_martin: "#229971",
  audi: "#00505c",
  cadillac: "#a4884a",
  ferrari: "#e8002d",
  haas: "#b6babd",
  mclaren: "#ff8000",
  mercedes: "#27f4d2",
  rb: "#6692ff",
  red_bull: "#3671c6",
  williams: "#64c4ff",
};

const FALLBACK = "#94a3b8";

/** The colour for a constructor id. Unknown teams get grey rather than nothing. */
export function teamColour(constructorId) {
  return COLOURS[constructorId] || FALLBACK;
}
