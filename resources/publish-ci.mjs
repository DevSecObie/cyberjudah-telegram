import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { signInitData } from "../bot/src/initdata.mjs";
import { publishArtifact } from "./publish.mjs";

/** Called only by the manually dispatched, production-approved publication job. */
export async function publicationLaunch(env) {
  const first = (env.ADMIN_IDS ?? "").split(",").map(x => x.trim()).find(x => /^\d+$/.test(x));
  const id = Number(first);
  if (!env.BOT_TOKEN || !Number.isSafeInteger(id) || id <= 0) throw new Error("BOT_TOKEN and a configured ADMIN_IDS account are required for approved resource publication.");
  return signInitData({ user: { id, first_name: "Resource publication" }, auth_date: String(Math.floor(Date.now() / 1000)) }, env.BOT_TOKEN);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), output = args[args.indexOf("--bundle") + 1];
  if (!args.includes("--bundle") || !output) throw new Error("Pass --bundle with the verified artifact directory.");
  const initData = await publicationLaunch(process.env);
  const result = await publishArtifact({ output: path.resolve(output), bucket: "cyberjudah-audio", api: new URL(process.env.WORKER_URL || "https://cyberjudah.io").origin, execute: true, initData,
    upload: async (bucket, key, file) => execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", file.endsWith(".json") ? "application/json" : "application/x-ndjson", "--remote"], { stdio: ["ignore", "ignore", "inherit"] }) });
  console.log(`::notice::Published ${result.published.resources.length} resource releases at catalog revision ${result.published.revision}.`);
}
