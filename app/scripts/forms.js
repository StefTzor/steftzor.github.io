/**
 * Form feedback, shared by every form in the app.
 *
 * Three things it exists to make consistent:
 *
 *   - **Errors belong next to the field they describe.** A single message at the bottom of a
 *     form tells you something is wrong; it does not tell you which box to fix. Each field gets
 *     its own slot, wired with aria-describedby so a screen reader reads the problem when it
 *     reaches the input rather than as a disembodied announcement.
 *   - **Checked on blur, not only on submit.** Being told a password is too short after
 *     submitting - having already typed it twice - is a worse way to learn it.
 *   - **Every submit ends visibly.** Loading, then success or failure, never silence.
 *
 * The form-level region is kept for things that are genuinely about the whole form: the pending
 * message after registering, or a failure that belongs to no single field.
 */

/** The slot for a field's error, created next to it the first time it is needed. */
function slotFor(input) {
  const id = input.id + "-error";
  let slot = document.getElementById(id);
  if (!slot) {
    slot = document.createElement("p");
    slot.id = id;
    slot.className = "mt-1 text-sm text-red-700 dark:text-red-400";
    // role="alert" so a problem is announced when it appears. The field-level message is the
    // one worth interrupting for: it names what to do next.
    slot.setAttribute("role", "alert");
    (input.closest("div") || input.parentNode).appendChild(slot);
  }
  return slot;
}

/** Mark a field wrong and say why, beneath it. */
export function fieldError(input, message) {
  if (!input) return;
  const slot = slotFor(input);
  slot.textContent = message;
  input.setAttribute("aria-invalid", "true");
  const described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!described.includes(slot.id)) {
    input.setAttribute("aria-describedby", [...described, slot.id].join(" "));
  }
}

/** Clear one field's error, leaving its hint text alone. */
export function clearField(input) {
  if (!input) return;
  input.removeAttribute("aria-invalid");
  const slot = document.getElementById(input.id + "-error");
  if (slot) slot.textContent = "";
}

/** Clear every field in a form, at the start of an attempt. */
export function clearAll(form) {
  form.querySelectorAll("input").forEach(clearField);
}

/** The first field with a problem, focused - so the fix is where the cursor lands. */
export function focusFirstError(form) {
  const first = form.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks that can run before the server is involved.
 * Returns a message, or null when the value is acceptable.
 */
export const check = {
  email: (v) => (!v.trim() ? "Enter your email address."
    : !EMAIL.test(v.trim()) ? "That does not look like an email address." : null),
  password: (v) => (!v ? "Enter a password." : null),
  newPassword: (v) => (!v ? "Choose a password."
    : v.length < 8 ? "Use at least 8 characters." : null),
  required: (v, what) => (!v.trim() ? `Enter your ${what}.` : null),
};

/**
 * Validate on blur, and clear as soon as someone starts fixing it.
 *
 * Deliberately not on every keystroke: telling someone their address is invalid while they are
 * halfway through typing it is noise, and it trains people to ignore the message.
 */
export function validateOnBlur(input, validator) {
  if (!input) return;
  input.addEventListener("blur", () => {
    const message = validator(input.value);
    if (message) fieldError(input, message);
    else clearField(input);
  });
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") clearField(input);
  });
}

/** Disable a form while it is in flight, and say what is happening. */
export function busy(form, on, label) {
  const btn = form.querySelector('button[type="submit"]');
  form.setAttribute("aria-busy", on ? "true" : "false");
  if (!btn) return;
  if (on) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
    btn.textContent = label;
  } else if (btn.dataset.idleLabel) {
    btn.textContent = btn.dataset.idleLabel;
  }
  btn.disabled = on;
}
