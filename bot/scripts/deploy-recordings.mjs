#!/usr/bin/env node
// Called by deploy with RECORDINGS_EXPORT_DIR set to recordings.py export's output.
// Upload media and indexes first, then publish the catalog as the commit point.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
process.on("uncaughtException", error => {
  console.error(`::error::${String(error.message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
  process.exitCode = 1;
});
const root = process.env.RECORDINGS_EXPORT_DIR;
if (!root) { console.log("Recordings unchanged (RECORDINGS_EXPORT_DIR is not set)."); process.exit(0); }
const dry = process.argv.includes("--dry-run");
const catalog = JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8"));
const bucket = process.env.AUDIO_BUCKET ?? "cyberjudah-audio";
if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error("Invalid audio bucket");
const uploads = [];
for (const chapter of catalog.chapters) {
  if (!/^recordings\/[a-z0-9-]+\/[a-z0-9-]+\/[1-9][0-9]{0,2}\.m4a$/.test(chapter.audio) || !/^[a-z0-9-]+\/[a-z0-9-]+\/[1-9][0-9]{0,2}\.json$/.test(chapter.index)) throw new Error("Invalid recording key");
  const file = path.join(root, chapter.audio), bytes = await fs.readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== chapter.sha256 || bytes.length !== chapter.bytes) throw new Error(`Recording checksum mismatch: ${file}`);
  if (!chapter.source?.startsWith("https://") || !chapter.license?.startsWith("https://")) throw new Error("Missing licence evidence");
  const index = path.join(root, "indexes", chapter.index);
  await fs.access(index);
  uploads.push([chapter.audio, file, "audio/mp4"], [`recordings/index/${chapter.index}`, index, "application/json"]);
}
uploads.push(["recordings/catalog.json", path.join(root, "catalog.json"), "application/json"]);
for (const [key, file, type] of uploads) {
  if (dry) { console.log(`${key} <- ${file}`); continue; }
  let uploaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", type, "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status === 0) { uploaded = true; break; }
    // Wrangler's normal CLI errors contain the failed API operation, never the token.
    const detail = String(r.error?.message || r.stderr || r.stdout).replace(/\x1b\[[0-9;]*m/g, "").slice(-1600);
    console.error(`::warning::Upload attempt ${attempt} for ${key}: ${detail.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
  if (!uploaded) throw new Error(`Upload failed: ${key}; catalog not advanced`);
}
console.log(`::notice::${dry ? "Verified" : "Published"} ${catalog.chapters.length} narration chapters; catalog written last.`);
