/**
 * How many rows each list had last time.
 *
 * The placeholder lists reserve a fixed count, and a fixed count is wrong whenever the answer is
 * a different size. The departures board is capped at twelve and returns twelve at eight in the
 * morning and eight at half past ten at night, so reserving twelve costs 228px of collapse on a
 * quiet evening — measured, and it was the whole of what was left on /transit/.
 *
 * A remembered count is exact from the second visit onward. The first is still a guess, and the
 * markup's default is that guess.
 *
 * Deliberately NOT keyed by stop. The count is a hint, not a fact: pointing the board at a new
 * stop makes it briefly wrong and the next load corrects it, which is the same small shift this
 * is reducing rather than a new problem. Keying it per stop would mean an unbounded store to
 * prune, for an error that costs one load.
 */

const KEY = "app-rows";

/** Every read and write is wrapped: localStorage throws in a private window, and this is a hint. */
export function remember(id, count) {
  if (!Number.isFinite(count) || count < 0) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (all[id] === count) return;
    all[id] = count;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* a hint that cannot be stored is just a hint that is not stored */ }
}

/**
 * Sign-out forgets it, alongside the cached profile.
 *
 * Tidiness rather than privacy: the value is a handful of counts and says nothing about
 * which stop they came from. What it does encode is roughly how busy that stop was, and
 * leaving one account’s numbers to size the next account’s placeholders is untidy enough
 * to be worth a line.
 */
export function forgetRows() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
}
