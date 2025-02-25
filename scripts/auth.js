// Initialize Firebase auth
let auth;

// Wait for Firebase to initialize before setting up auth
document.addEventListener('DOMContentLoaded', () => {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    auth = firebase.auth();
    
    // Set up auth state listener
    auth.onAuthStateChanged(handleAuthStateChanged);
    
    // Set up login form if present
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }
    
    // Set up register form if present
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', handleRegister);
    }
    
    // Set up logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }
  } else {
    console.error('Firebase authentication is not available');
  }
});

// Handle auth state changes
function handleAuthStateChanged(user) {
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (user) {
    // User is signed in
    console.log('User logged in:', user.email);
    
    // Hide login/register, show logout
    if (loginBtn) loginBtn.classList.add('hidden');
    if (registerBtn) registerBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    
    // Show exclusive content if we're on an exclusive page
    const exclusiveContent = document.getElementById('exclusiveContent');
    const authRequired = document.getElementById('authRequired');
    
    if (exclusiveContent && authRequired) {
      exclusiveContent.classList.remove('hidden');
      authRequired.classList.add('hidden');
    }
  } else {
    // User is signed out
    console.log('User logged out');
    
    // Show login/register, hide logout
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (registerBtn) registerBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    
    // Hide exclusive content if we're on an exclusive page
    const exclusiveContent = document.getElementById('exclusiveContent');
    const authRequired = document.getElementById('authRequired');
    
    if (exclusiveContent && authRequired) {
      exclusiveContent.classList.add('hidden');
      authRequired.classList.remove('hidden');
      
      // Use a small delay for better UX
      setTimeout(() => {
        if (!auth.currentUser && window.location.pathname.includes('exclusive')) {
          // Only redirect if we're still not logged in
          window.location.href = 'login.html';
        }
      }, 1500);
    }
  }
}

// Handle login form submission
function handleLogin(e) {
  e.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  
  if (errorMsg) errorMsg.textContent = '';
  
  auth.signInWithEmailAndPassword(email, password)
    .then((userCredential) => {
      // Redirect to exclusive content or home page
      window.location.href = 'exclusive.html';
    })
    .catch((error) => {
      console.error('Login error:', error);
      if (errorMsg) {
        errorMsg.textContent = error.message;
      }
    });
}

// Handle register form submission
function handleRegister(e) {
  e.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const errorMsg = document.getElementById('errorMsg');
  
  if (errorMsg) errorMsg.textContent = '';
  
  // Check if passwords match
  if (password !== confirmPassword) {
    if (errorMsg) {
      errorMsg.textContent = 'Passwords do not match';
    }
    return;
  }
  
  auth.createUserWithEmailAndPassword(email, password)
    .then((userCredential) => {
      // Redirect to exclusive content or home page
      window.location.href = 'exclusive.html';
    })
    .catch((error) => {
      console.error('Registration error:', error);
      if (errorMsg) {
        errorMsg.textContent = error.message;
      }
    });
}

// Handle logout
function handleLogout(e) {
  e.preventDefault();
  
  auth.signOut()
    .then(() => {
      window.location.href = 'index.html';
    })
    .catch((error) => {
      console.error('Logout error:', error);
    });
}