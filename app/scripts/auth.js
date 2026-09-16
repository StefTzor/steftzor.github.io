import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { fieldError, clearAll, focusFirstError, check, validateOnBlur, busy as setBusy } from "./forms.js";

/**
 * Auth for app.tzortzoglou.eu.
 *
 * Moved here from the public site because browser auth state is per-origin: a session created
 * at tzortzoglou.eu is not a session here, so the sign-in pages have to live where the app does.
 *
 * The security invariants are unchanged and still enforced by scripts/auth.security.test.js.
 * The short version, because it is easy to undo by accident while improving the wording:
 * every credential failure gets ONE message, and a registration for an address that already has
 * an account gets the SAME message as a new one. Anything else turns these forms into an oracle
 * for testing whether a person has an account here.
 */

// When the registration form became available — used for the bot timing check.
let formLoadedAt = 0;

const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://api.tzortzoglou.eu";

// Shown both on a successful registration AND when the address already has an
// account, so the form cannot be used to test whether an address is registered.
const PENDING_MESSAGE =
  "Thanks — your request has been received. Access is granted manually, so you will not be able to sign in until it is approved.";

// Same reasoning: one message whichever half of the credentials was wrong.
const SIGNIN_FAILED = "That email and password combination is not correct.";

/** Render PENDING_MESSAGE as neutral, not as an error. Both call sites must match. */
function showPending(el) {
  if (!el) return;
  el.textContent = PENDING_MESSAGE;
  el.classList.remove("hidden", "text-red-700", "dark:text-red-400");
  el.classList.add("text-emerald-700", "dark:text-emerald-400");
}

/** A neutral, non-error confirmation (used by the reset form, which never reports failure). */
function showNeutral(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "text-red-700", "dark:text-red-400");
  el.classList.add("text-emerald-700", "dark:text-emerald-400");
}

/**
 * Report a problem. The field is marked aria-invalid and takes focus, so a screen-reader user
 * lands on the input that needs fixing instead of having to hunt for it after the announcement.
 */
/**
 * Report a problem.
 *
 * With a field, the message goes beneath that field and the cursor lands there - so the fix is
 * where you are looking. Without one, it is about the whole form and goes to the shared region.
 * Both are announced; neither is only a colour.
 */
function fail(message, field) {
  if (field) {
    fieldError(field, message);
    field.focus();
    return;
  }
  const el = document.getElementById("errorMsg");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden", "text-emerald-700", "dark:text-emerald-400");
    el.classList.add("text-red-700", "dark:text-red-400");
  }
}

/** Clear the previous attempt, so a stale message never sits next to a fresh one. */
function resetState(form) {
  const el = document.getElementById("errorMsg");
  if (el) el.textContent = "";
  clearAll(form);
}

// The loading/disabled guard is shared with every other form in the app; see forms.js.
const busy = setBusy;

/**
 * Run once the DOM is ready — or immediately if it already is.
 *
 * This file is reached through a dynamic import() from auth-boot.js, which resolves long after
 * DOMContentLoaded has fired. Registering a DOMContentLoaded listener at that point waits for an
 * event that has already happened, so the handlers never attach, and a form with no submit
 * handler falls back to a native GET - putting the password in the URL, the browser history and
 * the referrer of the next request. That is exactly what happened on the live site.
 */
