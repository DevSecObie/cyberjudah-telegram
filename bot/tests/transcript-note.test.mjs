import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = new URL("./.build/teachings-note.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/teachings.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { transcriptAround } = await import(out);

// A class's notes are found from the published notes index, even when the teachings database
// has no teaching_refs table (or no row for the recording).
test("a recording's note comes from the published notes index", async () => {
  const saved = new Map();
  globalThis.caches = { default: { match: async (k) => saved.get(k)?.clone(), put: async (k, v) => { saved.set(k, v.clone()); } } };
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).endsWith("/api/notes/index.json")) return Response.json([
      { kind: "study", title: "Genesis 1", url: "/study/genesis/1", videoId: null },
      { kind: "class", title: "Mystery Babylon", url: "/classes/2026/2026-11-07-mystery-babylon", date: "2026-11-07", videoId: "abcDEF12345" },
    ]);
    const { hostname, pathname } = new URL(String(url));
    if (hostname === "raw.githubusercontent.com") {
      if (pathname.endsWith("/corrections.json")) return new Response("{}", { status: 404 });
      return Response.json({ title: "Mystery Babylon (live)", date: "2026-11-07", segments: [{ start: 0, dur: 4, text: "Shalom" }] });
    }
    return new Response("", { status: 404 });
  };
  const env = { DATA_ORIGIN: "https://data.test", TEACH: { prepare: () => { throw new Error("no such table: teaching_refs"); } } };
  const r = await transcriptAround(env, "abcDEF12345", 0);
  assert.equal(r.ok, true);
  assert.equal(r.url, "/classes/2026/2026-11-07-mystery-babylon");
  assert.equal(r.title, "Mystery Babylon");
  const none = await transcriptAround(env, "zzzzzzzzzzz", 0);
  assert.equal(none.url, "");
});
