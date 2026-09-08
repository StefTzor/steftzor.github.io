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
const PENDING_MESSAGE =
  "Thanks — your request has been received. Access is granted manually, so you will not be able to sign in until it is approved.";

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
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
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.status !== "approved") {
        await signOut(auth);
        if (errorMsg) {
          errorMsg.textContent = "Your account is pending approval. Please wait for an administrator to approve your registration.";
        }
        return;
      }
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
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      status: "pending",
      createdAt: new Date().toISOString(),
      consentAt: new Date().toISOString(),
    });

    // Sign out the user immediately
    await signOut(auth);

    // Show message
    const errorMsg = document.getElementById("errorMsg");
    if (errorMsg) {
      errorMsg.textContent = PENDING_MESSAGE;
      errorMsg.classList.remove("hidden");
    }

  } catch (error) {
    console.error("Registration error:", error.code || error);
    if (error.code === 'auth/email-already-in-use') {
      // Show exactly what a brand-new registration shows. Confirming that an
      // address is already registered turns this form into an account oracle.
      errorMsg.textContent = PENDING_MESSAGE;
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
async function handleAuthStateChanged(user) {
  // --- DESKTOP ELEMENTS ---
  const guestView = document.getElementById("guest-view");
  const userView = document.getElementById("user-view");
  const userDisplay = document.getElementById("user-display");
  const logoutBtn = document.getElementById("logoutBtn");
  const exclusiveNavItem = document.getElementById("exclusive-nav-item");

  // --- MOBILE ELEMENTS ---
  const mobGuest = document.getElementById("mobile-guest-view");
  const mobUser = document.getElementById("mobile-user-view");
  const mobEmail = document.getElementById("mobile-user-email");
  const mobLogout = document.getElementById("mobile-logout-btn");
  const mobExclusive = document.getElementById("mobile-exclusive-item");

  // --- PAGE CONTENT ELEMENTS ---
  const exclusiveContent = document.getElementById("exclusiveContent");
  const authRequired = document.getElementById("authRequired");
  const loader = document.getElementById("authLoader"); // Optional: if you added the loader

  // 1. ATTACH LOGOUT LISTENERS (Desktop & Mobile)
  // We use cloneNode to safely remove old event listeners before adding new ones
  if (logoutBtn) {
    const newBtn = logoutBtn.cloneNode(true);
    logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);
    newBtn.addEventListener("click", handleLogout);
  }
  if (mobLogout) {
    const newMobBtn = mobLogout.cloneNode(true);
    mobLogout.parentNode.replaceChild(newMobBtn, mobLogout);
    newMobBtn.addEventListener("click", handleLogout);
  }

  // 2. MAIN AUTH LOGIC
  if (user) {
    // --- USER IS LOGGED IN ---

    // A. Update Desktop UI
    if (guestView) guestView.classList.add("hidden");
    if (userView) userView.classList.remove("hidden");
    if (userDisplay) userDisplay.textContent = user.email;

    // B. Update Mobile UI
    if (mobGuest) mobGuest.classList.add("hidden");
    if (mobUser) mobUser.classList.remove("hidden");
    if (mobEmail) mobEmail.textContent = user.email;

    // C. Check Database for "Approved" Status
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const isApproved = userDoc.exists() && userDoc.data().status === "approved";

      // Hide Loader if present
      if (loader) loader.classList.add("hidden");

      if (isApproved) {
        // --- UNLOCK EVERYTHING ---
        
        // Show Nav Items
        if (exclusiveNavItem) exclusiveNavItem.classList.remove("hidden");
        if (mobExclusive) mobExclusive.classList.remove("hidden");
        
        // Show Page Content
        if (exclusiveContent) exclusiveContent.classList.remove("hidden");
        if (authRequired) authRequired.classList.add("hidden");

      } else {
        // --- PENDING APPROVAL ---
        // User is logged in, but not approved yet. Treat mostly like guest but show status.
        
        // Hide Nav Items
        if (exclusiveNavItem) exclusiveNavItem.classList.add("hidden");
        if (mobExclusive) mobExclusive.classList.add("hidden");
        
        // Lock Page Content
        if (exclusiveContent) exclusiveContent.classList.add("hidden");
        if (authRequired) {
             authRequired.classList.remove("hidden");
             // Update text to indicate pending status
             const title = authRequired.querySelector('h1, h2');
             const text = authRequired.querySelector('p');
             if(title) title.textContent = "Access Pending";
             if(text) text.textContent = "Your account is currently awaiting administrator approval. Please check back later.";
        }
      }
    } catch (error) {
      console.error("Auth check failed:", error);
    }

  } else {
    // --- GUEST (NOT LOGGED IN) ---
    
    // Hide Loader
    if (loader) loader.classList.add("hidden");

    // A. Reset Desktop UI
    if (guestView) guestView.classList.remove("hidden");
    if (userView) userView.classList.add("hidden");

    // B. Reset Mobile UI
    if (mobGuest) mobGuest.classList.remove("hidden");
    if (mobUser) mobUser.classList.add("hidden");

    // C. Lock Everything
    if (exclusiveNavItem) exclusiveNavItem.classList.add("hidden");
    if (mobExclusive) mobExclusive.classList.add("hidden");
    
    if (exclusiveContent) exclusiveContent.classList.add("hidden");
    if (authRequired) {
      authRequired.classList.remove("hidden");
      // Reset text to default "Login Required"
      const title = authRequired.querySelector('h1, h2');
      const text = authRequired.querySelector('p');
      if(title) title.textContent = "Authentication Required";
      if(text) text.textContent = "You need to be logged in to view this exclusive content.";
    }
  }
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