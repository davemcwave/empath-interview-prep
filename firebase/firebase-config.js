/**
 * Firebase Configuration
 *
 * TODO: Replace the config values below with your Firebase project config.
 * Find these in Firebase Console > Project Settings > General > Your apps > Web app.
 */
const firebaseConfig = {
  apiKey: "AIzaSyAdrQYqHgg6ovFQkOsd_UFPiFybYqpLZQA",
  authDomain: "empath-e6f1b.firebaseapp.com",
  projectId: "empath-e6f1b",
  storageBucket: "empath-e6f1b.firebasestorage.app",
  messagingSenderId: "30535211725",
  appId: "1:30535211725:web:59db30258d98c95ba2a784"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
