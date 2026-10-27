import { initializeApp } from "firebase/app";
import { connectAuthEmulator, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
const emulator = import.meta.env.VITE_FIREBASE_EMULATOR === "true" && ["localhost", "127.0.0.1"].includes(location.hostname);
const firebase = initializeApp({
  apiKey: emulator ? "demo-key" : "AIzaSyAqCIfm78KkoFq0UOszT5YJdpvD6jWqG9U",
  authDomain: "cyberjudah-app.firebaseapp.com", projectId: emulator ? "demo-cyberjudah" : "cyberjudah-app",
  appId: "1:979802439968:web:67bc0435f68d70a4959745",
});
export const auth = initializeAuth(firebase, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence] });
export const db = initializeFirestore(firebase, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (emulator) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8089); }
