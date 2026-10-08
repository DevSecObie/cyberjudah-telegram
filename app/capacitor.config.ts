import type { CapacitorConfig } from "@capacitor/cli";

/** Provisional CyberJudah identifier. Register this under the owner's accounts before signing. */
const config: CapacitorConfig = {
  appId: "io.cyberjudah.app",
  appName: "CyberJudah",
  webDir: "dist-native",
  server: { androidScheme: "https", cleartext: false },
  ios: { contentInset: "never", preferredContentMode: "mobile" },
  android: { allowMixedContent: false },
};
export default config;
