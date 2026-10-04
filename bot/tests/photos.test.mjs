import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJECT_KEY, objectKey, publicManifest, sniff, SLOT } from "../src/photos.mjs";

test("a slot is a leader, a period or an event, by its id", () => {
  for (const s of ["leader:bishop-nathanyel", "period:fc-israel-united-in-christ", "event:iuic-founded-2003", "period:12"]) assert.ok(SLOT.test(s), s);
  for (const s of ["leader:", "people:adam", "leader:../x", "leader:Bishop", "event:a/b", "leader:x y"]) assert.ok(!SLOT.test(s), s);
});

test("a file's type is read from its bytes, not from what the request says", () => {
  assert.deepEqual(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), { type: "image/jpeg", ext: "jpg" });
  assert.deepEqual(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { type: "image/png", ext: "png" });
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  assert.deepEqual(sniff(webp), { type: "image/webp", ext: "webp" });
  assert.equal(sniff(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniff(new TextEncoder().encode("GIF89a")), null);
});

test("only keys the Worker writes are served", () => {
  const k = objectKey("leader:bishop-kani", "jpg", 1759480000000);
  assert.equal(k, "photos/leader/bishop-kani/1759480000000.jpg");
  assert.ok(OBJECT_KEY.test(k));
  for (const bad of ["recordings/catalog.json", "photos/leader/../../x/1759480000000.jpg", "photos/leader/bishop-kani/1.jpg", "photos/leader/bishop-kani/1759480000000.svg"]) assert.ok(!OBJECT_KEY.test(bad), bad);
});

test("the app's manifest maps each slot to its file, and drops anything malformed", () => {
  const m = publicManifest({
    "leader:bishop-kani": { key: "photos/leader/bishop-kani/1759480000000.jpg", at: "", by: "" },
    "leader:evil": { key: "recordings/catalog.json", at: "", by: "" },
    "bad slot": { key: "photos/leader/x/1759480000000.jpg", at: "", by: "" },
  });
  assert.deepEqual(m, { "leader:bishop-kani": "/api/photos/file/photos/leader/bishop-kani/1759480000000.jpg" });
});