function onReady(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

onReady(() => {
  onAuthStateChanged(auth, handleAuthStateChanged);

  const $ = (id) => document.getElementById(id);

  const loginForm = $("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
    validateOnBlur($("email"), check.email);
  }

  const registerForm = $("registerForm");
  if (registerForm) {
    formLoadedAt = Date.now();
    registerForm.addEventListener("submit", handleRegister);
    validateOnBlur($("firstName"), (v) => check.required(v, "first name"));
    validateOnBlur($("lastName"), (v) => check.required(v, "last name"));
    validateOnBlur($("email"), check.email);
    validateOnBlur($("password"), check.newPassword);
    validateOnBlur($("confirmPassword"), (v) =>
      v !== $("password").value ? "Those passwords do not match." : null);
  }

  const resetForm = $("resetForm");
  if (resetForm) {
    resetForm.addEventListener("submit", handleReset);
    validateOnBlur($("email"), check.email);
  }

  document.querySelectorAll("[data-logout]").forEach((btn) =>
    btn.addEventListener("click", handleLogout));
});

async function handleLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (form.dataset.submitting === "1") return;

  resetState(form);
  const emailField = document.getElementById("email");
  const passwordField = document.getElementById("password");
  const email = emailField.value.trim();
  const password = passwordField.value;

  const emailProblem = check.email(email);
  if (emailProblem) { fail(emailProblem, emailField); return; }
  if (!password) { fail("Enter your password.", passwordField); return; }

  form.dataset.submitting = "1";
  busy(form, true, "Signing in…");
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Fail closed: a missing doc is not an approval. The API re-checks this on every
    // request anyway — this only decides what the browser shows.
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().status !== "approved") {
      await signOut(auth);
      fail("This account is waiting to be approved. You will be able to sign in once it is.");
      return;
    }
    window.location.href = "/";
  } catch (error) {
    // One message for every credential failure. Never branch on which half was wrong.
    console.error("Login error:", error.code || error);
    fail(SIGNIN_FAILED, passwordField);
  } finally {
    busy(form, false);
    form.dataset.submitting = "0";
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (form.dataset.submitting === "1") return;

  resetState(form);
  const emailField = document.getElementById("email");
  const passwordField = document.getElementById("password");
  const confirmField = document.getElementById("confirmPassword");
  const consent = document.getElementById("privacyConsent");
  const firstField = document.getElementById("firstName");
  const lastField = document.getElementById("lastName");
  const email = emailField.value.trim();
  const password = passwordField.value;
  const firstName = firstField ? firstField.value.trim() : "";
  const lastName = lastField ? lastField.value.trim() : "";

  if (firstField && !firstName) {
    fail("Please enter your first name.", firstField);
    return;
  }
  if (lastField && !lastName) {
    fail("Please enter your last name.", lastField);
    return;
  }

  if (password !== confirmField.value) {
    fail("Those passwords do not match.", confirmField);
    return;
  }
  // The page says eight characters; Firebase's own minimum is six, so without this the copy
  // and the behaviour disagree and the shorter password is silently accepted.
  const weak = check.newPassword(password);
  if (weak) { fail(weak, passwordField); return; }
  if (!consent || !consent.checked) {
    fail("Please agree to the Privacy Policy and Terms of Use before creating an account.", consent);
    return;
  }
  // Bots fill hidden fields and submit instantly; people do neither.
  if (document.getElementById("website").value) {
    fail("Your request could not be completed.");
    return;
  }
  if (Date.now() - formLoadedAt < 3000) {
    fail("That was too quick — please take a moment and try again.");
    return;
  }

  form.dataset.submitting = "1";
  busy(form, true, "Creating account…");
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    try {
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        firstName,
        lastName,
        status: "pending",
        createdAt: new Date().toISOString(),
        consentAt: new Date().toISOString(),
      });
      showPending(document.getElementById("errorMsg"));
      form.reset();
      formLoadedAt = Date.now();
    } finally {
      // Never leave a half-registered session signed in, even if the write failed.
      await signOut(auth);
    }
  } catch (error) {
    console.error("Registration error:", error.code || error);
    if (error.code === "auth/email-already-in-use") {
      // Deliberately identical to success: the form must not confirm who has an account.
      showPending(document.getElementById("errorMsg"));
    } else if (error.code === "auth/weak-password") {
      fail("Please choose a password of at least 8 characters.", passwordField);
    } else if (error.code === "auth/invalid-email") {
      fail("Please enter a valid email address.", emailField);
    } else {
      fail("Your request could not be completed. Please try again later.");
    }
  } finally {
    busy(form, false);
    form.dataset.submitting = "0";
  }
}

/**
 * Password reset.
 *
 * This deliberately does NOT call Firebase's sendPasswordResetEmail: that throws
 * auth/user-not-found for an unknown address, which is the account-enumeration oracle the
 * registration form is hardened against. The API answers identically either way.
 */
async function handleReset(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (form.dataset.submitting === "1") return;

  resetState(form);
  const emailField = document.getElementById("email");
  const email = emailField.value.trim();
  const problem = check.email(email);
  if (problem) { fail(problem, emailField); return; }

  form.dataset.submitting = "1";
  busy(form, true, "Sending…");
  try {
    await fetch(API_BASE + "/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    // Even a network failure is answered the same way. Saying "that address is unknown" or
    // "we could not reach the server" both tell an attacker more than they tell a user.
    console.error("Reset error:", error.message);
  }
  showNeutral(document.getElementById("errorMsg"),
    "If that address has an account, a reset link is on its way. The link works once and expires shortly.");
  form.reset();
  busy(form, false);
  form.dataset.submitting = "0";
}

async function handleLogout(e) {
  if (e) e.preventDefault();
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      // Revoke server-side so the session is dead everywhere, not just in this browser.
      await fetch(API_BASE + "/session/revoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        keepalive: true,
      });
    } catch (error) {
      // Must never trap someone in a signed-in state: log it and sign out anyway.
      console.warn("Sign-out: revoke failed", error.message);
    }
  }
  try {
    await signOut(auth);
  } catch (error) {
    console.warn("Sign-out failed", error.message);
  }
  window.location.href = "/login/";
}

function handleAuthStateChanged(user) {
  try {
    if (user) localStorage.setItem("auth-ui", "1");
    else localStorage.removeItem("auth-ui");
  } catch (err) { /* private mode: the hint is optional */ }
  document.documentElement.classList.toggle("is-authed", !!user);

  // Someone already signed in has no reason to look at a sign-in form.
  if (user && document.body.dataset.redirectWhenAuthed === "1") window.location.href = "/";
}
