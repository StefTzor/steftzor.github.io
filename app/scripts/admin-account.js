import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin -> one account.
 *
 * Reached as /admin/account/?uid=..., because this is a static build: there is no server to
 * route /admin/account/<uid>/ to, and a query parameter is a real URL that can be linked,
 * bookmarked and gone back to. The uid in it decides nothing - every request carries the
 * admin's own token and the API re-checks who is asking on each one.
 *
 * The two dangerous actions are deliberately two steps. The confirmation is a disclosure that
 * NAMES the address it is about to mail, rather than a confirm() that cannot: the thing worth
 * checking before pressing send is which address, and a dialog that only says "are you sure"
 * trains people to press yes.
 */

const uid = new URLSearchParams(location.search).get("uid");
let account = null;

/** A status pill, same vocabulary as the accounts list. */
function pill(text, tone) {
  const span = document.createElement("span");
  span.className = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold " + tone;
  span.textContent = text;
  return span;
}

const TONES = {
  approved: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-600/15 text-amber-700 dark:text-amber-300",
};

/** createElement and textContent, because every string here was typed by whoever registered. */
function paint(u) {
  account = u;
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  el("who").textContent = name || u.email || u.uid;
  // The address is the heading only when there is no name; repeating it underneath would then
  // be the same line twice.
  el("whoEmail").textContent = name ? (u.email || "") : "";

  const meta = el("whoMeta");
  meta.textContent = "";
  meta.append(
    pill(u.status === "approved" ? "Approved" : u.status === "pending" ? "Pending" : "Suspended",
      TONES[u.status] || "bg-red-600/15 text-red-700 dark:text-red-300"),
    pill(u.role || "User", "bg-brand-accent/10 text-brand-accent"));

  el("accFirst").value = u.firstName || "";
  el("accLast").value = u.lastName || "";
  el("resetTarget").textContent = u.email || "";
  el("panels").classList.remove("hidden");
}

/** Re-read from the list, which is the only endpoint that returns the stored document. */
async function load() {
  const { users } = await api("/admin/users");
  const found = users.find((u) => u.uid === uid);
  if (!found) throw Object.assign(new Error("not found"), { status: 404 });
  paint(found);
}

// --- name --------------------------------------------------------------------

el("nameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const first = el("accFirst").value.trim();
  const last = el("accLast").value.trim();

  // An emptied field is an explicit null, not an omission. On this screen clearing a name is a
  // thing somebody means to do - it is the only way to undo a name that should never have been
  // typed - whereas on a person's own profile an empty field means "leave it alone".
  const body = {};
  if (first !== (account.firstName || "")) body.firstName = first || null;
  if (last !== (account.lastName || "")) body.lastName = last || null;
  if (!Object.keys(body).length) { say("That is already the name on this account."); return; }

  btn.disabled = true;
  say("Saving…");
  try {
    await api(`/admin/users/${encodeURIComponent(uid)}`, { method: "POST", body: JSON.stringify(body) });
    await load();
    say("Name saved.", "ok");
  } catch (err) {
    console.error("account: name failed", err.status, err.code);
    say(err.code === "bad_name" ? "A name must be between 1 and 60 characters."
      : err.code === "self_target" ? "This is your own account — your name is on your profile page."
      : "That could not be saved.", "error");
  } finally {
    btn.disabled = false;
  }
});

// --- password reset ----------------------------------------------------------

const resetBox = el("resetConfirm");
el("resetOpen").addEventListener("click", () => {
  resetBox.classList.remove("hidden");
  el("resetGo").focus();
});
el("resetCancel").addEventListener("click", () => {
  resetBox.classList.add("hidden");
  el("resetOpen").focus();
});

el("resetGo").addEventListener("click", async () => {
  const go = el("resetGo");
  go.disabled = true;
  say("Sending…");
  try {
    const res = await api(`/admin/users/${encodeURIComponent(uid)}/password-reset`, { method: "POST" });
    resetBox.classList.add("hidden");
    say(`A reset link is on its way to ${res.email}. Their current password works until they use it.`, "ok");
  } catch (err) {
    console.error("account: reset failed", err.status, err.code);
    say(reason(err, "The reset could not be sent."), "error");
  } finally {
    go.disabled = false;
  }
});

// --- email address -----------------------------------------------------------

const emailBox = el("emailConfirm");
el("emailOpen").addEventListener("click", () => {
  const wanted = el("accEmail").value.trim();
  if (!wanted) {
    el("accEmail").setAttribute("aria-invalid", "true");
    el("accEmail").focus();
    say("Enter the address to move this account to.", "error");
    return;
  }
  el("accEmail").removeAttribute("aria-invalid");
  // Named in the confirmation, so the check is against what will actually be mailed rather than
  // against what the person believes they typed.
  el("emailTarget").textContent = wanted;
  emailBox.classList.remove("hidden");
});

el("emailCancel").addEventListener("click", () => {
  emailBox.classList.add("hidden");
  el("accEmail").focus();
});

el("emailForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = el("accEmail").value.trim();
  const btn = emailBox.querySelector('button[type="submit"]');
  btn.disabled = true;
  say("Sending the confirmation…");
  try {
    const res = await api(`/admin/users/${encodeURIComponent(uid)}/email`, {
      method: "POST", body: JSON.stringify({ email }),
    });
    emailBox.classList.add("hidden");
    el("accEmail").value = "";
    say(`Asked ${res.pending} to confirm. Nothing has changed yet — ${res.from} still signs in, ` +
      "and has been told you asked.", "ok");
  } catch (err) {
    console.error("account: email change failed", err.status, err.code);
    say(reason(err, "The confirmation could not be sent."), "error");
  } finally {
    btn.disabled = false;
  }
});

/** The server's own reason when it gave one worth repeating, otherwise the caller's fallback. */
function reason(err, fallback) {
  switch (err.code) {
    case "reauth_required":
      return "Sign in again before changing someone else's account — this one needs a recent sign-in.";
    case "self_target":
      return "This is your own account. Use your profile page.";
    case "already_exists":
      return "Another account already uses that address.";
    case "same_email":
      return "That is already this account's address.";
    case "invalid_email":
      return "That is not a valid email address.";
    case "send_failed":
      return "The email could not be sent. Nothing was changed.";
    default:
      return fallback;
  }
}

profile.then(async () => {
  if (!uid) {
    say("No account was named. Open one from the accounts list.", "error");
    return;
  }
  try {
    await load();
    say("");
  } catch (err) {
    console.error("account: load failed", err.status);
    say(err.status === 404 ? "There is no account with that identifier."
      : err.status === 403 ? "This account is not allowed to manage accounts."
      : "That account could not be loaded.", "error");
  }
});
