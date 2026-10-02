import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
