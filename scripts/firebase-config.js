import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBqT5tJFXj6HG0sSHvnMheKCFhL9e_zh58",
  authDomain: "mypersonalsite-79ce4.firebaseapp.com",
  projectId: "mypersonalsite-79ce4",
  storageBucket: "mypersonalsite-79ce4.firebasestorage.app",
  messagingSenderId: "22661264733",
  appId: "1:22661264733:web:6dd332cad11704c57864b4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
