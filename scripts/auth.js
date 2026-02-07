import { auth, db } from "./firebase-config.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

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
    console.error("Login error:", error);
    if (errorMsg) {
      errorMsg.textContent = error.message;
    }
  }
}

// Handle registration
async function handleRegister(e) {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const errorMsg = document.getElementById("errorMsg");

  if (errorMsg) errorMsg.textContent = "";

  if (password !== confirmPassword) {
    errorMsg.textContent = "Passwords do not match";
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Store user status in Firestore as "pending"
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    // Sign out the user immediately
    await signOut(auth);

    // Show message
    const errorMsg = document.getElementById("errorMsg");
    if (errorMsg) {
      errorMsg.textContent = "Registration successful! Your account is pending approval. Please wait for an administrator to approve your registration.";
      errorMsg.classList.remove("hidden");
    }

  } catch (error) {
    console.error("Registration error:", error);
    if (error.code === 'auth/email-already-in-use') {
      errorMsg.textContent = "The email address is already in use by another account.";
    } else {
      errorMsg.textContent = error.message;
    }
  }
}

// Handle logout
function handleLogout(e) {
  if (e) e.preventDefault();
  signOut(auth).then(() => {
    // Force reload to clear any cached states
    window.location.href = "/login/";
  }).catch((error) => {
    console.error("Logout error:", error);
  });
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
             const title = authRequired.querySelector('h2');
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
      const title = authRequired.querySelector('h2');
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
    console.error("Approval error:", error);
    if (errorMsg) {
      errorMsg.textContent = error.message;
    }
  }
}