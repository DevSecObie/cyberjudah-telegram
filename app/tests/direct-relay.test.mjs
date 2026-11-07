import test from "node:test";
import assert from "node:assert/strict";
import { loopbackRequestOptions } from "../e2e/direct-relay.mjs";

test("the direct Ask relay pins its authority and Host, accepting only a path and query", () => {
  const target = new URL("http://127.0.0.1:43210");
  for (const [url, expectedPath] of [["/api/ask?q=a%20b", "/api/ask?q=a%20b"], ["/", "/"], ["http://outside.invalid/private", "/"], ["//outside.invalid/private", "/"], [undefined, "/"]]) {
    const options = loopbackRequestOptions(target, { url, method: "POST", headers: { host: "outside.invalid", authorization: "fixture-auth" } });
    assert.equal(options.hostname, "127.0.0.1");
    assert.equal(options.port, "43210");
    assert.equal(options.headers.host, "127.0.0.1:43210");
    assert.equal(options.headers.authorization, "fixture-auth");
    assert.equal(options.method, "POST");
    assert.equal(options.path, expectedPath);
  }
  assert.throws(() => loopbackRequestOptions(new URL("https://outside.invalid"), { url: "/" }), /loopback/);
});
