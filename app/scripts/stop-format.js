/**
 * How a stop and a departure are written, shared by the card on the home view and the full
 * board on /transit/.
 *
 * Three functions rather than a module each page keeps its own copy of: the two pages showed
 * the same upstream fields, and "Portalgatan (Uppsala) (Uppsala kn)" needs trimming in exactly
 * one way or the same stop reads as two different places depending on which page you are on.
 */

/** "now", "1 min", "12 min" - the only three shapes a departure board needs. */
export function inWords(minutes) {
  if (minutes <= 0) return "now";
  return `${minutes} min`;
}

/** ResRobot repeats the municipality: "Portalgatan (Uppsala) (Uppsala kn)". Once is enough. */
export function shortStop(name) {
  return String(name || "").replace(/\s*\([^)]*kn\)\s*$/i, "").trim();
}

/**
 * The other end of the journey, exactly as ResRobot gives it.
 *
 * This used to strip a leading "Uppsala ", which made "Uppsala Hågavägen" read as "Hågavägen"
 * and lost information for no gain. What ResRobot calls `direction` is documented as "name of
 * the last stop on the vehicle's trip" - so it is a stop name, not the destination an operator
 * puts on the front of the bus. UL's own app shows "Eriksberg Håga" because that is UL's
 * headsign, which this upstream does not carry at all.
 */
export function towardsOf(towards) {
  return String(towards || "").trim();
}
