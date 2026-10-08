import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { app, features } from "../tg/sdk";
import { connectPersonalStore, receivePersonalValue } from "../tg/store";
import { DEVICE_MIGRATION_OWNER_KEY, migrateTelegramSource } from "./migration";
import { deviceRecords, readerRecords } from "./records";
import { readLegacyDeviceSnapshot, readTelegramCloudSnapshot } from "./sources";
import { connectReader } from "./reader";

const emulator = import.meta.env.VITE_FIREBASE_EMULATOR === "true" && ["localhost", "127.0.0.1"].includes(location.hostname);
const firebase = initializeApp({
  apiKey: emulator ? "demo-key" : "AIzaSyAqCIfm78KkoFq0UOszT5YJdpvD6jWqG9U",
  authDomain: "cyberjudah-app.firebaseapp.com", projectId: emulator ? "demo-cyberjudah" : "cyberjudah-app",
  appId: "1:979802439968:web:67bc0435f68d70a4959745",
});
const auth = getAuth(firebase);
const db = initializeFirestore(firebase, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (emulator) { connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8089); }
const report = (message: string) => window.dispatchEvent(new CustomEvent("cj:sync-error", { detail: message }));
let generation = 0, pending: ReturnType<typeof start> | undefined;

/** Same bridge as the parked prototype: restore first, mint once, leave refresh to the SDK. */
async function start() {
  const run = ++generation;
  await auth.authStateReady();
  const restored = auth.currentUser;
  if (!navigator.onLine && restored?.uid === localStorage.getItem(DEVICE_MIGRATION_OWNER_KEY)) return connectReader(db, restored.uid, receivePersonalValue, report);
  const response = await fetch(`/api/firebase/${restored ? "identity" : "token"}`, {
    method: "POST", headers: app?.initData ? { authorization: `tma ${app.initData}` } : {},
    cache: "no-store", credentials: "same-origin",
  });
  if (run !== generation) return null;
  if (response.status === 401) {
    await signOut(auth);
    if (restored || app?.initData) throw new Error("Sign-in expired. Reopen Telegram or sign in again before editing. Your saved marks are unchanged.");
    return null;
  }
  if (!response.ok) throw new Error("Account sync is unavailable. Your saved marks are unchanged.");
  const result = await response.json() as { uid: string; token?: string };
  if (!/^tg_[1-9][0-9]*$/.test(result.uid)) throw new Error("Invalid account identity");
  if (restored && restored.uid !== result.uid) throw new Error("Sign out before switching accounts. No saved data was moved.");
  if (run !== generation) return null;
  if (!restored) {
    if (!result.token) throw new Error("Missing sign-in token");
    await signInWithCustomToken(auth, result.token);
  }
  if (run !== generation) { await signOut(auth); return null; }
  if (auth.currentUser?.uid !== result.uid) throw new Error("The account changed during sign-in; no data was moved.");
  const uid = result.uid, currentUid = () => run === generation ? auth.currentUser?.uid : undefined;
  const common = { db, uid, deviceStore: localStorage, currentUid };
  // Once bound, this device's original data can never be imported into a second account.
  if (!localStorage.getItem(DEVICE_MIGRATION_OWNER_KEY)) localStorage.setItem(DEVICE_MIGRATION_OWNER_KEY, uid);
  if (app && features.cloud) await migrateTelegramSource({ ...common, source: "cloudStorage", cloudStorageScope: import.meta.env.VITE_ACCOUNT_SYNC_SCOPE === "staging" ? "staging" : "app", readAndConvert: async () => readerRecords(await readTelegramCloudSnapshot(app!.CloudStorage)) });
  if (localStorage.getItem(DEVICE_MIGRATION_OWNER_KEY) === uid) await migrateTelegramSource({ ...common, source: "indexedDB", readAndConvert: async () => deviceRecords(await readLegacyDeviceSnapshot(indexedDB, localStorage), uid) });
  if (currentUid() !== uid) return null;
  const reader = await connectReader(db, uid, (key, value) => { if (run === generation) receivePersonalValue(key, value); }, report);
  if (currentUid() !== uid) { reader.close(); return null; }
  const unsubscribe = onAuthStateChanged(auth, user => {
    if (user?.uid !== uid) { reader.close(); connectPersonalStore(Promise.resolve(null)); unsubscribe(); }
  });
  return reader;
}
export function startAccountSync() {
  return pending ??= start().catch(error => {
    report(error instanceof Error ? error.message : "Account sync could not start.");
    throw error;
  });
}
export async function stopAccountSync() {
  generation++; connectPersonalStore(Promise.resolve(null)); pending = undefined;
  await signOut(auth);
}
