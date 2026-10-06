import { test } from "node:test";
import assert from "node:assert/strict";
import { imageFile } from "../src/images.ts";

// A stand-in for the AUDIO bucket: what it holds, and every key the route asked it for.
function bucket(objects) {
  const asked = [];
  return {
    asked,
    async get(key, options) {
      asked.push(key);
      const o = objects[key];
      if (!o) return null;
      const tag = options?.onlyIf?.etagDoesNotMatch;
      if (tag !== undefined && tag === o.etag) return { httpEtag: `"${o.etag}"` }; // the condition failed: no body
      return { httpEtag: `"${o.etag}"`, body: o.body };
    },
  };
}

const PORTRAIT = "images/people/moses-exo-2-10-128.webp";
const held = {
  [PORTRAIT]: { etag: "abc123", body: "webp bytes" },
  "images/manifest.json": { etag: "m1", body: "{}" },
  "recordings/catalog.json": { etag: "r1", body: "{}" },
  "photos/leader/bishop-kani/1759480000000.jpg": { etag: "p1", body: "jpeg" },
  "tts/aura-1/v/gen/1/1.mp3": { etag: "t1", body: "mp3" },
  "frames/abcdefghijk/0/1.jpg": { etag: "f1", body: "jpeg" },
  "resources/catalog/current.json": { etag: "c1", body: "{}" },
};

test("/api/img/ answers 404 for anything outside the allowlist without asking the bucket", async () => {
  const AUDIO = bucket(held);
  for (const path of [
    "manifest.json", "images/manifest.json", "people/manifest.json",
    "recordings/catalog.json", "../recordings/catalog.json", "people/../../recordings/catalog.json",
    "photos/leader/bishop-kani/1759480000000.jpg", "tts/aura-1/v/gen/1/1.mp3", "frames/abcdefghijk/0/1.jpg", "resources/catalog/current.json",
    "images/people/moses-exo-2-10-128.webp", "people/moses-exo-2-10-128.webp/", "people/moses-exo-2-10-128.WEBP", "people/moses-exo-2-10-64.webp", "",
  ]) {
    const res = await imageFile({ AUDIO }, path);
    assert.equal(res.status, 404, path);
  }
  assert.deepEqual(AUDIO.asked, [], "the bucket was never read for a disallowed path");
});

test("/api/img/ reads only the images/ key for an allowed path, and serves it public, as WebP, nosniff", async () => {
  const AUDIO = bucket(held);
  const res = await imageFile({ AUDIO }, "people/moses-exo-2-10-128.webp");
  assert.equal(res.status, 200);
  assert.deepEqual(AUDIO.asked, [PORTRAIT]);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("cache-control"), /^public, max-age=604800\b/);
  assert.equal(res.headers.get("etag"), '"abc123"');
  assert.equal(await res.text(), "webp bytes");
});

test("/api/img/ answers 404 for an allowed path the bucket does not hold", async () => {
  const AUDIO = bucket(held);
  const res = await imageFile({ AUDIO }, "timeline/periods/not-uploaded.webp");
  assert.equal(res.status, 404);
  assert.deepEqual(AUDIO.asked, ["images/timeline/periods/not-uploaded.webp"]);
});

test("/api/img/ revalidates by ETag: a matching If-None-Match, strong or weak, answers 304 without a body", async () => {
  for (const header of ['"abc123"', 'W/"abc123"']) {
    const res = await imageFile({ AUDIO: bucket(held) }, "people/moses-exo-2-10-128.webp", header);
    assert.equal(res.status, 304, header);
    assert.equal(res.body, null);
    assert.equal(res.headers.get("etag"), '"abc123"');
  }
  const changed = await imageFile({ AUDIO: bucket(held) }, "people/moses-exo-2-10-128.webp", '"old"');
  assert.equal(changed.status, 200);
});
