import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * checkbatch.mjs resolves its sibling files (check.mjs, periods.json, events.json) from its own
 * module URL, not from the process cwd, so it must still work run as a child process from an
 * unrelated directory.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../scripts/final-captivity/research/checkbatch.mjs");

test("checkbatch.mjs runs from any cwd and reports shape-only checking with no CJ_ROOT", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkbatch-test-"));
  try {
    const batchPath = path.join(dir, "batch.json");
    fs.writeFileSync(batchPath, JSON.stringify({ events: [], drafts: [] }));
    const r = spawnSync(process.execPath, [SCRIPT, batchPath], {
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, CJ_ROOT: "" },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /no CJ_ROOT \(or path not found\): checking shape only/);
    assert.match(out, /0 event\(s\), 0 draft\(s\), 0 problem\(s\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
