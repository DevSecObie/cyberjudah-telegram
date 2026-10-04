import { preserveLegacyBooks } from "@/lib/offline";

/** Offline reading must not require notification permission or a reminder subscription. */
export function registerOfflineShell() {
  void preserveLegacyBooks().catch(() => undefined);
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined); // Storage/privacy restrictions must not stop online reading.
  }
}
