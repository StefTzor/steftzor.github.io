import { profile, API_BASE } from "./shell.js";
import { fieldError, clearAll, check, busy } from "./forms.js";

/**
 * A way to send a message from inside the app.
 *
 * It reuses the contact *pipeline* - the endpoint and the body shape - and deliberately not
 * scripts/contact.js, which is a non-module IIFE bound to the public page's element ids and is
 * asserted against, as text, by scripts/contact.security.test.js. Sharing the file would break
 * those assertions; sharing the contract costs nothing.
 *
 * The trap worth knowing about: the API drops any submission with elapsedMs under three seconds
 * and answers 200 {ok:true} anyway, because a bot that learns which field gave it away edits
 * that field. So a widget that sent a made-up elapsed time would lose real messages silently.
 * The timer starts when the dialog opens, and the send button stays disabled until it is safe.
 */

const MIN_FILL_MS = 3000;

const el = (id) => document.getElementById(id);

function say(message, kind) {
  const box = el("cwStatus");
  if (!box) return;
  box.className = "text-sm " + (kind === "error"
    ? "text-red-700 dark:text-red-400"
    : kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-brand-muted");
  box.textContent = message;
}

profile.then((me) => {
  const openBtn = el("cwOpen");
  const panel = el("cwPanel");
  const closeBtn = el("cwClose");
  const form = el("cwForm");
  const message = el("cwMessage");
  const consent = el("cwConsent");
  const submit = form && form.querySelector('button[type="submit"]');
  if (!openBtn || !panel || !form) return;

  // Known from /me, so nobody retypes what we already have. Shown rather than hidden: a form
  // that sends your address should say which address.
  el("cwName").textContent = me.name || me.email || "";
  el("cwEmail").textContent = me.email || "";

  let openedAt = 0;
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    panel.classList.remove("hidden");
    openBtn.setAttribute("aria-expanded", "true");
    openedAt = Date.now();
    // Removing `hidden` marks style dirty but does not apply it, and focus() on a still
    // display:none element does nothing at all. Reading a layout property forces the recalc.
    void panel.offsetHeight;
    message.focus();
    say("");
  }

  function close(restoreFocus) {
    panel.classList.add("hidden");
    openBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus && lastFocused && lastFocused.focus) lastFocused.focus();
    else openBtn.focus();
  }

  openBtn.addEventListener("click", () => {
    if (panel.classList.contains("hidden")) open(); else close(true);
  });
  if (closeBtn) closeBtn.addEventListener("click", () => close(true));

  // Something else on the page deliberately opened and would sit on top of this. Closing only
  // hides the panel - the textarea keeps its value, so reopening restores a half-written
  // message rather than losing it. `false`, because focus belongs to whatever the person just
  // pressed, not back here.
  document.addEventListener("app:collapse", () => {
    if (!panel.classList.contains("hidden")) close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.classList.contains("hidden")) close(true);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAll(form);

    const text = message.value.trim();
    if (text.length < 10) {
      fieldError(message, "Tell me a little more — at least ten characters.");
      message.focus();
      return;
    }
    if (!consent.checked) {
      fieldError(consent, "Please confirm you are happy for this to be emailed to me.");
      consent.focus();
      return;
    }

    const elapsed = Date.now() - openedAt;
    if (elapsed < MIN_FILL_MS) {
      // Honest about it rather than sending something the server will drop while answering ok.
      say(`One moment — the form needs ${Math.ceil((MIN_FILL_MS - elapsed) / 1000)}s more.`, null);
      setTimeout(() => say(""), 2500);
      return;
    }

    busy(form, true, "Sending…");
    try {
      const res = await fetch(API_BASE + "/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: me.name || me.email,
          email: me.email,
          message: text,
          consent: true,
          // The honeypot, empty. Sent because the server expects the field, not because a
          // signed-in person is suspected.
          website: "",
          elapsedMs: elapsed,
        }),
      });
      if (res.status === 429) {
        say("That is a few too many messages for now. Please try again later.", "error");
      } else if (!res.ok) {
        // Deliberately one message for every other failure, matching the public form: the
        // response body is not read and nothing from it is echoed.
        say("That could not be sent. Please try again.", "error");
      } else {
        form.reset();
        openedAt = Date.now();
        say("Sent — thank you. I will reply by email.", "ok");
      }
    } catch (err) {
      say("That could not be sent. Please try again.", "error");
    }
    busy(form, false);
  });
});
