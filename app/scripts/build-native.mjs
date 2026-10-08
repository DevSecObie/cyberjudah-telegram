import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const result = spawnSync("npm", ["run", "build", "--", "--outDir", "dist-native"], { stdio: "inherit", env: { ...process.env, CYBERJUDAH_APP_BASE: "/", VITE_NATIVE_BUILD: "true" } });
if (result.status !== 0) process.exit(result.status ?? 1);
// Native binaries bundle their code; they do not depend on a remote executable Telegram SDK.
const entry = new URL("../dist-native/index.html", import.meta.url);
writeFileSync(entry, readFileSync(entry, "utf8").replace(/\s*<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^\"]*"><\/script>/, ""));
