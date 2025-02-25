// Import Firebase functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyClGWoUvHfFAIYF5ms956GFhovlopncH8k",
  authDomain: "mypersonalsite-79ce4.firebaseapp.com",
  projectId: "mypersonalsite-79ce4",
  storageBucket: "mypersonalsite-79ce4.firebasestorage.app",
  messagingSenderId: "22661264733",
  appId: "1:22661264733:web:706659ef5ffcdd057864b4"
};
  
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export the initialized instances so other scripts can use them
export { auth, db };