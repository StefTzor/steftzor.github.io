import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin → Invites: one address, one role, and a clear answer either way.
 *
 * It no longer reloads the account list after a success, because the list is no longer on this
 * page. The message says where the new account went instead, which is the honest version of what
 * the silent refresh was doing.
 */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** The invitations sent, pending first, each pending one with a Resend button. Text only. */
async function loadSent() {
  const list = el("invList");
  try {
    const { invites } = await api("/admin/invites");
    list.textContent = "";
    if (!invites.length) {
      list.appendChild(node("li", "py-2 text-sm text-brand-muted", "No invitations sent yet."));
      return;
    }
    invites.forEach((i) => {
      const li = node("li", "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3");
      const who = node("div", "min-w-0");
      const name = [i.firstName, i.lastName].filter(Boolean).join(" ");
      who.appendChild(node("p", "truncate font-medium text-brand-text", name || i.email));
      who.appendChild(node("p", "truncate text-xs text-brand-muted",
        [name ? i.email : "", i.role, "sent " + day(i.invitedAt), i.resentAt ? "resent " + day(i.resentAt) : ""].filter(Boolean).join(" · ")));
      li.appendChild(who);
      const right = node("div", "flex shrink-0 items-center gap-3");
      right.appendChild(node("span", "status-pill status-pill--" + (i.state === "accepted" ? "up" : "unknown"),
        i.state === "accepted" ? "Accepted " + day(i.acceptedAt) : "Pending"));
      if (i.state === "pending") {
        const b = node("button", "btn-secondary px-3 py-1 text-xs", "Resend");
        b.type = "button";
        b.setAttribute("aria-label", "Resend the invitation to " + i.email);
        b.addEventListener("click", () => resend(i, b));
        right.appendChild(b);
      }
      li.appendChild(right);
      list.appendChild(li);
    });
  } catch (err) {
    console.error("admin: invites list", err.status, err.code);
    list.textContent = "";
    list.appendChild(node("li", "py-2 text-sm text-brand-muted", "The sent invitations could not be loaded."));
  }
}

async function resend(i, btn) {
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    await api("/admin/invites/" + encodeURIComponent(i.uid) + "/resend", { method: "POST" });
    say(`Sent the invitation to ${i.email} again, with a fresh link.`, "ok");
    await loadSent();
  } catch (err) {
    console.error("admin: resend", err.status, err.code);
    say(err.code === "already_accepted" ? `${i.email} has already accepted. Refresh to see it.`
      : "The invitation could not be sent again.", "error");
    btn.disabled = false;
    btn.textContent = "Resend";
  }
}

profile.then(() => {
  loadSent();
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
      loadSent();
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
