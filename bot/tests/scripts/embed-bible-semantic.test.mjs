import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../scripts/embed-bible-semantic.mjs', import.meta.url));
const index = 'cyberjudah-bible-fixture';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cj-semantic-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const revision = 'a'.repeat(64);
  const raw = Array.from({ length: 33 }, (_, n) => JSON.stringify({ id: `KJV:1:1:${n + 1}`, text: `Verse ${n + 1}`, metadata: { book: 1, chapter: 1, verse: n + 1, revision, text: `Text ${n + 1}` } })).join('\n') + '\n';
  const manifest = { version: 1, model: '@cf/baai/bge-m3', dimensions: 1024, revision, recordCount: 33, sha256: createHash('sha256').update(raw).digest('hex'), metadataIndexes: { book: 'number', revision: 'string' } };
  writeFileSync(join(dir, 'records.ndjson'), raw);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const mock = join(dir, 'mock.mjs');
  writeFileSync(mock, `
import { appendFileSync } from 'node:fs';
let embeddings = 0;
globalThis.fetch = async (url, options) => {
  // There is no network fallback. Every request terminates in this mock.
  if (!url.startsWith('https://api.cloudflare.com/client/v4/accounts/' + '1'.repeat(32))) throw Error('Unexpected account');
  const path = new URL(url).pathname;
  appendFileSync(process.env.CALL_LOG, path + '\\n');
  let result;
  if (path.endsWith('/metadata_index/list')) result = { metadataIndexes: process.env.SCENARIO === 'missing-index' ? [] : [{propertyName:'book',indexType:'number'},{propertyName:'revision',indexType:'string'}] };
  else if (path.includes('/ai/run/')) {
    embeddings++;
    if (process.env.SCENARIO === 'provider-failure' && embeddings === 2) return Response.json({ success: false }, { status: 503 });
    const input = JSON.parse(options.body).text;
    result = { data: input.map(() => Array(1024).fill(process.env.SCENARIO === 'bad-vector' ? null : 0.25)) };
  } else if (path.endsWith('/upsert')) {
    if (options.headers['content-type'] !== 'application/x-ndjson' || new URL(url).searchParams.get('unparsable-behavior') !== 'error') throw Error('Invalid upsert transport');
    const rows = options.body.trim().split('\\n').map(JSON.parse);
    if (!rows.every(r => r.values.length === 1024 && r.metadata.revision.length === 64)) throw Error('Invalid vector payload');
    result = process.env.SCENARIO === 'missing-receipt' ? {} : { mutationId: 'fixture-mutation' };
  } else result = { config: { dimensions: 1024, metric: 'cosine' } };
  return Response.json({ success: true, result });
};
`);
  const log = join(dir, 'calls');
  const checkpoint = join(dir, `${index}.checkpoint.json`);
  function run(args = [], scenario = '') {
    const r = spawnSync(process.execPath, ['--import', mock, script, '--input', dir, '--index', index, ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, SCENARIO: scenario, CALL_LOG: log,
        ...(args.includes('--apply') ? { CLOUDFLARE_ACCOUNT_ID: '1'.repeat(32), CLOUDFLARE_API_TOKEN: 'mock-only-never-a-real-token' } : {}) },
    });
    return { ...r, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  }
  return { dir, manifest, run, checkpoint, log };
}

test('default plan needs no credentials and makes no network calls; forbidden target and tampering fail', t => {
  const f = fixture(t);
  const plan = f.run();
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /plan-only/);
  assert.deepEqual(plan.calls, []);
  const forbidden = spawnSync(process.execPath, [script, '--input', f.dir, '--index', 'cyberjudah-teachings'], { encoding: 'utf8', env: {} });
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /live teachings index is forbidden/);
  writeFileSync(join(f.dir, 'records.ndjson'), 'tampered');
  const bad = f.run(['--apply']);
  assert.notEqual(bad.status, 0);
  assert.deepEqual(bad.calls, []);
});

test('requires metadata filters before paid inference and stops on invalid vectors or missing write receipts', t => {
  for (const scenario of ['missing-index', 'bad-vector', 'missing-receipt']) {
    const f = fixture(t), r = f.run(['--apply'], scenario);
    assert.notEqual(r.status, 0, scenario);
    assert.equal(existsSync(f.checkpoint), false);
    if (scenario === 'missing-index') assert.equal(r.calls.some(p => p.includes('/ai/run/')), false);
    if (scenario === 'bad-vector') assert.equal(r.calls.some(p => p.endsWith('/upsert')), false);
  }
});

test('resumes only acknowledged batches and binds checkpoint to account, index and exact input', t => {
  const f = fixture(t), interrupted = f.run(['--apply'], 'provider-failure');
  assert.notEqual(interrupted.status, 0);
  const checkpoint = JSON.parse(readFileSync(f.checkpoint, 'utf8'));
  assert.equal(checkpoint.completed, 32);
  writeFileSync(f.log, '');
  const resumed = f.run(['--apply']);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(resumed.calls.filter(p => p.includes('/ai/run/')).length, 1);
  assert.equal(JSON.parse(readFileSync(f.checkpoint, 'utf8')).completed, 33);
  assert.match(resumed.stdout, /not-performed/);
  writeFileSync(f.checkpoint, JSON.stringify({ ...checkpoint, account: '2'.repeat(32) }));
  writeFileSync(f.log, '');
  const wrong = f.run(['--apply']);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /Checkpoint does not match/);
  assert.equal(wrong.calls.some(p => p.includes('/ai/run/')), false);
});
