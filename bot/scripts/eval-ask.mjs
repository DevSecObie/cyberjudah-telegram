#!/usr/bin/env node
/** Offline by default. Live staging requires the owner's explicit budget and server ceiling. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MODELS } from '../../shared/ask-models.mjs';
import { guardVerses } from '../src/verse-guard.mjs';
import { parseReference } from '../src/refs.mjs';
import { evaluateAnswer, offlineChecks, summarize, markdown, versionsOf } from '../evals/ask-eval.mjs';
const root = new URL('../../', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(`../evals/${name}.json`, import.meta.url), 'utf8'));

export function options(args) {
  const out = { live: false, study: false, models: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--live') out.live = true;
    else if (arg === '--offline') out.offline = true;
    else if (arg === '--study') out.study = true;
    else if (arg === '--model' || arg === '--models') {
      if (out.models.length || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Specify one --model or comma-separated --models list.');
      out.models = args[++i].split(',').map(id => {
        const model = MODELS.find(m => m.id === id || m.native === id);
        if (!model) throw new Error('Unknown model id.');
        return model;
      });
      if (arg === '--model' && out.models.length !== 1) throw new Error('--model takes one model.');
    } else throw new Error('Unknown option. Use --offline or --live [--study] --models id,id.');
  }
  if (out.live && out.offline) throw new Error('Choose offline or live.');
  if (out.models.length > 8 || new Set(out.models.map(m => m.id)).size !== out.models.length) throw new Error('Use 1–8 distinct models.');
  if (!out.live && out.models.length) throw new Error('Model matrices require --live; offline checks do not evaluate models.');
  return out;
}

export function liveSettings(env, count, models) {
  if (env.ASK_EVAL_LIVE_ENABLED !== 'true') throw new Error('Live eval is disabled. Owner approval is required.');
  if (!models.length) throw new Error('Live eval requires explicit --model or --models.');
  let url;
  try { url = new URL(env.ASK_URL); } catch { throw new Error('Set the staging ASK_URL origin.'); }
  if (url.origin !== 'https://cyberjudah-telegram-staging.oisrae1.workers.dev' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Only the staging Worker origin is permitted.');
  let data;
  try { data = new URL(env.DATA_ORIGIN || 'https://data.cyberjudah.io'); } catch { throw new Error('Invalid DATA_ORIGIN.'); }
  if (data.protocol !== 'https:' || data.username || data.password || data.search || data.hash || data.pathname !== '/') throw new Error('DATA_ORIGIN must be an HTTPS origin.');
  if (!env.ASK_TOKEN) throw new Error('Set ASK_TOKEN in the environment.');
  const budget = Number(env.ASK_EVAL_BUDGET_USD), ceiling = Number(env.ASK_EVAL_SERVER_CEILING_USD), maxRequests = Number(env.ASK_EVAL_MAX_REQUESTS);
  // The app endpoint has no budget field. The owner must verify the deployed ceiling includes
  // fallback and tool costs. This reservation is not a runner-enforced dollar spending cap.
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(ceiling) || ceiling <= 0 || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error('Set positive budget, verified server ceiling and max requests (1–1000).');
  const requests = count * models.length;
  if (requests > maxRequests || requests * ceiling > budget + Number.EPSILON) throw new Error('Planned matrix exceeds the approved request or budget reservation.');
  return { base: url.origin, data: data.origin, token: env.ASK_TOKEN, budget, ceiling, requests };
}

async function json(fetcher, url, init = {}) {
  const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error('request-failed');
  return response.json();
}

export async function liveRun(items, model, settings, study, fetcher = fetch) {
  const rows = [], versions = [], chapters = new Map();
  let books, consecutiveFailures = 0, completedCases = 0;
  const data = settings.data ?? 'https://data.cyberjudah.io';
  for (const item of items) {
    const start = Date.now();
    try {
      const body = await json(fetcher, `${settings.base}/api/app/ask`, { method: 'POST', headers: { authorization: `Bearer ${settings.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ q: item.q, history: item.history ?? [], consent: [...new Set([model.provider, 'Cloudflare (Workers AI)'])], model: model.id, ...(study ? { ui: 'study-v1' } : {}) }) });
      if (typeof body?.answer !== 'string' || !body.answer.trim()) throw new Error('request-failed');
      const row = evaluateAnswer(item, body);
      try {
          books ??= await json(fetcher, `${data}/api/kjv/books.json`);
          if (!Array.isArray(books) || !books.length) throw new Error('corpus-unavailable');
          // Preflight chapter reads outside guardVerses: it intentionally swallows a rejected
          // chapter read at runtime. An eval must report an outage separately from a misquote.
          for (const match of body.answer.matchAll(/\*\*([^*]{3,60}?)\*\*/g)) {
            const ref = parseReference(match[1].replace(/\s*\(KJV\)\s*$/i, ''), books);
            if (!ref?.verse) continue;
            const key = `${ref.slug}/${ref.chapter}`;
            if (!chapters.has(key)) {
              const value = await json(fetcher, `${data}/api/kjv/${key}.json`);
              if (!Array.isArray(value?.verses)) throw new Error('corpus-unavailable');
              chapters.set(key, value);
            }
          }
          const guard = await guardVerses(body.answer, books, async (slug, ch) => chapters.get(`${slug}/${ch}`));
          const exact = !guard.fixed && !guard.removed;
          row.checks.push({ id: 'verse-exact', pass: exact, score: Number(exact) });
          row.verses = guard.checked;
      } catch { row.checks.push({ id: 'verse-corpus-available', pass: false, score: 0 }); }
      row.versions = versionsOf(body.versions, body.model);
      row.writerOutcome = row.versions.model === 'unavailable' ? 'unavailable' : row.versions.model === 'approved' ? 'approved' : [model.id, model.native].includes(row.versions.model) ? 'requested' : 'different-writer';
      versions.push(row.versions);
      rows.push({ ...row, ms: Date.now() - start });
      completedCases++;
      consecutiveFailures = 0;
    } catch {
      // Never persist errors, questions, answers, URLs, user IDs or credentials.
      rows.push({ id: item.id, kind: item.kind ?? 'question', checks: [{ id: 'request-ok', pass: false, score: 0 }], ms: Date.now() - start });
      if (++consecutiveFailures >= 3) break;
    }
  }
  return { scope: 'live-staging', requestedModel: model.id, study, plannedCases: items.length, attemptedCases: rows.length, completedCases, skippedCases: items.length - rows.length, abortReason: consecutiveFailures >= 3 ? 'consecutive-request-failures' : null, versions, ...summarize(rows), rows };
}

