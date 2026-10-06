#!/usr/bin/env node
// Uploads the app's pictures (app/public/people and app/public/timeline/{periods,leaders}) to R2
// under images/, where /api/img/ serves them (bot/src/images.ts). Only new or changed files are
// sent: images/manifest.json in the bucket keeps each key's SHA-256 from the last upload.
// --dry-run lists what would be uploaded. Needs CLOUDFLARE_API_TOKEN with R2 edit, as the deploy has.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { imageKey } from "../src/images.mjs";

const dry = process.argv.includes("--dry-run"), bucket = process.env.AUDIO_BUCKET ?? "cyberjudah-audio";
if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error("Invalid bucket");
const pub = new URL("../../app/public/", import.meta.url).pathname;
const wrangler = (args) => spawnSync("npx", ["wrangler", "r2", "object", ...args, "--remote"], { encoding: "utf8" });

const files = [];
for (const dir of ["people", "timeline/periods", "timeline/leaders"]) {
  let names = [];
  try { names = await fs.readdir(path.join(pub, dir)); } catch { continue; }
  for (const name of names.sort()) {
    const rel = `${dir}/${name}`, key = imageKey(rel);
    if (key) files.push({ rel, key });
  }
}

const tmp = path.join(os.tmpdir(), `cj-images-${process.pid}.json`);
let uploaded = {};
if (!dry && wrangler(["get", `${bucket}/images/manifest.json`, "--file", tmp]).status === 0) {
  try { uploaded = JSON.parse(await fs.readFile(tmp, "utf8")); } catch { uploaded = {}; }
}

const next = {}; let sent = 0;
for (const { rel, key } of files) {
  const file = path.join(pub, rel), sha = createHash("sha256").update(await fs.readFile(file)).digest("hex");
  next[key] = sha;
  if (uploaded[key] === sha) continue;
  if (dry) { console.log(`${key} <- ${rel}`); sent++; continue; }
  const r = wrangler(["put", `${bucket}/${key}`, "--file", file, "--content-type", "image/webp"]);
  if (r.status !== 0) throw new Error(`Upload failed: ${key}\n${r.stderr}`);
  sent++;
}
if (!dry) {
  await fs.writeFile(tmp, JSON.stringify(next));
  if (wrangler(["put", `${bucket}/images/manifest.json`, "--file", tmp, "--content-type", "application/json"]).status !== 0) throw new Error("Could not save images/manifest.json");
}
console.log(`Pictures: ${files.length} in the app, ${sent} ${dry ? "would be " : ""}uploaded.`);
