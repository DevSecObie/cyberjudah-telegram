import test from "node:test";
import assert from "node:assert/strict";
import { mergeRecordingCatalog } from "../scripts/recording-catalog.mjs";

const chapter = (n, hash = "a") => ({ readerId: "reader", slug: "genesis", chapter: n, audio: `recordings/reader/genesis/${n}.m4a`, index: `reader/genesis/${n}.json`, sha256: hash.repeat(64), bytes: 100 });
const catalog = chapters => ({ schemaVersion: 1, chapters });
test("partial publication retains unavailable chapters, replaces new encodings and adds newly available chapters", () => {
  const result = mergeRecordingCatalog(catalog([chapter(1), chapter(2)]), { ...catalog([chapter(2, "b"), chapter(3)]), partial: true });
  assert.deepEqual(result, { ...catalog([chapter(1), chapter(2, "b"), chapter(3)]), partial: true });
});
test("invalid existing catalogs fail closed before publication", () => {
  for (const previous of [{}, catalog([{ ...chapter(1), audio: "recordings/other.m4a" }]), catalog([{ ...chapter(1), sha256: "invalid" }])]) {
    assert.throws(() => mergeRecordingCatalog(previous, catalog([chapter(2)])), /Invalid/);
  }
});
