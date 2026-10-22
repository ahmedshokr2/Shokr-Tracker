import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwroHBsGlgzOSwKYLRt-aHaxyvHBh9geY",
  authDomain: "shokr-tracker.firebaseapp.com",
  projectId: "shokr-tracker",
  storageBucket: "shokr-tracker.firebasestorage.app",
  messagingSenderId: "864658587950",
  appId: "1:864658587950:web:9db64d40317fc610797abf",
  measurementId: "G-QD8NNQPVNY"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);