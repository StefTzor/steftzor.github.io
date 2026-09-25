/**
 * Which part of the day the reader is in, from the sunrise and sunset the forecast already sent.
 *
 * The hero's sky used to know only "day" or "night" (the API's isDay), so seven in the morning in
 * December looked exactly like noon in June. These are the reader's own times for their own
 * place, so the card is right about the light outside their window without a new request.
 *
 * The windows are round numbers, not astronomy: dawn from 45 minutes before sunrise to 30 after,
 * golden hour the 75 minutes before sunset, dusk from 15 minutes before it to 45 after. Close
 * enough to what a person would call each one, and they overlap nothing.
 *
 * Returns null when either time is unreadable, so the card draws no daylight at all rather than
 * guessing one. Polar day and night arrive as missing times from the API and land there too.
 */
const MIN = 60000;

export function skyPhase(sunrise, sunset, now = Date.now()) {
  // typeof first: Date.parse coerces, and an array or a number would read as a date.
  if (typeof sunrise !== "string" || typeof sunset !== "string") return null;
  const up = Date.parse(sunrise);
  const down = Date.parse(sunset);
  if (!Number.isFinite(up) || !Number.isFinite(down) || down <= up) return null;

  if (now >= up - 45 * MIN && now < up + 30 * MIN) return "dawn";
  if (now >= down - 15 * MIN && now < down + 45 * MIN) return "dusk";
  if (now >= down - 75 * MIN && now < down - 15 * MIN) return "golden";
  if (now >= up + 30 * MIN && now < down - 75 * MIN) return "day";
  return "night";
}
