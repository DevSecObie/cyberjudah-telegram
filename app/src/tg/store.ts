import { app, features } from "./sdk";
import { readerCollection } from "../sync/records";

/**
 * Where the reader's things live. Preferences and bookmarks go to Telegram's CloudStorage
 * (they follow the account to every device), cached in DeviceStorage / localStorage so a
 * screen renders at once and updates when the cloud answers. Values are strings; keys are
 * 1-128 chars of A-Za-z0-9_-; values up to 4096 bytes; 1024 keys.
 */
type Listener = (value: string | null) => void;
const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, string | null>();
const writes = new Map<string, number>();
type PersonalStore = { get(key: string): string; set(key: string, value: string | null, baseline: string | null): Promise<void>; keys(): string[]; close(): void };
let personal: Promise<PersonalStore | null> = Promise.resolve(null);
let account: PersonalStore | null = null;
let opening = false, failed = false, session = 0;
export function connectPersonalStore(start: Promise<PersonalStore | null>) {
  const run = ++session;
  account?.close(); account = null; opening = true; failed = false;
  for (const key of cache.keys()) if (readerCollection(key)) { emit(key, null); cache.delete(key); }
  personal = start.then(value => { if (run !== session) { value?.close(); return null; } account = value; opening = false; return value; }, error => { if (run === session) { opening = false; failed = true; } throw error; });
  // A failed sign-in leaves source data readable, but never silently writes to old keys.
  void personal.catch(() => {});
}
export const personalStore = () => personal;
export const receivePersonalValue = (key: string, value: string) => emit(key, value);

function local(): globalThis.Storage | null { try { return window.localStorage; } catch { return null; } }

function readDevice(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (features.deviceStorage) app!.DeviceStorage.getItem(key, (err, v) => resolve(err ? null : v ?? null));
    else { try { resolve(local()?.getItem(`cj:${key}`) ?? null); } catch { resolve(null); } }
  });
}
function writeDevice(key: string, value: string | null) {
  if (features.deviceStorage) { if (value === null) app!.DeviceStorage.removeItem(key); else app!.DeviceStorage.setItem(key, value); }
  // Keep an enumerable mirror: Telegram DeviceStorage has no getKeys operation.
  try {
    const l = local(); if (!l) return; if (value === null) l.removeItem(`cj:${key}`); else l.setItem(`cj:${key}`, value);
  } catch (error) {
    // A full browser mirror must not interrupt a successful Telegram write.
    if (!features.deviceStorage) throw error;
  }
}
function readCloud(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!features.cloud) return resolve(null);
    app!.CloudStorage.getItem(key, (err, v) => resolve(err ? null : v ?? null));
  });
}

function emit(key: string, value: string | null) {
  cache.set(key, value);
  listeners.get(key)?.forEach((l) => l(value));
}

export const store = {
  hasPersonalKey: (key: string) => account?.keys().includes(key) ?? false,
  /** Read: device copy now, cloud copy when it arrives (and differs). */
  async get(key: string): Promise<string | null> {
    if (readerCollection(key)) {
      const synced = await personal.catch(() => null);
      if (synced) return cache.get(key) ?? synced.get(key);
    }
    if (cache.has(key)) return cache.get(key)!;
    const revision = writes.get(key) ?? 0;
    const v = await readDevice(key);
    if ((writes.get(key) ?? 0) !== revision) return cache.get(key) ?? null;
    cache.set(key, v);
    void readCloud(key).then((c) => {
      if ((writes.get(key) ?? 0) === revision && c !== null && c !== v) {
        emit(key, c);
        try { if (!(failed && readerCollection(key))) writeDevice(key, c); } catch { /* Cloud data remains available in memory if the device is full. */ }
      }
    });
    return v;
  },
  set(key: string, value: string | null) {
    if (readerCollection(key) && opening) {
      const baseline = cache.get(key) ?? null;
      void personal.then(synced => synced ? synced.set(key, value, baseline) : store.set(key, value))
        .catch(() => window.dispatchEvent(new CustomEvent("cj:sync-error", { detail: "This change could not sync. Your original saved marks are unchanged." })));
      return;
    }
    if (readerCollection(key) && failed) {
      window.dispatchEvent(new CustomEvent("cj:sync-error", { detail: "Account sync is unavailable. Reopen the app before editing this mark." }));
      return;
    }
    if (readerCollection(key) && account) {
      const baseline = cache.get(key) ?? account.get(key);
      // Emit only after the snapshot is ready; hydration cannot replace a just-saved edit.
      void account.set(key, value, baseline).catch(() => window.dispatchEvent(new CustomEvent("cj:sync-error", { detail: "This change could not sync. Keep this page open and try again when connected." })));
      return;
    }
    writes.set(key, (writes.get(key) ?? 0) + 1);
    writeDevice(key, value);
    emit(key, value);
    if (features.cloud) { if (value === null) app!.CloudStorage.removeItem(key); else app!.CloudStorage.setItem(key, value); }
  },
  subscribe(key: string, l: Listener): () => void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(l);
    return () => { listeners.get(key)?.delete(l); };
  },
  /** Cloud plus this browser's saved keys; browser-only backups must not be empty. */
  async keys(): Promise<string[]> {
    const cloud = await new Promise<string[]>((resolve) => { if (!features.cloud) return resolve([]); app!.CloudStorage.getKeys((err, k) => resolve(err ? [] : k ?? [])); });
    let device: string[] = [];
    try { device = Object.keys(local() ?? {}).filter(k => k.startsWith("cj:")).map(k => k.slice(3)); } catch { /* Restricted browser storage; cloud and cached keys remain available. */ }
    const synced = await personal.catch(() => null);
    return [...new Set([...(synced?.keys() ?? []), ...cloud, ...device, ...[...cache.keys()].filter(k => cache.get(k) !== null)])];
  },
};

/** JSON on top of the store, with a default. */
export const json = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const v = await store.get(key);
    if (v === null) return fallback;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
  set<T>(key: string, value: T) { store.set(key, JSON.stringify(value)); },
};

/**
 * Secure storage (9.0) holds things that must not leave the device in the clear: here the
 * app's lock preference token for biometrics. Falls back to nothing.
 */
export const secure = {
  get(key: string): Promise<string | null> {
    return new Promise((resolve) => { if (!features.secureStorage) return resolve(null); app!.SecureStorage.getItem(key, (err, v) => resolve(err ? null : v ?? null)); });
  },
  set(key: string, value: string | null) {
    if (!features.secureStorage) return;
    if (value === null) app!.SecureStorage.removeItem(key); else app!.SecureStorage.setItem(key, value);
  },
};
