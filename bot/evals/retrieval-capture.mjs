import { digest, contextKey, statementKey, referenceKey, retrievalRuntime, withPublicMetadata, evaluateCase } from './retrieval-replay.mjs';
import { validateGolden } from './retrieval-golden.mjs';

/** Only these two Workers AI models may run; this adapter has no generation API. */
export function stagingTarget(config) {
  const stage = config.env?.staging;
  const db = stage?.d1_databases?.find((row) => row.binding === 'DB');
  const index = stage?.vectorize?.find((row) => row.binding === 'VEC')?.index_name;
  if (!db?.database_name?.endsWith('-staging') || !index) throw new Error('Missing named staging retrieval bindings');
  if (config.vectorize?.some((row) => row.index_name === index)) throw new Error('Staging shares the production Vectorize index; clarify the approved read-only boundary before live capture');
  return { databaseName: db.database_name, index };
}

export function boundedCloudflare({ account, token, fetch: request = globalThis.fetch.bind(globalThis), maxCalls = 500 }) {
  if (!/^[a-f0-9]{32}$/i.test(account ?? '') || !token) throw new Error('Cloudflare account/token must be supplied in the process environment');
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 500) throw new Error('Live evaluation is capped at 500 calls');
  const counts = { total: 0, embedding: 0, rerank: 0, vector: 0, d1: 0, metadata: 0 };
  const call = async (category, path, body) => {
    const allowed = { embedding: /^\/ai\/run\/@cf\/baai\/bge-m3$/, rerank: /^\/ai\/run\/@cf\/baai\/bge-reranker-base$/, vector: /^\/vectorize\/v2\/indexes\/[a-z0-9-]+\/query$/, d1: /^\/d1\/database\/[a-f0-9-]+(?:\/query)?$/, metadata: /^\/d1\/database$/ };
    if (!allowed[category]?.test(path) || counts.total >= maxCalls) throw new Error('Unapproved endpoint or live call limit reached');
    counts.total++; counts[category]++;
    let response;
    try { response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error(`Cloudflare ${category} request failed; no retry was made`); }
    if (!response.ok) throw new Error(`Cloudflare ${category} HTTP ${response.status}`);
    const result = await response.json().catch(() => { throw new Error(`Cloudflare ${category} returned invalid JSON`); });
    if (result.success !== true || result.result === undefined) throw new Error(`Cloudflare ${category} returned an invalid result`);
    return result.result;
  };
  return { call, counts, maxCalls };
}

export function projectedCalls(golden, runtime, ranking) {
  // One embedding batch, rerank and semantic probe; each query/part has one vector and
  // up to three FTS passes. Include D1 resolution and reference-presence preflight.
  return 2 + golden.queries.reduce((total, q) => {
    const text = runtime.retrievalText(q.q, q.history ?? []);
    const parts = ranking === 'v2' ? runtime.questionParts(text).length : 0;
    return total + 3 + 4 * (1 + parts);
  }, 0);
}

