#!/usr/bin/env node
// Uses the existing Workers AI/Vectorize API and embedding model. Default is a local plan.
// --apply is a separate approved paid/write action; never called by deployment workflows.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EMBED_MODEL } from '../src/ai.mjs';

const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
if (!args.includes('--input') || !args.includes('--index')) throw new Error('Expected --input <prepared-directory> --index <new-bible-index> [--apply]');
const directory = resolve(option('--input')), index = option('--index');
if (!/^cyberjudah-bible-[a-z0-9-]+$/.test(index) || index.length > 64) throw new Error('Use a separate CyberJudah Bible index; the live teachings index is forbidden.');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const raw = await readFile(resolve(directory, 'records.ndjson'), 'utf8');
if (manifest.version !== 1 || manifest.model !== EMBED_MODEL || manifest.dimensions !== 1024 ||
    !/^[a-f0-9]{64}$/.test(manifest.revision) || manifest.metadataIndexes?.book !== 'number' || manifest.metadataIndexes?.revision !== 'string' ||
    createHash('sha256').update(raw).digest('hex') !== manifest.sha256) throw new Error('Invalid prepared input');
const records = raw.trim().split('\n').map(line => JSON.parse(line));
if (records.length !== manifest.recordCount || new Set(records.map(r => r.id)).size !== records.length ||
    records.some(r => typeof r.text !== 'string' || r.metadata?.revision !== manifest.revision ||
      !Number.isInteger(r.metadata?.book) || !Number.isInteger(r.metadata?.chapter) || !Number.isInteger(r.metadata?.verse) ||
      r.metadata.book < 1 || r.metadata.book > 81 || r.metadata.chapter < 1 || r.metadata.verse < 1 ||
      typeof r.metadata.text !== 'string' || r.id !== `KJV:${r.metadata.book}:${r.metadata.chapter}:${r.metadata.verse}`)) throw new Error('Incomplete prepared input');
console.log(JSON.stringify({ index, records: records.length, model: EMBED_MODEL, revision: manifest.revision,
  mode: args.includes('--apply') ? 'approved-write-requested' : 'plan-only', metadataIndexes: manifest.metadataIndexes }));
if (!args.includes('--apply')) process.exit(0);
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !/^[a-f0-9]{32}$/.test(account)) throw new Error('Existing authorized Cloudflare environment credentials are required.');
const api = async (path, body, ndjson = false) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': ndjson ? 'application/x-ndjson' : 'application/json' },
    ...(body === undefined ? {} : { body: ndjson ? body : JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok || value.success !== true) throw new Error(`Cloudflare operation failed (${response.status}); stopped without credential changes.`);
  return value.result;
};
const target = `/vectorize/v2/indexes/${index}`;
const details = await api(target);
if (details.config?.dimensions !== 1024 || details.config?.metric !== 'cosine') throw new Error('Index dimensions/metric mismatch');
// Metadata indexes must exist before any vector is inserted. This script never creates access or indexes.
const indexes = await api(`${target}/metadata_index/list`);
for (const [name, type] of Object.entries(manifest.metadataIndexes)) {
  if (!Array.isArray(indexes?.metadataIndexes) || !indexes.metadataIndexes.some(x => x.propertyName === name && x.indexType === type)) throw new Error(`Required metadata index missing: ${name}`);
}
const checkpoint = resolve(directory, `${index}.checkpoint.json`);
let completed = 0;
try {
  const previous = JSON.parse(await readFile(checkpoint, 'utf8'));
  if (previous.account !== account || previous.index !== index || previous.sha256 !== manifest.sha256 || !Number.isInteger(previous.completed) || previous.completed < 0 || previous.completed > records.length) throw new Error('Checkpoint does not match account/index/input');
  completed = previous.completed;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (let start = completed; start < records.length; start += 32) {
  const batch = records.slice(start, start + 32);
  const result = await api(`/ai/run/${EMBED_MODEL}`, { text: batch.map(r => r.text) });
  if (!Array.isArray(result?.data) || result.data.length !== batch.length || result.data.some(v => !Array.isArray(v) || v.length !== 1024 || v.some(n => !Number.isFinite(n)))) throw new Error('Embedding output invalid');
  const lines = batch.map((r, i) => JSON.stringify({ id: r.id, values: result.data[i], metadata: r.metadata })).join('\n');
  const inserted = await api(`${target}/upsert?unparsable-behavior=error`, lines + '\n', true);
  if (!inserted?.mutationId) throw new Error('Index write was not acknowledged');
  await writeFile(checkpoint + '.tmp', JSON.stringify({ account, index, sha256: manifest.sha256, completed: start + batch.length, lastMutationId: inserted.mutationId }));
  await rename(checkpoint + '.tmp', checkpoint);
}
console.log(JSON.stringify({ submitted: records.length, activation: 'not-performed', next: 'Verify index visibility, coverage, filtering and relevance before binding or enabling it.' }));
