import assert from "node:assert/strict";
import test from "node:test";
import { decodeEntities } from "../src/lib/html-text.ts";

test("a note preview decodes each entity once, never twice", () => {
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&amp;amp; &amp;quot;"), "&amp; &quot;");
});

test("a note preview decodes ordinary text exactly as before", () => {
  assert.equal(decodeEntities("A &amp; B &lt;C&gt; &quot;D&quot; E&#39;s"), "A & B <C> \"D\" E's");
  assert.equal(decodeEntities("No entities here; &nbsp; and &#x41; stay as they are."), "No entities here; &nbsp; and &#x41; stay as they are.");
});
