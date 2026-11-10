import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boundedCloudflare, captureRetrieval, stagingTarget, projectedCalls } from '../evals/retrieval-capture.mjs';
import { retrievalRuntime } from '../evals/retrieval-replay.mjs';
import { validateGolden } from '../evals/retrieval-golden.mjs';
import { recordedRetrieval } from '../evals/retrieval-replay.mjs';
import { main } from '../scripts/eval-retrieval.mjs';
import ts from 'typescript';

const golden = JSON.parse(await readFile(new URL('../evals/retrieval-golden.json', import.meta.url), 'utf8'));

test('all 60 proposed questions are existing fixture questions and contain no answers', async () => {
  validateGolden(golden);
  const ground = JSON.parse(await readFile(new URL('../evals/grounding-recorded.json', import.meta.url), 'utf8'));
  const ask = JSON.parse(await readFile(new URL('../evals/ask-questions.json', import.meta.url), 'utf8'));
  const questions = new Set([...ground.cases.map((q) => q.question), ...ask.questions.map((q) => q.q)]);
  assert.equal(golden.queries.length, 60);
  assert.equal(new Set(golden.queries.map((q) => q.q)).size, 60);
  assert.ok(golden.queries.every((q) => questions.has(q.q)));
  assert.equal(golden.provenance.sourceSha256, ground.provenance.sha256);
  const answered = structuredClone(golden); answered.queries[0].answer = 'Preview test (not an answer)';
  assert.throws(() => validateGolden(answered), /no reference answers/);
  const badHistory = structuredClone(golden); badHistory.queries[0].history = [{ role: 'user', text: 'Preview' }];
  assert.throws(() => validateGolden(badHistory), /history/);
});

test('live preflight refuses production or the presently shared staging Vectorize index', async () => {
  const config = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).config;
  assert.throws(() => stagingTarget(config), /shares the production/);
  const fixture = structuredClone(config); fixture.env.staging.vectorize[0].index_name = 'preview-staging';
  assert.deepEqual(stagingTarget(fixture), { databaseName: 'cyberjudah-telegram-staging', index: 'preview-staging' });
  fixture.env.staging.d1_databases[0].database_name = 'production';
  assert.throws(() => stagingTarget(fixture), /staging retrieval/);
  await assert.rejects(main(['--capture-staging'], { CI: 'true', RAG_EVAL_LIVE: 'staging-workers-ai-only' }), /manual only/);
});

test('Cloudflare adapter limits endpoints, calls, redirects and credential exposure with no retries', async () => {
  const requests = [];
  const api = boundedCloudflare({ account: 'a'.repeat(32), token: 'preview-test-credential', maxCalls: 1, fetch: async (url, options) => { requests.push({ url, options }); return Response.json({ success: true, result: [] }); } });
  await assert.rejects(api.call('rerank', '/ai/run/other-model', {}), /Unapproved/);
  assert.equal(api.counts.total, 0);
  await api.call('metadata', '/d1/database');
  await assert.rejects(api.call('metadata', '/d1/database'), /call limit/);
  assert.equal(requests.length, 1); assert.equal(requests[0].options.redirect, 'error');
  const failed = boundedCloudflare({ account: 'a'.repeat(32), token: 'preview-test-credential', fetch: async () => { throw new Error('preview-test-credential'); } });
  await assert.rejects(failed.call('metadata', '/d1/database'), (error) => !error.message.includes('preview-test-credential') && error.message.includes('no retry'));
  assert.equal(failed.counts.total, 1);
});

test('an over-budget split-query run is refused before the first Cloudflare call', async () => {
  const runtime = { ...await retrievalRuntime(), RANKED: Symbol('preview'), questionParts: () => ['preview one', 'preview two', 'preview three'] };
  const api = boundedCloudflare({ account: 'a'.repeat(32), token: 'preview-test-credential', fetch: () => { throw new Error('Unexpected fixture call'); } });
  assert.equal(projectedCalls(golden, runtime, 'v1'), 422);
  assert.equal(projectedCalls(golden, runtime, 'v2'), 1142);
  await assert.rejects(captureRetrieval(golden, { databaseName: 'preview-staging', index: 'preview-staging' }, api, [], { runtime, ranking: 'v2' }), /Projected 1142 calls/);
  assert.equal(api.counts.total, 0);
});

test('manual capture records every query and replays offline; fixture calls never reach a network', async () => {
  const requested = [];
  const preview = 'Preview test (not an answer). Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.';
  const documents = [0, 1].map((n) => ({ id: `preview-${n}`, score: n ? 0.8 : 0.2, metadata: { kind: 'study', title: `Preview ${n} test (not an answer)`, url: `/study/preview/${n + 1}`, text: preview } }));
  const api = boundedCloudflare({ account: 'a'.repeat(32), token: 'preview-test-credential', fetch: async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    requested.push(path);
    let result;
    if (path.endsWith('/d1/database')) result = [{ name: 'preview-staging', uuid: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) }];
    else if (path.endsWith('/query') && path.includes('/d1/')) result = body.batch.map(({ sql, params }) => ({ success: true, results: sql === 'SELECT count(*) AS n FROM search_docs' ? [{ n: 1000 }] : sql.startsWith('SELECT DISTINCT url') ? params.map((url) => ({ url })) : [] }));
    else if (path.endsWith('/bge-m3')) result = { data: [Array(1024).fill(0)] };
    else if (path.endsWith('/bge-reranker-base')) result = { response: body.contexts.map((_, id) => ({ id, score: id ? 0.3 : 0.9 })) };
    else if (path.includes('/vectorize/')) result = { matches: documents };
    else throw new Error('Unexpected fixture API');
    return Response.json({ success: true, result });
  } });
  const recording = await captureRetrieval(golden, { databaseName: 'preview-staging', index: 'preview-staging' }, api, [{ url: '/study/preview/1', teacher: 'Bishop Preview test (not an answer)' }]);
  assert.equal(recording.records.length, 60); assert.equal(recording.provenance.answerCalls, 0);
  assert.equal(api.counts.embedding, 60); assert.equal(api.counts.vector, 120); assert.equal(api.counts.rerank, 60);
  assert.ok(recording.records.every((r) => r.rerankScores.length === 2));
  assert.ok(recording.records.every((r) => r.context.some((p) => p.teacher === 'Bishop Preview test (not an answer)')));
  assert.ok(api.counts.total <= 500); assert.equal(api.counts.total, requested.length);
  assert.ok(requested.every((path) => !/claude|openai|chat|completions/.test(path)));
  const report = await recordedRetrieval(golden, recording);
  assert.equal(report.queries, 60); assert.equal(report.overall.merge['recall@10'], 0);
  assert.equal(JSON.stringify(recording).includes('preview-test-credential'), false);
});
