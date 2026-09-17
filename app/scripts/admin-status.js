/**
 * The one live region every Admin page carries, and the one way to write to it.
 *
 * Each page has a single #status rather than one per section, so a screen reader hears the
 * result of an action once. Splitting Admin into three pages made three copies of this function
 * the obvious outcome; they would have drifted the first time the tone of an error changed.
 */

export const el = (id) => document.getElementById(id);

export function say(message, kind) {
  const box = el("status");
  if (!box) return;
  box.textContent = message;
  box.className = "mb-6 text-sm " + (
    kind === "error" ? "text-red-700 dark:text-red-400"
    : kind === "ok" ? "text-emerald-700 dark:text-emerald-400"
    : "text-brand-muted");
}
