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
  e.preventDefault();

  signOut(auth)
    .then(() => {
      window.location.href = "/";
    })
    .catch((error) => {
      console.error("Logout error:", error);
    });
}

// Handle auth state changes
async function handleAuthStateChanged(user) {
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const exclusiveNavItem = document.getElementById("exclusive-nav-item");

  if (user) {
    // Check if user is approved
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const isApproved = userDoc.exists() && userDoc.data().status === "approved";

      if (loginBtn) loginBtn.classList.add("hidden");
      if (registerBtn) registerBtn.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");

      // Show exclusive content nav item only for approved users
      if (exclusiveNavItem && isApproved) {
        exclusiveNavItem.classList.remove("hidden");
      } else if (exclusiveNavItem) {
        exclusiveNavItem.classList.add("hidden");
      }

      const exclusiveContent = document.getElementById("exclusiveContent");
      const authRequired = document.getElementById("authRequired");

      if (exclusiveContent && authRequired) {
        if (isApproved) {
          exclusiveContent.classList.remove("hidden");
          authRequired.classList.add("hidden");
        } else {
          exclusiveContent.classList.add("hidden");
          authRequired.classList.remove("hidden");
        }
      }
    } catch (error) {
      console.error("Error checking user status:", error);
    }
  } else {
    if (loginBtn) loginBtn.classList.remove("hidden");
    if (registerBtn) registerBtn.classList.remove("hidden");
    if (logoutBtn) logoutBtn.classList.add("hidden");

    // Hide exclusive content nav item when not logged in
    if (exclusiveNavItem) {
      exclusiveNavItem.classList.add("hidden");
    }

    const exclusiveContent = document.getElementById("exclusiveContent");
    const authRequired = document.getElementById("authRequired");

    if (exclusiveContent && authRequired) {
      exclusiveContent.classList.add("hidden");
      authRequired.classList.remove("hidden");

      setTimeout(() => {
        if (!auth.currentUser && window.location.pathname.includes("exclusive")) {
          window.location.href = "/login/";
        }
      }, 1500);
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