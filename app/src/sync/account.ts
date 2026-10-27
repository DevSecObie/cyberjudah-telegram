import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { auth, db } from "../lib/firebase-client";
import { apiURL } from "../native/platform";
import { app, features } from "../tg/sdk";
import { connectPersonalStore, receivePersonalValue } from "../tg/store";
import { DEVICE_MIGRATION_OWNER_KEY, migrateTelegramSource } from "./migration";
import { deviceRecords, readerRecords } from "./records";
import { readLegacyDeviceSnapshot, readTelegramCloudSnapshot } from "./sources";
import { connectReader } from "./reader";

const report = (message: string) => window.dispatchEvent(new CustomEvent("cj:sync-error", { detail: message }));
let generation = 0, pending: ReturnType<typeof start> | undefined;

/** Same bridge as the parked prototype: restore first, mint once, leave refresh to the SDK. */
async function start() {
  const run = ++generation;
  await auth.authStateReady();
  const restored = auth.currentUser;
  const changedAccount = async () => {
    await signOut(auth);
    throw Object.assign(new Error("Account changed. Reopen the app to sign in. Your saved marks are unchanged."), { code: "account_changed" });
  };
  // An unverified launch may only block access here; it never supplies the Firebase UID.
  if (!navigator.onLine && restored && app?.initDataUnsafe.user && restored.uid !== `tg_${app.initDataUnsafe.user.id}`) return changedAccount();
  if (!navigator.onLine && restored?.uid === localStorage.getItem(DEVICE_MIGRATION_OWNER_KEY)) return connectReader(db, restored.uid, receivePersonalValue, report);
  const providerSession = restored && !app;
  const response = providerSession ? await fetch(apiURL("/api/auth/status"), { headers: { authorization: `Bearer ${await restored.getIdToken()}` }, cache: "no-store" }) : await fetch(apiURL(`/api/firebase/${restored ? "identity" : "token"}`), {
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
  const payload = await response.json() as { uid: string; firebaseUid?: string; token?: string };
  const result = providerSession ? { uid: payload.firebaseUid ?? "" } : payload;
  if (!result.uid || result.uid === "." || result.uid === ".." || result.uid.length > 128 || /[\u0000-\u001f/]/.test(result.uid)) throw new Error("Invalid account identity");
  if (restored && restored.uid !== result.uid) return changedAccount();
  if (run !== generation) return null;
  if (!restored) {
    if (!("token" in result) || !result.token) throw new Error("Missing sign-in token");
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
