import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { digest, recordedRetrieval, retrievalRuntime } from '../evals/retrieval-replay.mjs';
import { retrievalRegressions } from '../evals/retrieval-metrics.mjs';
import { coverageCalibration, semanticCalibration } from '../evals/retrieval-calibration.mjs';
import { validateGolden } from '../evals/retrieval-golden.mjs';
import { boundedCloudflare, captureRetrieval, stagingTarget } from '../evals/retrieval-capture.mjs';
import { beforeAfter, teacherLiftSweep, validateComparisonInputs } from '../evals/retrieval-comparison.mjs';

const root = new URL('../evals/', import.meta.url);
const json = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const encoded = (data) => `${JSON.stringify(data, null, 2)}\n`;

export async function main(args = process.argv.slice(2), env = process.env) {
  const allowed = new Set(['--recorded', '--capture-staging', '--bootstrap-baseline', '--compare']);
  if (args.length !== 1 || !allowed.has(args[0])) throw new Error('Choose --recorded, --capture-staging or --bootstrap-baseline (manual only)');
  const golden = validateGolden(await json('retrieval-golden.json'));
  if (env.ASK_RANKING && env.ASK_RANKING !== 'v2') throw new Error('Leave ASK_RANKING unset for v1, or set it to v2');
  const ranking = env.ASK_RANKING === 'v2' ? 'v2' : 'v1';
  if (env.CI && env.RAG_EVAL_SOURCE_ROOT) throw new Error('CI must evaluate its checked-out production source');
  const runtime = env.RAG_EVAL_SOURCE_ROOT ? await retrievalRuntime(pathToFileURL(`${env.RAG_EVAL_SOURCE_ROOT.replace(/\/$/, '')}/`)) : await retrievalRuntime();
  const recordingFile = `retrieval-recorded-${ranking}.json`, baselineFile = `retrieval-baseline-${ranking}.json`;
  if (args[0] === '--compare') {
    const [v1, v2] = await Promise.all(['v1', 'v2'].map((mode) => json(`retrieval-recorded-${mode}.json`)));
    validateComparisonInputs(v1, v2);
    const before = await recordedRetrieval(golden, v1, { runtime });
    const after = await recordedRetrieval(golden, v2, { runtime });
    console.log(encoded({ approval: golden.approval, beforeAfter: beforeAfter(before, after), calls: { v1: v1.provenance.callCounts, v2: v2.provenance.callCounts }, teacherLift: await teacherLiftSweep(golden, v2, runtime), coverage: coverageCalibration(golden, after), semantic: semanticCalibration(golden, v2) }));
    return;
  }
  if (args[0] === '--capture-staging') {
    // This is an environment check, not proof of owner approval or a billing authorization.
    if (env.CI || env.RAG_EVAL_LIVE !== 'staging-workers-ai-only') throw new Error('Live capture is manual only; explicit owner approval and RAG_EVAL_LIVE are required');
    const exists = await access(new URL(recordingFile, root)).then(() => true, () => false);
    if (exists) throw new Error('An existing recording must be reviewed and archived before another live capture');
    const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    if (parsed.error) throw new Error('Invalid wrangler configuration');
    const target = stagingTarget(parsed.config);
    const api = boundedCloudflare({ account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN });
    try {
      const response = await fetch('https://data.cyberjudah.io/api/notes/index.json', { redirect: 'error', headers: { 'User-Agent': 'CyberJudah-Retrieval-Eval/1.0' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Public teacher metadata HTTP ${response.status}`);
      const raw = await response.json();
      if (!Array.isArray(raw)) throw new Error('Invalid public teacher index');
      const notes = raw.map((r) => Object.fromEntries(['url', 'videoId', 'teacher', 'date'].filter((key) => typeof r[key] === 'string').map((key) => [key, r[key]])));
      const recording = await captureRetrieval(golden, target, api, notes, { runtime, ranking });
      // Never overwrite an approved capture or hide a partial run as a complete recording.
      await writeFile(new URL(recordingFile, root), encoded(recording), { flag: 'wx' });
    } finally { console.log(JSON.stringify({ event: 'retrieval_eval_calls', ...api.counts, publicMetadata: 1, answerCalls: 0 })); }
    return;
  }
  const recording = await json(recordingFile);
  if (recording.ranking !== ranking) throw new Error('Recording ranking mode differs');
  const report = await recordedRetrieval(golden, recording, { runtime });
  report.calibration = { coverage: coverageCalibration(golden, report), semantic: semanticCalibration(golden, recording) };
  if (args[0] === '--bootstrap-baseline') {
    if (env.CI) throw new Error('Baseline creation is manual and must be reviewed');
    await writeFile(new URL(baselineFile, root), encoded(report), { flag: 'wx' });
    console.log(JSON.stringify({ status: 'baseline proposed; review required', queries: report.queries, goldenSha256: report.goldenSha256, recordingSha256: report.recordingSha256 }));
    return;
  }
  const baseline = await json(baselineFile);
  if (baseline.goldenSha256 !== digest(golden) || baseline.recordingSha256 !== digest(recording)) throw new Error('Baseline fingerprints changed; a new capture/label revision requires explicit review');
  const regressions = retrievalRegressions(baseline, report);
  // Only IDs, URLs, numerical features and counts reach the report. Source bodies remain in fixtures.
  console.log(encoded({ ...report, regressions }));
  if (regressions.length) throw new Error(`Retrieval regression: ${regressions.length} recall@10/nDCG@10 drops`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  // No stack, headers or response envelope: captures may have used process-only credentials.
  console.error(error.code === 'ENOENT' ? 'Retrieval evaluation needs the reviewed retrieval-recorded-v1/v2.json and retrieval-baseline-v1/v2.json; no measurement has been substituted.' : error.message);
  process.exitCode = 1;
});
