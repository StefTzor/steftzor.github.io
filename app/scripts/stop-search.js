/**
 * Search as you type, for the two stop pickers (the home card and /transit/).
 *
 * The matching itself is ResRobot's: it already finds "Uppsala Centralstation" from "upps" and
 * "Stockholm C" from "stockh c". What this adds is asking without Enter, and asking gently:
 *
 *   - **after a 250ms pause, from three letters.** Each question spends the Trafiklab quota
 *     (45 a minute, 30,000 a month), and the API caches a query for a day on top of this.
 *   - **only the latest answer draws.** A slow reply to "upp" must not land after the reply to
 *     "uppsala c" and replace it.
 *   - **the same text is asked once per page.** Backspacing over a letter redraws from memory.
 *
 * Enter still searches at once, for anyone who types the whole name. The down arrow moves from
 * the box into the results and up and down moves between them, so the list can be used without
 * a pointer; the results are buttons, so Enter or Space picks one.
 *
 * **Tab completes, like a terminal:** it fills the box with the top suggestion. Only when the box
 * does not already say exactly that, so a second Tab moves focus on as it always does - a
 * keyboard user is never trapped in the field.
 */
const WAIT_MS = 250;
const MIN_CHARS = 3;

/**
 * @param {object} o
 * @param {HTMLInputElement} o.input
 * @param {HTMLElement} o.list - the results list, whose buttons are the choices
 * @param {(q: string) => Promise<object[]>} o.fetchStops
 * @param {(stops: object[]) => void} o.render
 * @param {(text: string) => void} o.note
 */
export function liveSearch({ input, list, fetchStops, render, note }) {
  const seen = new Map();
  let timer = 0;
  let latest = 0;
  let top = null; // the first stop currently drawn, which Tab completes to

  const show = (stops) => {
    top = stops.length ? stops[0] : null;
    render(stops);
  };

  async function run(raw) {
    const q = raw.trim();
    const mine = ++latest;
    if (q.length < MIN_CHARS) {
      top = null;
      list.textContent = "";
      note(q ? `Keep typing: ${MIN_CHARS} letters or more.` : "");
      return;
    }
    if (seen.has(q.toLowerCase())) {
      show(seen.get(q.toLowerCase()));
      return;
    }
    note("Searching…");
    try {
      const stops = await fetchStops(q);
      seen.set(q.toLowerCase(), stops);
      if (mine === latest) show(stops);
    } catch (err) {
      console.error("stop search failed", err.status, err.code);
      if (mine === latest) note("The search could not be run.");
    }
  }

  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), WAIT_MS);
  });

  const buttons = () => [...list.querySelectorAll("button")];
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && top && input.value !== top.name) {
      e.preventDefault();
      input.value = top.name;
      clearTimeout(timer);
      run(input.value);
      return;
    }
    if (e.key === "ArrowDown" && buttons().length) {
      e.preventDefault();
      buttons()[0].focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement);
    if (at < 0) return;
    if (e.key === "ArrowDown" && at < all.length - 1) { e.preventDefault(); all[at + 1].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (at ? all[at - 1] : input).focus(); }
  });

  /** For the form's submit: search now, without waiting for the pause. */
  return {
    now() {
      clearTimeout(timer);
      return run(input.value);
    },
  };
}