/** Capture real public pools, retaining teacher metadata, without an answer or an account. */
export async function captureRetrieval(golden, target, api, notesIndex, options = {}) {
  validateGolden(golden);
  if (golden.queries.length > 60) throw new Error('A live run is capped at 60 questions; use an approved smaller golden revision');
  if (!target.databaseName?.endsWith('-staging') || !/^[a-z0-9-]+$/.test(target.index ?? '')) throw new Error('Invalid staging target');
  const runtime = options.runtime ?? await retrievalRuntime();
  const ranking = options.ranking ?? 'v1';
  if (!['v1', 'v2'].includes(ranking) || ranking === 'v2' && !runtime.RANKED) throw new Error('The requested ranking runtime is unavailable');
  const projectedMaxCalls = projectedCalls(golden, runtime, ranking);
  if (projectedMaxCalls > (api.maxCalls ?? 500)) throw new Error(`Projected ${projectedMaxCalls} calls exceed the ${api.maxCalls ?? 500}-call budget; no Cloudflare call was made`);
  const databases = await api.call('metadata', '/d1/database');
  const matches = databases.filter((row) => row.name === target.databaseName);
  if (matches.length !== 1 || !/^[a-f0-9-]{36}$/i.test(matches[0].uuid)) throw new Error('Staging D1 name did not resolve uniquely');
  const database = matches[0].uuid;
  const references = Object.keys(golden.references).sort();
  const checks = [{ sql: 'SELECT count(*) AS n FROM search_docs', params: [] }];
  for (let i = 0; i < references.length; i += 90) {
    const params = references.slice(i, i + 90);
    checks.push({ sql: `SELECT DISTINCT url FROM search_docs WHERE url IN (${params.map(() => '?').join(',')})`, params });
  }
  const verified = await api.call('d1', `/d1/database/${database}/query`, { batch: checks });
  const found = [...new Set(verified.slice(1).flatMap((r) => r.results?.map((row) => row.url) ?? []))].sort();
  const searchRows = verified[0]?.results?.[0]?.n;
  if (!verified.every((r) => r.success === true) || !Number.isSafeInteger(searchRows) || searchRows < 1 || digest(found) !== digest(references)) throw new Error('Staging search corpus does not contain every proposed reference; review the corpus and labels before model calls');
  const recording = { version: 1, ranking, goldenSha256: digest(golden), provenance: { mode: 'live-staging-workers-ai-only', capturedAt: new Date().toISOString(), databaseName: target.databaseName, vectorIndex: target.index, answerCalls: 0,
    runtimeSha256: runtime.codeSha256, projectedMaxCalls, notesIndexSha256: digest(notesIndex), notesIndexRows: notesIndex.length,
    corpus: { goldenLibrarySha256: golden.provenance.sourceSha256, verifiedReferenceSetSha256: digest(found), references: found.length, searchRows, limitation: 'Reference presence, not proof that all staging and vector text equals the labeled SQLite snapshot' } }, metadata: { notesIndex, sourcePolicyKV: null }, records: [] };
  await withPublicMetadata(notesIndex, async (origin) => {
    for (const query of golden.queries) {
      const text = runtime.retrievalText(query.q, query.history ?? []);
      const embeddingQueries = ranking === 'v2' ? [text, ...runtime.questionParts(text)] : [text];
      const record = { id: query.id, query: text, embeddingQueries, embeddingModel: runtime.EMBED_MODEL, rerankModel: runtime.RERANK_MODEL, vectorQueries: [], ftsBatches: [], rerankScores: [] };
      const errors = [];
      const checked = async (work) => { try { return await work(); } catch (error) { errors.push(error.message); throw error; } };
      const vectors = new Map();
      let vector;
      const unsupported = (method) => { const message = `Uncaptured D1 statement method: ${method}`; errors.push(message); throw new Error(message); };
      const statement = (sql, params = []) => ({ sql, params, bind: (...bound) => statement(sql, bound), all: async () => (await env.DB.batch([{ sql, params }]))[0], ...Object.fromEntries(['first', 'run', 'raw'].map((method) => [method, () => unsupported(method)])) });
      const env = { SITE_URL: 'https://cyberjudah.io', DATA_ORIGIN: origin, ...(ranking === 'v2' ? { ASK_RANKING: 'v2' } : {}), SUBS: { get: async () => null },
        DB: { prepare: statement, batch: (statements) => checked(async () => {
          if (statements.some(({ sql }) => !/^SELECT\b/i.test(sql) || !/\bFROM search_docs\b/.test(sql) || /;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|PRAGMA)\b/i.test(sql))) throw new Error('Only the production read-only search SELECT is allowed');
          const result = await api.call('d1', `/d1/database/${database}/query`, { batch: statements.map(({ sql, params }) => ({ sql, params })) });
          if (!Array.isArray(result) || result.length !== statements.length || result.some((row) => row.success !== true || !Array.isArray(row.results))) throw new Error('Incomplete D1 batch');
          // Retain public search rows, never the Cloudflare account or request headers.
          const rows = result.map((row) => ({ results: row.results }));
          record.ftsBatches.push({ key: statementKey(statements), statements, result: rows }); return rows;
        }) },
        AI: { run: (model, input) => checked(async () => {
          if (model === runtime.EMBED_MODEL) {
            if (digest(input.text) !== digest(embeddingQueries)) throw new Error('Only the reader query and deterministic split may be embedded');
            const result = await api.call('embedding', `/ai/run/${model}`, input);
            vector = result.data?.[0];
            if (!Array.isArray(result.data) || result.data.length !== embeddingQueries.length || result.data.some((v) => !Array.isArray(v) || v.length !== 1024 || !v.every(Number.isFinite))) throw new Error('Invalid embedding');
            result.data.forEach((value, index) => vectors.set(value, embeddingQueries[index]));
            return result;
          }
          if (model !== runtime.RERANK_MODEL || input.query !== text || !Array.isArray(input.contexts) || input.contexts.length > 200) throw new Error('Only the current Workers AI query/passage reranker is allowed');
          const result = await api.call('rerank', `/ai/run/${model}`, { ...input, top_k: input.contexts.length });
          const response = result.response;
          if (!Array.isArray(response) || response.length !== input.contexts.length || new Set(response.map((r) => r.id)).size !== response.length || response.some((r) => !Number.isInteger(r.id) || !input.contexts[r.id] || !Number.isFinite(r.score))) throw new Error('Incomplete rerank pair scores');
          for (const r of response) record.rerankScores.push({ key: contextKey(text, input.contexts[r.id].text), score: r.score });
          return { response: [...response].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, input.top_k) };
        }) },
        VEC: { query: (values, options) => checked(async () => {
          if (!vectors.has(values) || options.topK > 50 || options.returnMetadata !== 'all') throw new Error('Invalid retrieval vector query');
          const result = await api.call('vector', `/vectorize/v2/indexes/${target.index}/query`, { vector: values, ...options });
          if (!Array.isArray(result.matches) || result.matches.length > options.topK || new Set(result.matches.map((r) => r.id)).size !== result.matches.length || result.matches.some((r) => typeof r.id !== 'string' || !r.id || !Number.isFinite(r.score))) throw new Error('Invalid vector result');
          record.vectorQueries.push({ query: vectors.get(values), options, result }); return result;
        }) },
      };
      const evaluated = await evaluateCase(query, env, runtime);
      if (errors.length) throw new Error(`Live capture failed for ${query.id}: ${errors[0]}`);
      // A second, read-only top-50 probe calibrates the semantic cutoff; no extra embedding.
      const probe = await api.call('vector', `/vectorize/v2/indexes/${target.index}/query`, { vector, topK: 50, returnMetadata: 'all', returnValues: false });
      if (!Array.isArray(probe.matches) || probe.matches.length > 50 || probe.matches.some((r) => !Number.isFinite(r.score))) throw new Error('Invalid semantic vector probe');
      record.semanticProbe = probe.matches.flatMap((row) => { try { return [{ reference: referenceKey(row.metadata), score: row.score }]; } catch { return []; } });
      record.context = evaluated.context;
      recording.records.push(record);
    }
  });
  recording.provenance.callCounts = { ...api.counts };
  return recording;
}
