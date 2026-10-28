import { Capacitor } from "@capacitor/core";
import { nativeTarget, nativeAccountURL } from "@shared/native-target.mjs";

export const native = Capacitor.isNativePlatform();
export const nativeBuild = nativeTarget(import.meta.env.VITE_NATIVE_ENV || "production");
export const deviceSignInURL = (code: string) => nativeAccountURL(nativeBuild.environment, code);
/** Start authentication in the default browser, so its popup and callback share browser storage. */
export async function openDeviceSignIn(code: string) {
  const { AppLauncher } = await import("@capacitor/app-launcher");
  const result = await AppLauncher.openUrl({ url: deviceSignInURL(code) });
  if (!result.completed) throw new Error("browser_open_failed");
}
/** Bundled native profile: public reading plus linked-account Ask; purchases require a store billing integration. */
export const nativeReader = native || import.meta.env.VITE_NATIVE_BUILD === "true";
export const readerRouteAllowed = (path: string) => !nativeReader || !/^\/(settings\/(donate|reminders|admin|requests))(?:[/?#]|$)/.test(path);
export const nativePlatform = Capacitor.getPlatform();
const publicReading = /^\/api\/(?:(search|teachings|live|recent)(?:[?]|$)|(taught|transcript|visuals)\/)/;
export const apiURL = (path: string) => {
  const target = nativeReader && publicReading.test(path) ? path.replace("/api/", "/api/reader/") : path;
  return native && target.startsWith("/api/") ? `${nativeBuild.origin}${target}` : target;
};

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
