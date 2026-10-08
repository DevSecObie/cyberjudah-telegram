import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("draft-note writes a branch, draft and PR through the fake API, including already-parsed replies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "draft-note-test-"));
  try {
    const preload = path.join(root, "fetch.mjs"), requests = path.join(root, "requests.jsonl");
    await fs.writeFile(preload, `
      import fs from 'node:fs';
      globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url), method = init.method ?? 'GET';
        fs.appendFileSync(process.env.REQUEST_LOG, JSON.stringify({ path: u.pathname, method, body: init.body })+'\\n');
        const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
        if (u.pathname === '/api/kjv/books.json') return json([]);
        if (u.hostname === 'raw.githubusercontent.com') return json({ videoId: 'abcdefghijk', title: 'Fixture class', date: '2026-10-07', segments: [[0,'Fixture transcript']] });
        if (u.hostname === 'api.cloudflare.com') return json({ success: true, result: { response: { scriptures: [], points: ['Fixture point'], introduction: 'Fixture introduction', closing: 'Fixture closing', tags: [] } } });
        if (u.hostname !== 'api.github.com') throw new Error('Unexpected request');
        if (u.pathname.endsWith('/git/ref/heads/main') && method === 'GET') return json({ object: { sha: 'a'.repeat(40) } });
        if (process.env.FAIL_WRITE && method !== 'GET') return json({}, 403);
        if (u.pathname.endsWith('/git/refs') && method === 'POST') return json({});
        if (u.pathname.includes('/contents/blog/') && method === 'PUT') return json({});
        if (u.pathname.endsWith('/pulls') && method === 'POST') return json({ html_url: 'https://github.com/example/content/pull/1' });
        return json({}, 404);
      };
    `);
    const args = ["--import", preload, fileURLToPath(new URL("../scripts/draft-note.mjs", import.meta.url)), "--video", "abcdefghijk", "--out", path.join(root, "drafts")];
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture", CYBERJUDAH_TOKEN: "fixture", TRANSCRIPTS_REPO: "example/content", REQUEST_LOG: requests };
    const result = spawnSync(process.execPath, args, { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /pull request: https:\/\/github.com\/example\/content\/pull\/1/);
    const writes = (await fs.readFile(requests, "utf8")).trim().split("\n").map(JSON.parse).filter(r => r.method !== "GET");
    const github = writes.filter(r => r.path.startsWith("/repos/"));
    assert.deepEqual(github.map(r => r.method), ["POST", "PUT", "POST"]);
    const content = JSON.parse(github[1].body);
    assert.match(Buffer.from(content.content, "base64").toString(), /draft: true[\s\S]*Fixture introduction/);
    assert.equal(JSON.parse(github[2].body).head, content.branch);
    const refused = spawnSync(process.execPath, args, { env: { ...env, FAIL_WRITE: "1" }, encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.doesNotMatch(refused.stderr, /pull request: https/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
