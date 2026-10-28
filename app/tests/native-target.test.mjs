import test from "node:test";
import assert from "node:assert/strict";
import { nativeTarget, nativeAccountURL, nativeRequestURL } from "../../shared/native-target.mjs";

test("native staging never uses the production wallet or approval page", () => {
  const target = nativeTarget("staging"), code = "a".repeat(64);
  assert.equal(target.appId, "io.cyberjudah.app.staging");
  assert.equal(target.appName, "CyberJudah Staging");
  assert.equal(target.syncScope, "staging");
  assert.equal(new URL(nativeAccountURL("staging", code)).origin, target.origin);
  for (const local of ["capacitor://localhost/settings/account", "https://localhost/settings/account"]) {
    for (const path of ["/api/auth/device/start", "/api/auth/device/exchange", "/api/ask/account", "/api/ask/history", "/api/ask", "/bs/v1/bibles/KJV/search?q=faith"]) {
      assert.equal(nativeRequestURL(path, local, "staging"), target.origin + path);
    }
  }
});
test("native routing leaves packaged resources and unrelated destinations alone", () => {
  const local = "capacitor://localhost/settings/account";
  for (const path of ["/assets/index.js", "/images/book.png", "https://example.com/api/ask", "https://cyberjudah.io/api/ask", "https://localhost/api/ask", "capacitor://attacker/api/ask", "/api-evil/ask"]) {
    assert.equal(nativeRequestURL(path, local, "staging"), null);
  }
});
test("unknown targets and malformed approval codes fail instead of falling back", () => {
  for (const value of ["stage", "", "__proto__", "https://attacker.invalid"]) assert.throws(() => nativeTarget(value));
  for (const code of ["", "a".repeat(63), "a".repeat(64) + "&return=https://attacker.invalid", "A".repeat(64)]) assert.throws(() => nativeAccountURL("staging", code));
  assert.equal(nativeTarget().origin, "https://cyberjudah.io");
  assert.equal(nativeAccountURL("production", "f".repeat(64)), "https://cyberjudah.io/app/settings/account?device=" + "f".repeat(64));
});
