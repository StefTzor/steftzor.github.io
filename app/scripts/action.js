import { auth } from "./firebase-config.js";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  applyActionCode,
  checkActionCode,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { API_BASE } from "./api-base.js";

/**
 * Handles the links Firebase mails: password reset, email verification, and the invitations
 * that will reuse the same mechanism.
 *
 * The oobCode in the URL is a bearer credential for one account. It is never logged and never
 * sent anywhere but Firebase, and it is taken out of the address bar as soon as it is no longer
 * needed - which stops it being the referrer of the next navigation, the way a password escaped
 * from the old sign-in form earlier today.
 *
 * What that does NOT do is erase it: the browser recorded the visit when the link was opened,
 * and replaceState rewrites the session-history entry rather than deleting the stored one. Every
 * hosted action handler has this property, Firebase's included. The mitigation is that these
 * codes are single-use and short-lived, so a recorded URL is worth nothing shortly after use.
 */

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

const el = (id) => document.getElementById(id);
const show = (id) => { el(id).classList.remove("hidden"); };
const hide = (id) => { el(id).classList.add("hidden"); };

function result(title, body) {
  el("resultTitle").textContent = title;
  el("resultBody").textContent = body;
  hide("loading"); hide("resetPanel"); show("resultPanel");
}

function fail(message, field) {
  const box = el("errorMsg");
  if (box) {
    box.textContent = message;
    box.classList.add("text-red-700", "dark:text-red-400");
  }
  if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
}

/** Take the code out of the URL once it has served its purpose. */
function scrubUrl() {
  try {
    history.replaceState(null, "", location.pathname);
  } catch (err) { /* nothing depends on this succeeding */ }
}

const EXPIRED = "That link has expired or has already been used. Request a new one and it will work.";

async function start() {
  if (!mode || !oobCode) {
    result("That link is not complete", "Open the link from your email exactly as it was sent.");
    return;
  }

  if (mode === "resetPassword") {
    let email;
    try {
      // Verifies the code before showing a form, so an expired link says so up front rather
      // than after someone has chosen and typed a new password twice.
      email = await verifyPasswordResetCode(auth, oobCode);
    } catch (error) {
      // The code may still be valid here - verify can fail on a transient network error - so
      // clear it from the URL rather than leaving a live credential in the address bar.
      scrubUrl();
      console.error("action: reset code rejected", error.code || "unknown");
      result("This link no longer works", EXPIRED);
      return;
    }
    el("resetFor").textContent = "For " + email;
    // Attach before revealing, so the panel is never visible without a working handler.
    el("resetPasswordForm").addEventListener("submit", (e) => submitNewPassword(e, email));
    hide("loading"); show("resetPanel");
    return;
  }

  if (mode === "verifyEmail") {
    try {
      await applyActionCode(auth, oobCode);
      scrubUrl();
      result("Email confirmed", "Your address is verified. You can sign in now.");
    } catch (error) {
      scrubUrl();
      console.error("action: verify code rejected", error.code || "unknown");
      result("This link no longer works", EXPIRED);
    }
    return;
  }

  if (mode === "recoverEmail") {
    try {
      const info = await checkActionCode(auth, oobCode);
      await applyActionCode(auth, oobCode);
      scrubUrl();
      result("Address restored",
        "Your sign-in address has been changed back to " + (info.data.email || "the previous one") + ".");
    } catch (error) {
      scrubUrl();
      console.error("action: recover code rejected", error.code || "unknown");
      result("This link no longer works", EXPIRED);
    }
    return;
  }

  if (mode === "verifyAndChangeEmail") {
    try {
      // checkActionCode first, so an expired link says so rather than failing mid-change.
      // info.data.email is the NEW address; info.data.previousEmail is the one being left.
      const info = await checkActionCode(auth, oobCode);
      await applyActionCode(auth, oobCode);
      scrubUrl();
      // Firebase revokes existing tokens when the sign-in address changes, so whoever opened
      // this is now signed out - which is what the "Go to sign in" button below is for. Saying
      // so is the difference between a completed action and an apparently random logout.
      result("Email address changed",
        "You now sign in with " + (info.data.email || "your new address") +
        ". Your other devices have been signed out, so sign in again with the new address.");
    } catch (error) {
      scrubUrl();
      console.error("action: change-email code rejected", error.code || "unknown");
      result("This link no longer works", EXPIRED);
    }
    return;
  }

  result("Unsupported link", "This kind of link is not handled here.");
}

