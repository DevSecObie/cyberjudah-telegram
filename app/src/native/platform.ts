import { Capacitor } from "@capacitor/core";

export const native = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform();
export const apiURL = (path: string) => native && path.startsWith("/api/") ? `https://cyberjudah.io${path}` : path;

/** External pages use the system browser, keeping untrusted pages out of the app webview. */
export async function nativeOpen(url: string) {
  const parsed = new URL(url);
  if (!["https:", "mailto:"].includes(parsed.protocol)) throw new Error("Unsupported external link");
  if (parsed.protocol === "mailto:") { window.location.href = url; return; }
  const { Browser } = await import("@capacitor/browser"); await Browser.open({ url });
}
export async function nativeSaveFile(name: string, body: string) {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "_");
  const result = await Filesystem.writeFile({ path: `exports/${safeName}`, data: body, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  await Share.share({ title: "CyberJudah study", files: [result.uri] });
}
