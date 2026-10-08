import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

test("native scripture search reaches the public Worker without forwarding local cookies or unrelated URLs", async () => {
  const result = await build({ entryPoints: [new URL("../src/native/requests.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false,
    plugins: [{ name: "native-platform", setup(builder) {
      builder.onResolve({ filter: /^\.\/platform$/ }, () => ({ path: "platform", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const native = true;" }));
    } }],
  });
  const originalFetch = globalThis.fetch, originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const calls = [];
  globalThis.fetch = async (input, init) => { calls.push({ input, init }); return new Response("{}"); };
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://localhost", href: "https://localhost/app/read/john/3" } });
  try {
    await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
    await fetch("/bs/v1/bibles/KJV/search?q=everlasting+life&book=43", { credentials: "include" });
    assert.equal(calls[0].input, "https://cyberjudah.io/bs/v1/bibles/KJV/search?q=everlasting+life&book=43");
    assert.equal(calls[0].init.credentials, "omit");
    await fetch(new Request("https://localhost/bs/v1/bibles/KJV/search?q=light", { headers: { accept: "application/json" }, credentials: "include" }));
    assert.equal(calls[1].input.url, "https://cyberjudah.io/bs/v1/bibles/KJV/search?q=light");
    assert.equal(calls[1].input.headers.get("accept"), "application/json");
    assert.equal(calls[1].init.credentials, "omit");
    await fetch("/api/health");
    assert.equal(calls[2].input, "https://cyberjudah.io/api/health");
    for (const url of ["/assets/reader.js", "/bs/v1/bibles/KJV/searching", "/bs/health", "https://example.com/api/search", "https://example.com/bs/v1/bibles/KJV/search"]) {
      await fetch(url);
      assert.equal(calls.at(-1).input, url);
      assert.equal(calls.at(-1).init, undefined);
    }
    Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "capacitor://localhost", href: "capacitor://localhost/read/john/3" } });
    await fetch("/bs/v1/bibles/KJV/search?q=light");
    assert.equal(calls.at(-1).input, "https://cyberjudah.io/bs/v1/bibles/KJV/search?q=light");
    assert.equal(calls.at(-1).init.credentials, "omit");
    await fetch("unrelated://localhost/api/search");
    assert.equal(calls.at(-1).input, "unrelated://localhost/api/search");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation); else delete globalThis.location;
  }
});
