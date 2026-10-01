import { describe, it } from "node:test";
import assert from "node:assert/strict";
const expect = (actual: unknown) => ({ toBe: (expected: unknown) => assert.equal(actual, expected) });
import { recordingAudio, recordings } from "../../src/recordings";
import type { Env } from "../../src/env";
const bytes = new TextEncoder().encode("0123456789");
const env = { AUDIO: {
  head: async () => ({ size: 10, httpEtag: '"audio"' }),
  get: async (_key: string, opts?: { range: { offset: number; length: number } }) => ({ body: opts ? bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : bytes }),
} } as unknown as Pick<Env, "AUDIO">;
const url = "https://cyberjudah.io/api/audio/recordings/reader/tobit/9.m4a";
describe("human recording byte ranges", () => {
  it("serves only the licensed ambient keys through the same range endpoint", async () => {
    for (const id of ["quiet-piano", "soft-keys", "stillness", "evening-pad", "rain", "wind", "ocean", "fire"]) {
      const r = await recordingAudio(new Request(`https://cyberjudah.io/api/audio/ambient/${id}.m4a`, { headers: { range: "bytes=2-4" } }), env);
      expect(r.status).toBe(206); expect(await r.text()).toBe("234");
    }
    expect((await recordingAudio(new Request("https://cyberjudah.io/api/audio/ambient/unreviewed.m4a"), env)).status).toBe(404);
  });
  it("shares a five-minute catalog read across requests", async () => {
    let reads = 0;
    const bindings = { AUDIO: { get: async () => { reads++; return { json: async () => ({ schemaVersion: 1, chapters: [] }) }; } } } as unknown as Env;
    await Promise.all([recordings.request("/catalog", {}, bindings), recordings.request("/catalog", {}, bindings)]);
    await recordings.request("/catalog", {}, bindings);
    expect(reads).toBe(1);
  });
  it("returns full, bounded, suffix and HEAD responses", async () => {
    for (const [range, expected, body] of [[null, 200, "0123456789"], ["bytes=2-4", 206, "234"], ["bytes=-3", 206, "789"], ["bytes=8-", 206, "89"]] as const) {
      const r = await recordingAudio(new Request(url, { headers: range ? { range } : {} }), env);
      expect(r.status).toBe(expected); expect(await r.text()).toBe(body);
      expect(r.headers.get("content-length")).toBe(String(body.length));
    }
    const head = await recordingAudio(new Request(url, { method: "HEAD" }), env);
    expect(await head.text()).toBe(""); expect(head.headers.get("content-length")).toBe("10");
  });
  it("rejects invalid ranges and never exposes the AI voice cache", async () => {
    for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=0-1,3-4", "bytes=-"]) {
      const r = await recordingAudio(new Request(url, { headers: { range } }), env);
      expect(r.status).toBe(416); expect(r.headers.get("content-range")).toBe("bytes */10");
    }
    expect((await recordingAudio(new Request("https://cyberjudah.io/api/audio/tts/aura-1/asteria/john/3/16.mp3"), env)).status).toBe(404);
  });
  it("revalidates etags and ignores a range for a different representation", async () => {
    expect((await recordingAudio(new Request(url, { headers: { "if-none-match": '"audio"' } }), env)).status).toBe(304);
    const r = await recordingAudio(new Request(url, { headers: { range: "bytes=2-4", "if-range": '"old"' } }), env);
    expect(r.status).toBe(200); expect(await r.text()).toBe("0123456789");
  });
});
