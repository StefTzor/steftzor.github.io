import { auth, db } from "./firebase-config.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// When the registration form became available — used for the bot timing check.
let formLoadedAt = 0;

// Where the authenticated content API lives (see references/backend-vps.md).
const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://api.tzortzoglou.eu";

// Shown both on a successful registration AND when the address already has an
// account, so the form cannot be used to test whether an address is registered.
/** Render PENDING_MESSAGE as neutral, not as an error. Both call sites must match. */
function showPending(el) {
  if (!el) return;
  el.textContent = PENDING_MESSAGE;
  el.classList.remove("hidden", "text-red-700", "dark:text-red-400");
  el.classList.add("text-emerald-700", "dark:text-emerald-400");
}

const PENDING_MESSAGE =
  "Thanks — your request has been received. Access is granted manually, so you will not be able to sign in until it is approved.";

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

  // Set up event listeners
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    formLoadedAt = Date.now();
    registerForm.addEventListener("submit", handleRegister);
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  const approveUserForm = document.getElementById("approveUserForm");
  if (approveUserForm) {
    approveUserForm.addEventListener("submit", handleApproveUser);
  }
});

// Handle login
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const errorMsg = document.getElementById("errorMsg");

  if (errorMsg) errorMsg.textContent = "";

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Get user status using the modular syntax
    // Fail closed: a missing doc is not an approval.
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().status !== "approved") {
      await signOut(auth);
      if (errorMsg) {
        errorMsg.textContent = "Your account is pending approval. Please wait for an administrator to approve your registration.";
      }
      return;
    }

    // Redirect if approved - use absolute path
    window.location.href = window.location.origin + "/exclusive/";
  } catch (error) {
    // Deliberately identical for "no such account" and "wrong password".
    // Distinguishing them hands an attacker a free list of who has an account.
    // Firebase-level Email Enumeration Protection also covers this; keeping the
    // UI generic means the site stays safe even if that setting is ever changed.
    console.error("Login error:", error.code || error);
    if (errorMsg) {
      errorMsg.textContent = "That email and password combination is not correct.";
    }
  }
}

// Handle registration
async function handleRegister(e) {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const consent = document.getElementById("privacyConsent");
  const errorMsg = document.getElementById("errorMsg");

  if (errorMsg) errorMsg.textContent = "";

  if (password !== confirmPassword) {
    errorMsg.textContent = "Passwords do not match";
    return;
  }

  // GDPR Art. 6(1)(a): no account is created without an affirmative opt-in.
  // The checkbox is also `required`, so this only catches a bypassed form.
  // The page says eight characters; Firebase's own minimum is six, so without this the copy
  // and the behaviour disagree and the shorter password is silently accepted.
  if (password.length < 8) {
    fail("Please choose a password of at least 8 characters.", passwordField);
    return;
  }
  if (!consent || !consent.checked) {
    errorMsg.textContent = "Please agree to the Privacy Policy and Terms of Use before creating an account.";
    if (consent) consent.focus();
    return;
  }

  // Spam gate. The honeypot is invisible to people, so anything in it is a bot.
  // The timing check catches bots that clear the honeypot but submit instantly.
  // Both fail silently-ish: a real person can never trip either one.
  const honeypot = document.getElementById("website");
  if (honeypot && honeypot.value) {
    errorMsg.textContent = "Registration could not be completed.";
    return;
  }
  if (Date.now() - formLoadedAt < 3000) {
    errorMsg.textContent = "That was too quick — please take a moment and try again.";
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Store user status in Firestore as "pending"
    // consentAt records WHEN consent was given, so it can be demonstrated (GDPR Art. 7(1)).
    // NOTE: firestore.rules must allow this key — deploy the rules before deploying this script.
    try {
      await setDoc(doc(db, "users", user.uid), {
        email: user.email,
        status: "pending",
        createdAt: new Date().toISOString(),
        consentAt: new Date().toISOString(),
      });
    } finally {
      // Sign out even if the write failed, so a half-registered account never
      // leaves an authenticated session behind.
      await signOut(auth);
    }

    // Show message
    showPending(document.getElementById("errorMsg"));

  } catch (error) {
    console.error("Registration error:", error.code || error);
    if (error.code === 'auth/email-already-in-use') {
      // Show exactly what a brand-new registration shows. Confirming that an
      // address is already registered turns this form into an account oracle.
      showPending(errorMsg);
    } else if (error.code === 'auth/weak-password') {
      errorMsg.textContent = "Please choose a password of at least 8 characters.";
    } else if (error.code === 'auth/invalid-email') {
      errorMsg.textContent = "Please enter a valid email address.";
    } else {
      errorMsg.textContent = "Your request could not be completed. Please try again later.";
    }
  }
}

// Handle logout
async function handleLogout(e) {
  if (e) e.preventDefault();

  // Firebase signOut() only clears local tokens — the refresh token stays valid
  // server-side, so a stolen session would survive "logging out". Ask the API to
  // revoke it first, then sign out locally regardless of whether that succeeded.
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      await fetch(API_BASE + "/session/revoke", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        keepalive: true,
      });
    }
  } catch (error) {
    // The API being unreachable must never trap someone in a logged-in state.
    console.warn("Server-side session revocation failed; signing out locally.", error);
  }

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
  }
  window.location.href = "/login/";
}

// Handle auth state changes
async /**
 * Keeps the hint auth-boot.js reads, and nothing else.
 *
 * This used to drive the public site's signed-in header - #user-view, the logout button, the
 * Exclusive dropdown. All of that is gone: sign-in moved to app.tzortzoglou.eu, so the public
 * origin never sets the flag that would load this module, and every one of those branches was
 * unreachable markup driving unreachable code.
 */
function handleAuthStateChanged(user) {
  try {
    if (user) localStorage.setItem("auth-ui", "1");
    else localStorage.removeItem("auth-ui");
  } catch (err) { /* private mode: the hint is optional */ }
}

// Handle user approval by admin
async function handleApproveUser(e) {
  e.preventDefault();

  const userId = document.getElementById("userId").value;
  const errorMsg = document.getElementById("errorMsg");

  if (errorMsg) errorMsg.textContent = "";

  try {
    await updateDoc(doc(db, "users", userId), {
      status: "approved",
    });

    // Show success message
    const message = document.getElementById("message");
    if (message) {
      message.textContent = "User approved successfully!";
      message.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Approval error:", error.code || error);
    if (errorMsg) {
      errorMsg.textContent = "That approval could not be completed.";
    }
  }
}