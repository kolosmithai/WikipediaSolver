/**
 * Firebase Configuration
 * The Wikipedia Game
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged,
    updateProfile,
    signInWithRedirect,
    getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    runTransaction,
    increment,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    collection,
    getDocs,
    onSnapshot,
    deleteDoc,
    deleteField,
    getCountFromServer,
    addDoc,
    writeBatch,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDKlLhz8XHiFb133d3n1nNCP5ib3G6D_G4",
    authDomain: "wikipedia-game-tw.firebaseapp.com",
    projectId: "wikipedia-game-tw",
    storageBucket: "wikipedia-game-tw.firebasestorage.app",
    messagingSenderId: "211640570574",
    appId: "1:211640570574:web:bb9b57dbaef859833bf69f",
    measurementId: "G-R0QXS9XBWE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Export for use in other modules
export {
    app,
    auth,
    db,
    googleProvider,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    updateProfile,
    signInWithRedirect,
    getRedirectResult,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    runTransaction,
    increment,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    collection,
    getDocs,
    onSnapshot,
    deleteDoc,
    deleteField,
    getCountFromServer,
    addDoc,
    writeBatch,
    Timestamp
};

