import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyAssets } from "../scripts/verify-assets.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
function fixture({ corrupt = false, missing = false, wrongSize = false } = {}) {
  const record = { key: "entry", data: { text: "Fixture" } }, shard = JSON.stringify(record) + "\n";
  const manifest = JSON.stringify({ parts: [{ path: "part.ndjson", bytes: Buffer.byteLength(shard), sha256: hash(shard) }] });
  const resources = ["strongs", "josephus", "jewish-encyclopedia", "smiths-dictionary-of-the-bible"].map(id => ({ id, release: "r1", manifestSha256: hash(manifest) }));
  const chapter = { readerId: "reader", slug: "genesis", chapter: 1, audio: "recordings/reader/genesis/1.m4a", index: "reader/genesis/1.json", bytes: 100 };
  return { url: "https://fixture.invalid", token: "fixture-token", log() {}, fetcher: async (url, init) => {
    assert.match(init.headers.authorization, /^tma /);
    const path = new URL(url).pathname;
    const json = value => new Response(JSON.stringify(value));
    if (path === "/api/resources/catalog") return json({ resources: missing ? [] : resources });
    if (path.endsWith("manifest.json")) return new Response(manifest);
    if (path.endsWith("part.ndjson")) return new Response(corrupt ? "corrupt" : shard);
    if (path.endsWith("/record")) return json({ release: "r1", data: record.data });
    if (path === "/api/recordings/catalog") return json({ chapters: [chapter] });
    if (path === "/api/recordings/genesis/1") return json({ narrators: [{ id: "reader", verses: [[1, 0, 1]] }] });
    if (path.startsWith("/api/audio/")) { assert.equal(init.method, "HEAD"); return new Response(null, { headers: { "content-length": wrongSize ? "10" : "100" } }); }
    throw new Error(`Unexpected request: ${path}`);
  } };
}
test("release asset verification exercises catalog, checksummed content, lookup, audio and timing indexes", async () => {
  await verifyAssets(fixture());
});
test("release verification refuses missing resources, corrupt shards or incomplete narration", async () => {
  for (const options of [{ corrupt: true }, { missing: true }, { wrongSize: true }]) await assert.rejects(verifyAssets(fixture(options)), /checksum mismatch|Missing published|size mismatch/);
  await assert.rejects(verifyAssets({ ...fixture(), minimumChapters: 2 }), /Narration is incomplete/);
});
