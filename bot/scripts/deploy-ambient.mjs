#!/usr/bin/env node
// Prepare licensed loops with scripts/audio/prepare-ambient.py before deployment.
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.env.AMBIENT_EXPORT_DIR;
if (!root) { console.log("Ambient unchanged (AMBIENT_EXPORT_DIR is not set)."); process.exit(0); }
const dry = process.argv.includes("--dry-run"), bucket = process.env.AUDIO_BUCKET ?? "cyberjudah-audio";
if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error("Invalid audio bucket");
const tracks = ["quiet-piano", "soft-keys", "stillness", "evening-pad", "rain", "wind", "ocean", "fire"];
const registry = await fs.readFile(new URL("../../app/src/lib/ambient.ts", import.meta.url), "utf8");
for (const id of tracks) {
  const file = path.join(root, `${id}.m4a`), bytes = await fs.readFile(file);
  const line = registry.split("\n").find((s) => s.includes(`id: "${id}"`) || s.includes(`"id": "${id}"`));
  const expected = /"?sha256"?: "([a-f0-9]+)"/.exec(line ?? "")?.[1];
  if (bytes.length > 3_100_000 || createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`${id}: size/checksum mismatch; review the prepared loop before publishing`);
  if (dry) { console.log(`ambient/${id}.m4a <- ${file}`); continue; }
  const r = spawnSync("npx", ["wrangler", "r2", "object", "put", `${bucket}/ambient/${id}.m4a`, "--file", file, "--content-type", "audio/mp4", "--remote"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Upload failed: ${id}`);
}
