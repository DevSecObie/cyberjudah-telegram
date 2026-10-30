import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression (PR #18): the production build references /app/assets/..., but Workers Static
// Assets serves the directory at the request path; staged only at the root, /app/assets/x.js
// answered index.html and the app never mounted. The build must be staged at / and at /app/.
test("the built app is staged at the root and under app/, so /app/assets resolve", () => {
  const root = mkdtempSync(join(tmpdir(), "cj-stage-"));
  try {
    mkdirSync(join(root, "bot/scripts"), { recursive: true });
    cpSync(new URL("../scripts/prepare-assets.sh", import.meta.url), join(root, "bot/scripts/prepare-assets.sh"));
    mkdirSync(join(root, "app/dist/assets"), { recursive: true });
    writeFileSync(join(root, "app/dist/index.html"), '<script type="module" src="/app/assets/index-abc.js"></script>');
    writeFileSync(join(root, "app/dist/assets/index-abc.js"), "export {}");
    execFileSync("sh", [join(root, "bot/scripts/prepare-assets.sh")], { stdio: "pipe" });
    for (const f of ["index.html", "assets/index-abc.js", "app/index.html", "app/assets/index-abc.js"]) assert.ok(existsSync(join(root, ".deploy", f)), f);
    // Every asset the page asks for exists at that path in the staged directory.
    const html = readFileSync(join(root, ".deploy/app/index.html"), "utf8");
    for (const [, src] of html.matchAll(/src="\/([^"]+)"/g)) assert.ok(existsSync(join(root, ".deploy", src)), src);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hashed build assets are cached as immutable, and nothing else is", () => {
  const root = mkdtempSync(join(tmpdir(), "cj-stage-"));
  try {
    mkdirSync(join(root, "bot/scripts"), { recursive: true });
    cpSync(new URL("../scripts/prepare-assets.sh", import.meta.url), join(root, "bot/scripts/prepare-assets.sh"));
    mkdirSync(join(root, "app/dist/assets"), { recursive: true });
    writeFileSync(join(root, "app/dist/index.html"), "");
    execFileSync("sh", [join(root, "bot/scripts/prepare-assets.sh")], { stdio: "pipe" });
    // Workers Static Assets reads _headers at the root only: one rule per path, then its headers.
    const rules = readFileSync(join(root, ".deploy/_headers"), "utf8").split(/\n(?=\S)/).map((r) => r.trim().split("\n"));
    assert.deepEqual(rules.filter((r) => r.some((h) => /immutable/.test(h))).map((r) => r[0]), ["/assets/*", "/app/assets/*"]);
    assert.equal(rules.length, 5);
    // The video player page alone may be framed: the phone app's reader shows it in a frame.
    for (const path of ["/embed/youtube.html", "/embed/youtube"]) assert.deepEqual(rules.find((r) => r[0] === path), [path, "  ! Content-Security-Policy"]);
    // Every response also carries the security headers, framing allowed only for the site and Telegram's web clients.
    const all = rules.find((r) => r[0] === "/*");
    assert.ok(all.includes("  X-Content-Type-Options: nosniff"));
    assert.ok(all.includes("  Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://*.telegram.org"));
    assert.ok(!all.some((h) => /X-Frame-Options/i.test(h)), "X-Frame-Options would block Telegram Web");
    // The script policy is only reported; the enforced policy above stays frame-ancestors alone.
    assert.ok(all.includes("  Content-Security-Policy-Report-Only: script-src 'self' https://telegram.org https://apis.google.com; object-src 'none'; base-uri 'self'"));
    assert.equal(all.filter((h) => /^\s*Content-Security-Policy:/.test(h)).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the report-only script policy names each inline script the app carries, by hash", () => {
  const root = mkdtempSync(join(tmpdir(), "cj-stage-"));
  try {
    mkdirSync(join(root, "bot/scripts"), { recursive: true });
    cpSync(new URL("../scripts/prepare-assets.sh", import.meta.url), join(root, "bot/scripts/prepare-assets.sh"));
    mkdirSync(join(root, "app/dist/assets"), { recursive: true });
    const theme = "\n      document.documentElement.setAttribute('data-theme', 'dark');\n    ";
    writeFileSync(join(root, "app/dist/index.html"), `<script src="https://telegram.org/js/telegram-web-app.js?59"></script><script>${theme}</script><script type="module" crossorigin src="/app/assets/index-abc.js"></script>`);
    execFileSync("sh", [join(root, "bot/scripts/prepare-assets.sh")], { stdio: "pipe" });
    const line = readFileSync(join(root, ".deploy/_headers"), "utf8").split("\n").find((h) => h.startsWith("  Content-Security-Policy-Report-Only:"));
    const hash = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    assert.equal(line, `  Content-Security-Policy-Report-Only: script-src 'self' https://telegram.org https://apis.google.com ${hash(theme)}; object-src 'none'; base-uri 'self'`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
