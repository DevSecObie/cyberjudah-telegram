import { spawnSync } from "node:child_process";
import { nativeTarget } from "../../shared/native-target.mjs";
const argument = process.argv[2];
if (argument && !argument.startsWith("--environment=")) throw new Error("Use --environment=staging or --environment=production");
const target = nativeTarget(argument?.slice("--environment=".length) || process.env.CYBERJUDAH_NATIVE_ENV || "production");
const env = { ...process.env, CYBERJUDAH_NATIVE_ENV: target.environment };
for (const [command, args] of [["npm", ["run", "build:native"]], ["npx", ["cap", "sync"]]]) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
