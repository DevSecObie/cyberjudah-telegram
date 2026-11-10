import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { scoreRetrieval } from './retrieval-metrics.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const digest = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
export const contextKey = (query, text) => digest([query, text]);
export const statementKey = (statements) => digest(statements.map(({ sql, params }) => ({ sql, params })));

const loading = new Map();
/** Bundle the current production functions, not a second implementation of their ranking. */
export function retrievalRuntime(sourceRoot = new URL('../../', import.meta.url)) {
  const root = new URL('./', sourceRoot).href;
  if (!loading.has(root)) loading.set(root, (async () => {
    const file = new URL(`../../.wrangler/retrieval-eval/runtime-${process.pid}-${digest(root).slice(0, 12)}.mjs`, import.meta.url);
    await mkdir(new URL('./', file), { recursive: true });
    const hasV2 = await access(new URL('bot/src/ranking.mjs', root)).then(() => true, () => false);
    await build({ stdin: { contents: 'export { retrieve, INITIAL_RETRIEVAL } from "./src/ai"; export { answerCandidates, retrievalText, EMBED_MODEL, RERANK_MODEL } from "./src/ai.mjs"; export { coverageDecision } from "./src/grounding.mjs"; export { classAttributor } from "./src/class-attribution";' + (hasV2 ? 'export { RANKED, TEACHER_LIFT, OVERLAP_LIFT, teacherLift, questionParts } from "./src/ranking.mjs";' : ''), resolveDir: new URL('bot/', root).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: file.pathname, logLevel: 'error' });
    return { ...await import(file.href), codeSha256: digest(await readFile(file, 'utf8')) };
  })().catch((error) => { loading.delete(root); throw error; }));
  return loading.get(root);
}

/** The first baseline uses public library reference URLs as its relevance unit. */
export function referenceKey(source) {
  if (typeof source?.url !== 'string' || !source.url) throw new Error('A candidate has no library reference');
  const u = new URL(source.url, 'https://cyberjudah.io');
  if (u.protocol !== 'https:') throw new Error('Invalid library reference protocol');
  return ['cyberjudah.io', 'www.cyberjudah.io'].includes(u.hostname) ? `${u.pathname}${u.search}${u.hash}` : u.href;
}
export const rankedReferences = (passages) => [...new Set(passages.map(referenceKey))];

/** Only public source fields; no request, account, headers or provider response envelopes. */
export function sourceSnapshot(source) {
  const out = {};
  for (const key of ['kind', 'title', 'url', 'sub', 'text', 'video', 't', 'date', 'teacher', 'score']) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

export async function withPublicMetadata(notesIndex, work) {
  if (!Array.isArray(notesIndex)) throw new Error('Missing recorded teacher metadata');
  const origin = `https://rag-${digest(notesIndex).slice(0, 16)}.invalid`;
  const previousCaches = globalThis.caches, previousFetch = globalThis.fetch;
  let unexpectedNetwork = false;
  globalThis.caches = { default: {
    async match(url) { return String(url) === `${origin}/api/notes/index.json` ? Response.json(notesIndex) : undefined; },
    async put() { throw new Error('Unexpected metadata cache write'); },
  } };
  globalThis.fetch = async () => { unexpectedNetwork = true; throw new Error('Uncontrolled network access is disabled in retrieval evaluation'); };
  try {
    const result = await work(origin);
    if (unexpectedNetwork) throw new Error('Retrieval attempted an uncontrolled network call');
    return result;
  } finally { globalThis.caches = previousCaches; globalThis.fetch = previousFetch; }
}

export function replayBindings(record, metadata, runtime) {
  const errors = [];
  const fail = (message) => { errors.push(message); throw new Error(message); };
  const usedStatements = new Set(), usedVectors = new Set();
  const vectors = new Map();
  let embedded = false;
  const statements = new Map((record.ftsBatches ?? []).map((batch) => [batch.key, batch.result]));
  const scores = new Map((record.rerankScores ?? []).map((row) => [row.key, row.score]));
  const statement = (sql, params = []) => ({ sql, params, bind: (...bound) => statement(sql, bound), all: async () => (await env.DB.batch([{ sql, params }]))[0], ...Object.fromEntries(['first', 'run', 'raw'].map((method) => [method, () => fail(`Uncaptured D1 statement method: ${method}`)])) });
  const env = {
    SITE_URL: 'https://cyberjudah.io',
    SUBS: { async get() { return metadata.sourcePolicyKV ?? null; } },
    DB: {
      prepare: statement,
      async batch(batch) {
        const key = statementKey(batch), result = statements.get(key);
        usedStatements.add(key);
        return result ? structuredClone(result) : fail('FTS request was not captured');
      },
    },
    AI: { async run(model, input) {
      if (model === runtime.EMBED_MODEL) {
        const queries = record.embeddingQueries ?? [record.query];
        if (record.embeddingModel !== model || digest(input.text) !== digest(queries)) return fail('Embedding model/query differs from recording');
        embedded = true;
        // Vector values are unnecessary to replay the frozen nearest-neighbour response.
        const data = queries.map((query, index) => { const value = [index]; vectors.set(value, query); return value; });
        return { data };
      }
      if (model !== runtime.RERANK_MODEL || record.rerankModel !== model || input.query !== record.query || !Array.isArray(input.contexts)) return fail('Rerank model/query differs from recording');
      const response = input.contexts.map(({ text }, id) => {
        const score = scores.get(contextKey(input.query, text));
        if (typeof score !== 'number' || !Number.isFinite(score)) return fail('Rerank query/passage pair was not captured');
        return { id, score };
      }).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, input.top_k);
      return { response };
    } },
    VEC: { async query(vector, options) {
      const query = vectors.get(vector);
      const key = digest([query, options]);
      const result = record.vectorQueries?.find((entry) => (entry.query ?? record.query) === query && digest(entry.options) === digest(options))?.result;
      usedVectors.add(key);
      return result ? structuredClone(result) : fail('Vector query options were not captured');
    } },
  };
  return { env, errors, complete() {
    if (!embedded || (record.ftsBatches ?? []).some((r) => !usedStatements.has(r.key)) || (record.vectorQueries ?? []).some((r) => !usedVectors.has(digest([r.query ?? record.query, r.options])))) fail('A recorded production request was skipped');
  } };
}

/** Same first-pass call shape as ask/askStream: rerank 12, then answerCandidates 8. */
export async function evaluateCase(query, env, runtime) {
  const stages = {};
  const text = runtime.retrievalText(query.q, query.history ?? []);
  const passages = await runtime.retrieve(env, text, runtime.INITIAL_RETRIEVAL.rerank, undefined, undefined, (stage, sources) => { stages[stage] = sources; });
  stages.answerCandidates = runtime.answerCandidates(query.q, passages, runtime.INITIAL_RETRIEVAL.context);
  const coverage = runtime.coverageDecision(query.q, stages.answerCandidates);
  return { id: query.id, stages: Object.fromEntries(Object.entries(stages).map(([name, sources]) => [name, rankedReferences(sources)])), coverage,
    context: stages.answerCandidates.map(sourceSnapshot),
    candidateCounts: Object.fromEntries(Object.entries(stages).map(([name, sources]) => [name, sources.length])),
  };
}

export async function recordedRetrieval(golden, recording, options = {}) {
  if (recording.goldenSha256 !== digest(golden)) throw new Error('Golden-set fingerprint differs from recording');
  if (recording.records?.length !== golden.queries.length || new Set(recording.records.map((r) => r.id)).size !== recording.records.length) throw new Error('Incomplete or duplicate recorded queries');
  const runtime = options.runtime ?? await retrievalRuntime();
  const ranking = recording.ranking ?? 'v1';
  if (!['v1', 'v2'].includes(ranking) || ranking === 'v2' && !runtime.RANKED) throw new Error('The requested ranking runtime is unavailable');
  if (options.teacherLift && (ranking !== 'v2' || !runtime.TEACHER_LIFT)) throw new Error('Teacher lift sweeps require the v2 runtime');
  if (options.teacherLift && (Object.keys(options.teacherLift).length !== 2 || !['bishop', 'deacon'].every((key) => Object.hasOwn(runtime.TEACHER_LIFT, key) && Number.isFinite(options.teacherLift[key])))) throw new Error('Unknown teacher-lift keys or values');
  const previousLift = runtime.TEACHER_LIFT && { ...runtime.TEACHER_LIFT };
  const records = new Map(recording.records.map((record) => [record.id, record]));
  try {
    if (options.teacherLift) {
      Object.assign(runtime.TEACHER_LIFT, options.teacherLift);
      if (runtime.teacherLift?.('Bishop') !== options.teacherLift.bishop || runtime.teacherLift?.('Deacon') !== options.teacherLift.deacon) throw new Error('Teacher-lift control does not affect the actual ranking helper');
    }
    return await withPublicMetadata(recording.metadata?.notesIndex, async (origin) => {
    const results = [];
    for (const query of golden.queries) {
      const record = records.get(query.id);
      if (!record || record.error || record.query !== runtime.retrievalText(query.q, query.history ?? [])) throw new Error(`Invalid recording for ${query.id}`);
      const { env, errors, complete } = replayBindings(record, recording.metadata, runtime);
      env.DATA_ORIGIN = origin;
      if (ranking === 'v2') env.ASK_RANKING = 'v2';
      const result = await evaluateCase(query, env, runtime);
      if (errors.length) throw new Error(`Recording is insufficient for ${query.id}: ${errors[0]}`);
      complete();
      results.push(result);
    }
    return { ...scoreRetrieval(golden.queries, results), approval: golden.approval, mode: 'recorded', ranking, relevanceUnit: 'library-reference-url', goldenSha256: digest(golden), recordingSha256: digest(recording), contexts: results.map(({ id, coverage, context, candidateCounts }) => ({ id, coverage, references: rankedReferences(context),
      teacherCounts: { bishop: context.filter((p) => /^bishop\b/i.test(p.teacher ?? '')).length, deacon: context.filter((p) => /^deacon\b/i.test(p.teacher ?? '')).length, otherRecorded: context.filter((p) => p.teacher && !/^(bishop|deacon)\b/i.test(p.teacher)).length, unnamed: context.filter((p) => !p.teacher).length }, candidateCounts })) };
  }); } finally { if (previousLift) Object.assign(runtime.TEACHER_LIFT, previousLift); }
}
