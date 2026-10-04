#!/usr/bin/env node
/** Local test data only. This program never fetches data or writes to R2. */
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const {
  CatalogSchema, ManifestSchema, MAX_CATALOG_BYTES, MAX_MANIFEST_BYTES,
  parseShard, releasePrefix, sha256,
} = await import(new URL("../shared/resources.ts", import.meta.url).href);

const repository = fileURLToPath(new URL("../", import.meta.url));
const fixtureUrl = "https://example.invalid/local-fixture";
const encoder = new TextEncoder();
const encodeJson = (value) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
const encodeRows = (rows) => encoder.encode(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

/** Relative filenames and bytes are stable across machines, paths and dates. */
export async function createFixtureFiles() {
  const files = new Map();
  const objects = [];
  const catalogs = [];

  async function addObject(key, bytes, contentType, integrity) {
    const file = `objects/${key}`;
    if (files.has(file)) throw new Error(`Duplicate fixture object: ${key}`);
    files.set(file, bytes);
    objects.push({ key, file, bytes: bytes.byteLength, sha256: await sha256(bytes), contentType, integrity });
  }

  async function release(id, version, kind, title, shards, corrupt = false) {
    const prefix = releasePrefix(id, version);
    const parts = [];
    for (const [name, rows] of shards) {
      const bytes = encodeRows(rows);
      parts.push({ path: name, sha256: await sha256(bytes), bytes: bytes.byteLength, records: rows.length });
    }
    const sourceBytes = encodeRows(shards.flatMap(([, rows]) => rows));
    const manifest = ManifestSchema.parse({
      schemaVersion: 1, id, release: version, kind, title, language: "en-US",
      source: [{ url: fixtureUrl, revision: "synthetic-local-fixture-v1", sha256: await sha256(sourceBytes) }],
      license: [{
        id: "public-domain", url: fixtureUrl,
        attribution: "Synthetic local test fixtures only; no third-party dataset. This test metadata does not establish any production dataset's license.",
        modifications: "Created solely to exercise local resource installation, updates and checksum rejection.",
      }],
      approval: { reference: fixtureUrl, approvedBy: "LOCAL TEST FIXTURE ONLY; NOT PRODUCTION APPROVAL" },
      parts,
    });
    const manifestBytes = encodeJson(manifest);
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("Fixture manifest exceeds contract limit");
    await addObject(`${prefix}manifest.json`, manifestBytes, "application/json; charset=utf-8", "valid");

    for (let i = 0; i < shards.length; i++) {
      const bytes = encodeRows(shards[i][1]);
      await parseShard(bytes, manifest.parts[i], kind);
      if (corrupt && i === 0) {
        // Change an ASCII letter without changing length or JSON validity. The
        // manifest deliberately keeps the original checksum, as a damaged CDN
        // response would. No actual scripture or dataset is involved.
        const bad = bytes.slice();
        const location = new TextDecoder().decode(bytes).indexOf("Synthetic");
        if (location < 0) throw new Error("Missing corruption target");
        bad[location] = "X".charCodeAt(0);
        let rejected = false;
        try { await parseShard(bad, manifest.parts[i], kind); } catch (error) {
          if (!/checksum or size mismatch/.test(error.message)) throw error;
          rejected = true;
        }
        if (!rejected) throw new Error("Corrupt fixture unexpectedly passed validation");
        await addObject(`${prefix}${manifest.parts[i].path}`, bad, "application/x-ndjson; charset=utf-8", "intentional-checksum-mismatch");
      } else {
        await addObject(`${prefix}${manifest.parts[i].path}`, bytes, "application/x-ndjson; charset=utf-8", "valid");
      }
    }
    return { id, release: version, manifestSha256: await sha256(manifestBytes) };
  }

  const dictionaryShards = (revision) => [
    ["alpha.ndjson", [{ key: "local-fixture/alpha", data: {
      fixtureOnly: true, title: "Synthetic fixture Alpha", revision,
      definition: revision === 1 ? "Local dictionary fixture before an update." : "Local dictionary fixture after an update.",
    } }]],
    ["beta.ndjson", [{ key: "local-fixture/beta", data: {
      fixtureOnly: true, title: "Synthetic fixture Beta", revision,
      definition: "A second local record tests installation across multiple shards.",
    } }]],
  ];
  const reference = await release("local-fixture-reference", "fixture-v1", "reference", "Local fixture reference (test only)", [
    ["reference.ndjson", [{ key: "local-fixture/reference", data: {
      fixtureOnly: true, title: "Synthetic fixture reference",
      text: "Local reference lookup fixture. This is not scripture or a historical claim.",
    } }]],
  ]);
  const first = await release("local-fixture-dictionary", "fixture-v1", "dictionary", "Local fixture dictionary (test only)", dictionaryShards(1));
  const second = await release("local-fixture-dictionary", "fixture-v2", "dictionary", "Local fixture dictionary (test only)", dictionaryShards(2));
  const corrupt = await release("local-fixture-dictionary", "fixture-corrupt", "dictionary", "Local fixture dictionary (intentionally corrupt)", dictionaryShards(3), true);

  for (const [name, revision, entry, expectedPublication] of [
    ["v1", 1, first, "accept"], ["v2", 2, second, "accept"], ["corrupt", 3, corrupt, "reject"],
  ]) {
    const catalog = CatalogSchema.parse({ schemaVersion: 1, revision, resources: [entry, reference] });
    const bytes = encodeJson(catalog);
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error("Fixture catalog exceeds contract limit");
    const file = `catalogs/${name}.json`;
    files.set(file, bytes);
    catalogs.push({ file, revision, bytes: bytes.byteLength, sha256: await sha256(bytes), expectedPublication });
  }

  objects.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  files.set("inventory.json", encodeJson({
    schemaVersion: 1, fixtureOnly: true,
    warning: "LOCAL TEST FIXTURES ONLY. No production permissions or third-party datasets are represented. Do not upload to remote R2.",
    objects, catalogs,
  }));
  return files;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function resolveExistingAncestor(target) {
  let ancestor = target;
  const missing = [];
  while (!await exists(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(await realpath(ancestor), ...missing);
}

/** Refuse tracked-tree output and existing output, including symlink aliases. */
export async function writeFixtureFiles(output) {
  if (!output || typeof output !== "string") throw new Error("A caller-specified output directory is required");
  const destination = path.resolve(output);
  const physicalRepository = await realpath(repository);
  if (isWithin(physicalRepository, await resolveExistingAncestor(destination))) {
    throw new Error("Fixture output must be outside the repository");
  }
  if (await exists(destination)) throw new Error("Output already exists; choose a new directory (nothing was overwritten)");
  const files = await createFixtureFiles();
  await mkdir(path.dirname(destination), { recursive: true });
  // Recheck the parent after creation so existing symlinks cannot route output
  // into the checkout. Exclusive creation also protects existing files.
  if (isWithin(physicalRepository, await realpath(path.dirname(destination)))) throw new Error("Fixture output must be outside the repository");
  await mkdir(destination);
  for (const [relative, bytes] of files) {
    const file = path.join(destination, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
  const inventory = JSON.parse(new TextDecoder().decode(files.get("inventory.json")));
  return { output: destination, files: files.size, objects: inventory.objects.length, catalogs: inventory.catalogs.length };
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node resources/build-fixtures.mjs --out <new-directory-outside-repository>");
    return;
  }
  if (args.length !== 2 || args[0] !== "--out" || !args[1]) throw new Error("Usage: node resources/build-fixtures.mjs --out <new-directory-outside-repository>");
  console.log(JSON.stringify(await writeFixtureFiles(args[1]), null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
