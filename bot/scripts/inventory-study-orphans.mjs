import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Administrative read-only runner. Supply an existing credential through the environment or an
// existing file; never print it or persist a copy. Reports contain paths, so write them privately.
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length;) {
  if (args[i] === '--gcloud' && !options.has('--gcloud')) { options.set('--gcloud', true); i++; continue; }
  if (!['--output', '--credential-file', '--emulator'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('Invalid inventory arguments');
  options.set(args[i], args[i + 1]);
  i += 2;
}
if (!options.has('--output')) throw new Error('--output is required; the report is never printed');
const host = options.get('--emulator');
const gcloud = options.has('--gcloud');
if (gcloud && (host || options.has('--credential-file'))) throw new Error('Choose one existing identity source');
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Only loopback emulators are permitted');
const credential = host || gcloud ? undefined : options.has('--credential-file') ? await readFile(options.get('--credential-file'), 'utf8') : process.env.FIREBASE_SERVICE_ACCOUNT;
if (!host && !credential && !gcloud) throw new Error('An existing authorized Firestore credential is required');
const folder = await mkdtemp(join(tmpdir(), 'study-orphan-inventory-'));
const originalFetch = globalThis.fetch;
try {
  const modulePath = join(folder, 'inventory.mjs');
  await build({ entryPoints: [new URL('../src/firestore-admin.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'error' });
  const project = host ? 'demo-cyberjudah' : 'cyberjudah-app';
  const origin = host ? `http://${host}` : 'https://firestore.googleapis.com';
  // Defense in depth: the runner cannot issue a Firestore write even if the imported module changes.
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const oauth = !host && url.href === 'https://oauth2.googleapis.com/token' && method === 'POST';
    const list = url.origin === origin && method === 'GET' &&
      ['studies', 'staging_studies'].some(collection => url.pathname === `/v1/projects/${project}/databases/(default)/documents/${collection}`) &&
      url.searchParams.get('showMissing') === 'true' && url.searchParams.get('mask.fieldPaths') === 'user.id' &&
      [...url.searchParams.keys()].every(key => ['pageSize', 'pageToken', 'showMissing', 'mask.fieldPaths'].includes(key));
    if (!oauth && !list) throw new Error('Inventory attempted an unapproved request');
    return originalFetch(input, { ...init, redirect: 'error' });
  };
  const { inventoryOrphanedStudyParents } = await import(pathToFileURL(modulePath).href);
  const inventoryToken = gcloud ? async () => {
    // Capture the existing session's short-lived token in memory. Never echo it or log stderr.
    const { stdout } = await promisify(execFile)('gcloud', ['auth', 'print-access-token', '--quiet'], { timeout: 30_000, maxBuffer: 64 * 1024 });
    const token = stdout.trim();
    if (!token || /\s/.test(token)) throw new Error('No existing authorized Google session');
    return token;
  } : undefined;
  const inventory = await inventoryOrphanedStudyParents({ FIREBASE_SERVICE_ACCOUNT: credential, FIRESTORE_EMULATOR_HOST: host }, inventoryToken);
  await writeFile(resolve(options.get('--output')), JSON.stringify({ project, generatedAt: new Date().toISOString(), ...inventory }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write('Read-only inventory written privately. Ownership remains unresolved.\n');
} catch {
  process.stderr.write('Inventory did not complete. No Firestore writes were permitted; no credential values were logged.\n');
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  await rm(folder, { recursive: true, force: true });
}
