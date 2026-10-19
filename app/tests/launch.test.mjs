import test from "node:test";
import assert from "node:assert/strict";
import { initialLaunchPath } from "../src/tg/launch.mjs";

test("root launches use each supplied destination, including the same link again", () => {
  for (const param of ["john_3_16", "psalms_23", "john_3_16"]) {
    assert.equal(initialLaunchPath("/", param), param === "psalms_23" ? "/read/psalms/23" : "/read/john/3?v=16");
  }
});

test("a bare or invalid launch stays on Home and cannot navigate off site", () => {
  for (const param of [undefined, "", "https://t.me/example", "//example.com", "../settings", "x".repeat(513)]) {
    assert.equal(initialLaunchPath("/", param), null);
  }
});

test("an explicit route wins over a launch parameter retained by the SDK", () => {
  for (const pathname of ["/settings", "/read/psalms/23", "/search"]) {
    assert.equal(initialLaunchPath(pathname, "john_3_16"), null);
  }
});

test("a bare launch reopens the tab that was current, never somewhere off the app", () => {
  assert.equal(initialLaunchPath("/", undefined, "/read/romans/8?at=28"), "/read/romans/8?at=28");
  assert.equal(initialLaunchPath("/", "", "/lexicon/H430"), "/lexicon/H430");
  assert.equal(initialLaunchPath("/", undefined, "/history"), "/history", "an app path is not mapped as a website path");
  assert.equal(initialLaunchPath("/", "john_3_16", "/lexicon/H430"), "/read/john/3?v=16", "a shared link still wins");
  for (const last of [undefined, "", "/", "/new", "/new?q=x", "//example.com", "https://example.com"]) assert.equal(initialLaunchPath("/", undefined, last), null, String(last));
  assert.equal(initialLaunchPath("/settings", undefined, "/lexicon/H430"), null, "an explicit route stays");
});