async function submitNewPassword(e, email) {
  e.preventDefault();
  const form = e.currentTarget;
  if (form.dataset.submitting === "1") return;

  el("errorMsg").textContent = "";
  form.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));

  const passwordField = el("newPassword");
  const confirmField = el("confirmNewPassword");
  const password = passwordField.value;

  if (password.length < 8) {
    fail("Please choose a password of at least 8 characters.", passwordField);
    return;
  }
  if (password !== confirmField.value) {
    fail("Those passwords do not match.", confirmField);
    return;
  }

  form.dataset.submitting = "1";
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await confirmPasswordReset(auth, oobCode, password);
    form.reset();
    scrubUrl();
    // The password is set either way; everything past this point is a courtesy, so a failure in
    // it must never read as "your password did not change".
    if (await offerName(email, password)) return;
    result("Password changed",
      "Your new password is set for " + email + ". Sign in with it now.");
  } catch (error) {
    console.error("action: confirm failed", error.code || "unknown");
    fail(error.code === "auth/weak-password"
      ? "Please choose a stronger password of at least 8 characters."
      : EXPIRED, passwordField);
    btn.disabled = false;
    btn.textContent = "Set new password";
    form.dataset.submitting = "0";
  }
}

/**
 * After an invitation: sign in and offer the name for editing, once.
 *
 * Returns true when it has taken over the screen, false when the caller should show its own
 * "password changed" result instead.
 *
 * Signing in here is not a shortcut - it is the only way this page can read or write the name.
 * The name lives behind the login and the credential to get there is the password that was just
 * chosen on this page, seconds ago, by the person holding the mailbox the link was sent to.
 *
 * Everything below fails soft. The password change has already succeeded and is not undoable, so
 * an API hiccup must leave the person with a working account and an accurate message, never an
 * error that implies otherwise.
 */
async function offerName(email, password) {
  let me;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const res = await fetch(API_BASE + "/me", {
      headers: { Authorization: "Bearer " + (await cred.user.getIdToken()) },
    });
    if (!res.ok) throw new Error("me " + res.status);
    me = await res.json();
  } catch (err) {
    console.error("action: could not open the name step", err.message);
    return false;
  }

  // Only for an invitation nobody has confirmed. An ordinary password reset, years later, must
  // not stop to ask about a name that was settled long ago.
  if (!me.invitePending) {
    location.replace("/");
    return true;
  }

  const first = el("nameFirst");
  const last = el("nameLast");
  first.value = me.firstName || "";
  last.value = me.lastName || "";
  el("nameIntro").textContent = (me.firstName || me.lastName)
    ? "Your account was set up with this name. Change it if it is not right."
    : "Tell me what to call you. You can change it later in your profile.";

  const done = async (payload) => {
    try {
      await fetch(API_BASE + "/me/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (await auth.currentUser.getIdToken()),
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // The account works and the password is set; a name that did not save is a thing the
      // profile page can fix, and blocking entry over it would be the worse failure.
      console.error("action: saving the name failed", err.message);
    }
    location.replace("/");
  };

  el("nameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = { nameConfirmed: true };
    // Only what was filled in. An empty field means "leave it", not "erase it" - and the API
    // refuses an empty name outright, so sending one would fail the whole request.
    if (first.value.trim()) payload.firstName = first.value.trim();
    if (last.value.trim()) payload.lastName = last.value.trim();
    done(payload);
  });

  // Skipping is an answer, and is recorded as one so the question does not come back.
  el("nameSkip").addEventListener("click", () => done({ nameConfirmed: true }));

  hide("resetPanel");
  show("namePanel");
  first.focus();
  return true;
}

start();