export async function runMatrix(items, models, settings, study, saveRun, fetcher = fetch) {
  for (const model of models) saveRun(await liveRun(items, model, settings, study, fetcher));
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const opts = options(args), redteam = load('redteam'), recorded = load('guardrail-recorded');
  const items = [...load('ask-questions').questions, ...redteam.cases.filter(item => item.surface === 'question')];
  const settings = opts.live ? liveSettings(env, items.length, opts.models) : null;
  const date = new Date().toISOString();
  const git = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  const directory = new URL('../evals/results/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const prefix = `${date.replace(/[:.]/g, '-')}-${git.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
  const runs = [];
  const saveRun = run => {
    const index = runs.length;
    const result = { schema: 1, date, git, gitScope: 'eval-checkout', deployedGit: null, dirty, goldenAnswers: 'owner-review-pending', releaseGate: 'off', ...(settings ? { requestedModels: opts.models.map(model => model.id), budgetReservation: { usd: settings.budget, verifiedServerCeilingUsd: settings.ceiling, plannedRequests: settings.requests, enforcedByRunner: false } } : {}), ...run };
    writeFileSync(new URL(`${prefix}-${index}.json`, directory), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    runs.push(run);
  };
  saveRun({ scope: 'offline-boundary-and-checker-calibration', modelCalls: 0, requestedModel: null, versions: [], ...offlineChecks(redteam, recorded, load('grounding-recorded').cases) });
  if (opts.live && runs[0].passed === runs[0].total) await runMatrix(items, opts.models, settings, opts.study, saveRun);
  const report = markdown({ date, git, dirty, runs });
  writeFileSync(new URL(`${prefix}.md`, directory), report, { flag: 'wx' });
  console.log(report);
  return runs.every(run => run.passed === run.total && (!run.plannedCases || run.completedCases === run.plannedCases)) ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
