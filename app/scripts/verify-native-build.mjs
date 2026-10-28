import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { nativeTarget } from "../../shared/native-target.mjs";
const target = nativeTarget(process.env.CYBERJUDAH_NATIVE_ENV || "production");
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const manifest = read("../dist-native/native-build.json"), configured = read("../native-environment.json");
for (const value of [manifest, configured]) for (const key of ["environment", "appId", "appName", "origin", "syncScope", "profile", "paidAsk"]) {
  if (value[key] !== target[key]) throw new Error(`Native ${key} does not match the selected ${target.environment} build`);
}
for (const path of ["../android/app/src/main/assets/capacitor.config.json", "../ios/App/App/capacitor.config.json"]) {
  const value = read(path);
  if (value.appId !== target.appId || value.appName !== target.appName || value.server?.url) throw new Error("Native config must use the selected app ID and bundled code");
}
if (process.argv.includes("--android")) {
  if (read("../android/app/build/outputs/apk/debug/output-metadata.json").applicationId !== target.appId) throw new Error("Built APK has the wrong application ID");
}
const ios = process.argv.indexOf("--ios");
if (ios >= 0) {
  const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", process.argv[ios + 1]], { encoding: "utf8" }));
  if (plist.CFBundleIdentifier !== target.appId || plist.CFBundleDisplayName !== target.appName) throw new Error("Built iOS app has the wrong identifier or display name");
}
console.log(`${target.appName}: verified identifier, API origin, sign-in origin, data scope and bundled code`);
