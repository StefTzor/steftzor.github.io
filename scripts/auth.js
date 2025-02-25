import { auth, db } from "./firebase-config.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

import { 
  doc, 
  setDoc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

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

    // Get user status from Firestore
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.status !== "approved") {
        await signOut(auth);
        if (errorMsg) {
          errorMsg.textContent = "Your account is pending approval. Please wait for an administrator.";
        }
        return;
      }
    }

    // Redirect to exclusive content or home page
    window.location.href = "exclusive.html";
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
    const message = document.getElementById("message");
    if (message) {
      message.textContent = "Registration successful! Your account is pending approval.";
      message.classList.remove("hidden");
    }

    // Redirect to login
    window.location.href = "login.html";
  } catch (error) {
    console.error("Registration error:", error);
    errorMsg.textContent = error.message;
  }
}

// Handle logout
function handleLogout(e) {
  e.preventDefault();

  signOut(auth)
    .then(() => {
      window.location.href = "index.html";
    })
    .catch((error) => {
      console.error("Logout error:", error);
    });
}

// Handle auth state changes
function handleAuthStateChanged(user) {
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (user) {
    console.log("User logged in:", user.email);

    if (loginBtn) loginBtn.classList.add("hidden");
    if (registerBtn) registerBtn.classList.add("hidden");
    if (logoutBtn) logoutBtn.classList.remove("hidden");

    const exclusiveContent = document.getElementById("exclusiveContent");
    const authRequired = document.getElementById("authRequired");

    if (exclusiveContent && authRequired) {
      exclusiveContent.classList.remove("hidden");
      authRequired.classList.add("hidden");
    }
  } else {
    console.log("User logged out");

    if (loginBtn) loginBtn.classList.remove("hidden");
    if (registerBtn) registerBtn.classList.remove("hidden");
    if (logoutBtn) logoutBtn.classList.add("hidden");

    const exclusiveContent = document.getElementById("exclusiveContent");
    const authRequired = document.getElementById("authRequired");

    if (exclusiveContent && authRequired) {
      exclusiveContent.classList.add("hidden");
      authRequired.classList.remove("hidden");

      setTimeout(() => {
        if (!auth.currentUser && window.location.pathname.includes("exclusive")) {
          window.location.href = "login.html";
        }
      }, 1500);
    }
  }
}
