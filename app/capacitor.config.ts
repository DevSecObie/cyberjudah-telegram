import type { CapacitorConfig } from "@capacitor/cli";
import { nativeTarget } from "../shared/native-target.mjs";
const target = nativeTarget(process.env.CYBERJUDAH_NATIVE_ENV || "production");

/** Provisional CyberJudah identifier. Register this under the owner's accounts before signing. */
const config: CapacitorConfig = {
  appId: target.appId,
  appName: target.appName,
  webDir: "dist-native",
  server: { androidScheme: "https", cleartext: false },
  ios: { contentInset: "never", preferredContentMode: "mobile" },
  android: { allowMixedContent: false },
};
export default config;
