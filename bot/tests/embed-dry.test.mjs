import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// embed.mjs against a fake Cloudflare and GitHub: every request is logged, nothing leaves the machine.
async function run(extra) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "embed-dry-test-"));
  try {
    const preload = path.join(root, "fetch.mjs"), requests = path.join(root, "requests.jsonl");
    await fs.writeFile(requests, "");
    await fs.writeFile(preload, `
      import fs from 'node:fs';
      globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url), method = init.method ?? 'GET';
        fs.appendFileSync(process.env.REQUEST_LOG, JSON.stringify({ host: u.hostname, path: u.pathname, method, body: typeof init.body === 'string' ? init.body : null })+'\\n');
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
        if (u.hostname !== 'api.cloudflare.com') throw new Error('Unexpected request ' + u.href);
        if (u.pathname.endsWith('/d1/database')) return json({ success: true, result: [{ name: 'cyberjudah-telegram', uuid: 'db' }] });
        if (u.pathname.endsWith('/query')) {
          const q = JSON.parse(init.body).sql;
          const rows = /sqlite_master/.test(q) ? [{ name: 'embedded' }]
            : /FROM embedded/.test(q) ? []
            : /FROM search_docs WHERE rowid > 0 /.test(q) ? [1, 2, 3].map((id) => ({ id, kind: 'note', title: 'Fixture ' + id, url: '/fixture/' + id, sub: '', text: 'Fixture text ' + id }))
            : [];
          return json({ success: true, result: [{ results: rows }] });
        }
        if (u.pathname.includes('/ai/run/')) return json({ success: true, result: { data: JSON.parse(init.body).text.map(() => [0, 0, 0]) } });
        if (u.pathname.includes('/vectorize/')) return json({ success: true, result: {} });
        return json({ success: false }, 404);
      };
    `);
    const script = fileURLToPath(new URL("../scripts/embed.mjs", import.meta.url));
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture", REQUEST_LOG: requests };
    const result = spawnSync(process.execPath, ["--import", preload, script, "--only", "docs", ...extra], { env, encoding: "utf8" });
    const log = (await fs.readFile(requests, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { result, log };
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const sqlOf = (r) => r.path.endsWith("/query") && r.body ? JSON.parse(r.body).sql : null;

test("embed --dry makes no Workers AI or Vectorize call and writes nothing to D1", async () => {
  const { result, log } = await run(["--dry"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(log.length > 0, "the fake saw the run's reads");
  assert.deepEqual(log.filter((r) => r.path.includes("/ai/")), [], "no Workers AI call");
  assert.deepEqual(log.filter((r) => r.path.includes("/vectorize/")), [], "no Vectorize call");
  // The only POSTs are D1 queries, and every one of them only reads.
  for (const r of log.filter((r) => r.method !== "GET")) {
    assert.match(r.path, /\/d1\/database\/db\/query$/);
    assert.match(sqlOf(r), /^\s*SELECT\b/i, `a dry run only reads: ${sqlOf(r)}`);
  }
  assert.match(result.stderr, /dry: 3 passages seen, 3 would be embedded into cyberjudah-teachings \(note 3\)/);
  assert.match(result.stderr, /dry: first ids: d:\w+ d:\w+ d:\w+/);
});

test("embed --dry --limit counts no more than the limit", async () => {
  const { result, log } = await run(["--dry", "--limit", "2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(log.filter((r) => r.path.includes("/ai/") || r.path.includes("/vectorize/")), []);
  assert.match(result.stderr, /2 would be embedded/);
});

test("the same fake sees the AI and Vectorize calls of a real run (so the dry test can catch them)", async () => {
  const { result, log } = await run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(log.filter((r) => r.path.includes("/ai/run/")).length, 1);
  assert.equal(log.filter((r) => r.path.endsWith("/upsert")).length, 1);
  assert.ok(log.some((r) => /^INSERT/.test(sqlOf(r) ?? "")));
});
