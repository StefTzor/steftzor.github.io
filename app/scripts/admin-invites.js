import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin → Invites: one address, one role, and a clear answer either way.
 *
 * It no longer reloads the account list after a success, because the list is no longer on this
 * page. The message says where the new account went instead, which is the honest version of what
 * the silent refresh was doing.
 */

profile.then(() => {
  const form = el("inviteForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.dataset.submitting === "1") return;

    const field = el("inviteEmail");
    field.removeAttribute("aria-invalid");
    const email = field.value.trim();
    const role = el("inviteRole").value;
    // Sent only when filled in. An empty string would reach the API as a name it has to decide
    // about; omitting the key says "not given", which is what an untouched field means.
    const names = {};
    for (const [id, key] of [["inviteFirst", "firstName"], ["inviteLast", "lastName"]]) {
      const value = el(id).value.trim();
      if (value) names[key] = value;
    }
    if (!email) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
      say("Enter an email address to invite.", "error");
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    form.dataset.submitting = "1";
    btn.disabled = true;
    const idle = btn.textContent;
    btn.textContent = "Sending…";
    say(`Inviting ${email}…`);
    try {
      const res = await api("/admin/invites", { method: "POST", body: JSON.stringify({ email, role, ...names }) });
      // Named from the server's answer, not from the form: if the API stored something different
      // from what was typed, the message should say what was stored.
      const who = [res.firstName, res.lastName].filter(Boolean).join(" ") || email;
      say(res.sent
        ? `Invited ${who} as ${res.role}. They have been emailed a link to choose a password, and their account is on Accounts already.`
        : `Account created for ${who} as ${res.role}, but the email could not be sent. Use Reset password to try again.`,
        res.sent ? "ok" : "error");
      form.reset();
    } catch (err) {
      console.error("admin: invite failed", err.status, err.code);
      field.setAttribute("aria-invalid", "true");
      say(err.code === "already_exists"
        ? "That address already has an account. Look for it on Accounts."
        : err.code === "invalid_email" ? "That is not a valid email address."
        : err.code === "bad_name" ? "A name must be between 1 and 60 characters."
        : err.status === 403 ? "This account is not allowed to send invitations."
        : "The invitation could not be sent.", "error");
      field.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = idle;
      form.dataset.submitting = "0";
    }
  });
});
