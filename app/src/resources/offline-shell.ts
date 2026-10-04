import { preserveLegacyBooks } from "@/lib/offline";

/** Offline reading must not require notification permission or a reminder subscription. */
export function registerOfflineShell(basename: string) {
  void preserveLegacyBooks().catch(() => undefined);
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    // prepare-assets serves both / and /app/. The worker's scope must cover the
    // actual reader URL and the compiled asset paths, including either root alias.
    const scope = import.meta.env.BASE_URL === "/" ? "/" : `${basename.replace(/\/$/, "")}/`;
    void navigator.serviceWorker.register(`${scope}sw.js`, { scope })
      .catch(() => undefined); // Storage/privacy restrictions must not stop online reading.
  }
}
