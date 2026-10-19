import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfLinkOk, pdfSig } from "../src/pdf-link.ts";

const token = "1:test-token";
const path = "/classes/a-class";
const now = Date.UTC(2026, 9, 19);
const exp = now / 1000 + 900;

test("a note's PDF link with the right signature opens until it expires", async () => {
  const sig = await pdfSig(token, path, exp);
  assert.match(sig, /^[0-9a-f]{40}$/);
  assert.equal(await pdfLinkOk(token, path, exp, sig, now), true);
  assert.equal(await pdfLinkOk(token, path, exp, sig, (exp + 1) * 1000), false);
});

test("a note's PDF link with a wrong signature is refused", async () => {
  const sig = await pdfSig(token, path, exp);
  const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  for (const bad of [flipped, sig.slice(0, 39), `${sig}0`, "", sig.toUpperCase() === sig ? "x".repeat(40) : sig.toUpperCase()]) {
    assert.equal(await pdfLinkOk(token, path, exp, bad, now), false, bad);
  }
  assert.equal(await pdfLinkOk(token, "/classes/another", exp, sig, now), false);
  assert.equal(await pdfLinkOk(token, path, exp + 60, sig, now), false);
  assert.equal(await pdfLinkOk("2:other-token", path, exp, sig, now), false);
  assert.equal(await pdfLinkOk(token, path, NaN, sig, now), false);
});
