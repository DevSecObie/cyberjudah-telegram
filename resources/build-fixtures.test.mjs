import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFixtureFiles, writeFixtureFiles } from "./build-fixtures.mjs";
import { CatalogSchema, ManifestSchema, parseShard, releasePrefix, sha256 } from "../shared/resources.ts";

const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

test("build is deterministic and every inventory hash describes emitted bytes", async () => {
  const first = await createFixtureFiles(), second = await createFixtureFiles();
  assert.deepEqual(first, second);
  const inventory = json(first.get("inventory.json"));
  assert.equal(inventory.fixtureOnly, true);
  assert.equal(inventory.objects.length, 11);
  for (const entry of [...inventory.objects, ...inventory.catalogs]) {
    const bytes = first.get(entry.file);
    assert.equal(bytes.byteLength, entry.bytes, entry.file);
    assert.equal(await sha256(bytes), entry.sha256, entry.file);
  }
});

test("valid releases parse with the shared contract and update the same lookup key", async () => {
  const files = await createFixtureFiles();
  const results = [];
  for (const version of ["v1", "v2"]) {
    const catalog = CatalogSchema.parse(json(files.get(`catalogs/${version}.json`)));
    assert.equal(catalog.resources.length, 2);
    for (const entry of catalog.resources) {
      const prefix = `objects/${releasePrefix(entry.id, entry.release)}`;
      const bytes = files.get(`${prefix}manifest.json`);
      assert.equal(await sha256(bytes), entry.manifestSha256);
      const manifest = ManifestSchema.parse(json(bytes));
      assert.equal(manifest.approval.reference, "https://example.invalid/local-fixture");
      assert.match(manifest.approval.approvedBy, /NOT PRODUCTION APPROVAL/);
      for (const part of manifest.parts) {
        const rows = await parseShard(files.get(`${prefix}${part.path}`), part, manifest.kind);
        for (const row of rows) {
          assert.equal(row.data.fixtureOnly, true);
          if (row.key === "local-fixture/alpha") results.push(row);
        }
      }
    }
  }
  assert.equal(results.length, 2);
  assert.equal(results[0].key, results[1].key);
  assert.equal(results[0].data.revision, 1);
  assert.equal(results[1].data.revision, 2);
  assert.notEqual(results[0].data.definition, results[1].data.definition);
});

test("corrupt catalog has a valid manifest but rejects one same-size shard", async () => {
  const files = await createFixtureFiles();
  const catalog = CatalogSchema.parse(json(files.get("catalogs/corrupt.json")));
  const entry = catalog.resources.find((item) => item.id === "local-fixture-dictionary");
  const prefix = `objects/${releasePrefix(entry.id, entry.release)}`;
  const bytes = files.get(`${prefix}manifest.json`);
  assert.equal(await sha256(bytes), entry.manifestSha256);
  const manifest = ManifestSchema.parse(json(bytes));
  const bad = files.get(`${prefix}${manifest.parts[0].path}`);
  assert.equal(bad.byteLength, manifest.parts[0].bytes);
  assert.doesNotThrow(() => JSON.parse(new TextDecoder().decode(bad).trim()));
  await assert.rejects(parseShard(bad, manifest.parts[0], manifest.kind), /checksum or size mismatch/);
  await parseShard(files.get(`${prefix}${manifest.parts[1].path}`), manifest.parts[1], manifest.kind);
});

test("writes only a new external directory and refuses overwriting it", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyberjudah-fixtures-test-"));
  const destination = path.join(parent, "output");
  const result = await writeFixtureFiles(destination);
  assert.equal(result.objects, 11);
  assert.equal(result.files, 15);
  const files = await createFixtureFiles();
  for (const [relative, bytes] of files) assert.deepEqual(new Uint8Array(await readFile(path.join(destination, relative))), bytes);
  await assert.rejects(writeFixtureFiles(destination), /already exists/);
  assert.deepEqual(new Uint8Array(await readFile(path.join(destination, "inventory.json"))), files.get("inventory.json"));
  console.log(`Fixture test output retained: ${destination}`);
});

test("rejects missing output, checkout output and a symlink into the checkout", async () => {
  await assert.rejects(writeFixtureFiles(), /caller-specified/);
  const repository = fileURLToPath(new URL("../", import.meta.url));
  await assert.rejects(writeFixtureFiles(path.join(repository, "resources", "generated")), /outside the repository/);
  const parent = await mkdtemp(path.join(os.tmpdir(), "cyberjudah-fixtures-symlink-"));
  await symlink(repository, path.join(parent, "checkout"), "dir");
  await assert.rejects(writeFixtureFiles(path.join(parent, "checkout", "resources", "generated")), /outside the repository/);
  console.log(`Fixture test symlink retained: ${parent}`);
});
