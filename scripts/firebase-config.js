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
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
  } else {
    console.error('Firebase SDK not loaded');
  }