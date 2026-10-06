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
