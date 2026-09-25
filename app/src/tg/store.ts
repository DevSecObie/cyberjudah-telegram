import { app, features } from "./sdk";

/**
 * Where the reader's things live. Preferences and bookmarks go to Telegram's CloudStorage
 * (they follow the account to every device), cached in DeviceStorage / localStorage so a
 * screen renders at once and updates when the cloud answers. Values are strings; keys are
 * 1-128 chars of A-Za-z0-9_-; values up to 4096 bytes; 1024 keys.
 */
type Listener = (value: string | null) => void;
const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, string | null>();

function local(): globalThis.Storage | null { try { return window.localStorage; } catch { return null; } }

function readDevice(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (features.deviceStorage) app!.DeviceStorage.getItem(key, (err, v) => resolve(err ? null : v ?? null));
    else resolve(local()?.getItem(`cj:${key}`) ?? null);
  });
}
function writeDevice(key: string, value: string | null) {
  if (features.deviceStorage) { if (value === null) app!.DeviceStorage.removeItem(key); else app!.DeviceStorage.setItem(key, value); }
  else { const l = local(); if (!l) return; if (value === null) l.removeItem(`cj:${key}`); else l.setItem(`cj:${key}`, value); }
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
  /** Read: device copy now, cloud copy when it arrives (and differs). */
  async get(key: string): Promise<string | null> {
    if (cache.has(key)) return cache.get(key)!;
    const v = await readDevice(key);
    cache.set(key, v);
    void readCloud(key).then((c) => { if (c !== null && c !== v) { writeDevice(key, c); emit(key, c); } });
    return v;
  },
  set(key: string, value: string | null) {
    emit(key, value);
    writeDevice(key, value);
    if (features.cloud) { if (value === null) app!.CloudStorage.removeItem(key); else app!.CloudStorage.setItem(key, value); }
  },
  subscribe(key: string, l: Listener): () => void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(l);
    return () => { listeners.get(key)?.delete(l); };
  },
  /** Everything in the cloud, for the settings screen's backup. */
  async keys(): Promise<string[]> {
    return new Promise((resolve) => { if (!features.cloud) return resolve([]); app!.CloudStorage.getKeys((err, k) => resolve(err ? [] : k ?? [])); });
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
