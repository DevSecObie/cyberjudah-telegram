import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Hono } from 'hono';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const out = new URL('./.build/study-reference.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { bs } from "./src/bs"; export { searchJewishEncyclopedia } from "./src/bs/jewish-encyclopedia";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: out, logLevel: 'error' });
const { bs, searchJewishEncyclopedia } = await import(out);
const dir = mkdtempSync(join(tmpdir(), 'cj-reference-test-'));
const source = new DatabaseSync(join(dir, 'source.sqlite'));
source.exec('CREATE TABLE dictionnaire(id INTEGER PRIMARY KEY,word TEXT,sanitized_word TEXT,definition TEXT)');
const long = '<p>Abraham’s historical reference. ' + 'Original article text. '.repeat(17000) + '</p>';
source.prepare('INSERT INTO dictionnaire VALUES(?,?,?,?)').run(17, 'Abraham', 'abraham', long);
source.prepare('INSERT INTO dictionnaire VALUES(?,?,?,?)').run(23, 'Abraham ben David', 'abraham ben david', '<p>Another Abraham. This is a reference, not teacher authority.</p>');
source.close();
execFileSync('python3', ['-c', `import zipfile,pathlib,json,hashlib,sys
p=pathlib.Path(sys.argv[1]); data=(p/'source.sqlite').read_bytes()
with zipfile.ZipFile(p/'archive.zip','w') as z: z.writestr('dictionnaire.sqlite',data)
catalog={'resources':{'database:JEWISH_ENCYCLOPEDIA:en':{'contentSha256':hashlib.sha256(data).hexdigest(),'archiveSha256':hashlib.sha256((p/'archive.zip').read_bytes()).hexdigest()}}}
(p/'catalog.json').write_text(json.dumps(catalog))`, dir]);
const script = new URL('../scripts/build-study-reference.py', import.meta.url).pathname;
const report = JSON.parse(execFileSync('python3', [script, join(dir, 'archive.zip'), join(dir, 'catalog.json'), join(dir, 'index.sql')], { encoding: 'utf8' }));
const db = new DatabaseSync(':memory:');
const sql = readFileSync(join(dir, 'index.sql'), 'utf8');
db.exec(sql);
const prepared = (query, args = []) => ({ bind: (...values) => prepared(query, values), first: async () => db.prepare(query).get(...args) ?? null, all: async () => ({ results: db.prepare(query).all(...args) }) });
const env = { DB: { prepare: prepared }, BIBLE_STRONG_WEB: '1' };
const app = new Hono().route('/bs', bs);
const get = path => app.request('https://example.test/bs/v1/dictionaries/jewish-encyclopedia/en/' + path, undefined, env);
test.after(() => { db.close(); rmSync(dir, { recursive: true }); });

test('publication validates hashes and preserves long article text and offline IDs', async () => {
  assert.equal(report.entries, 2);
  assert.ok(sql.split('\n').every(line => Buffer.byteLength(line) < 100000));
  const res = await get('entries/by-id/17');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.resource.revision, report.revision);
  assert.equal(body.entry.definition, long);
  assert.equal(body.entry.id, 17);
  const catalog = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'));
  catalog.resources['database:JEWISH_ENCYCLOPEDIA:en'].archiveSha256 = 'tampered';
  writeFileSync(join(dir, 'tampered.json'), JSON.stringify(catalog));
  assert.throws(() => execFileSync('python3', [script, join(dir, 'archive.zip'), join(dir, 'tampered.json'), join(dir, 'rejected.sql')], { stdio: 'pipe' }), /Command failed/);
});
test('import is repeatable without duplicated search results; exact titles rank first', async () => {
  db.exec(sql);
  assert.equal(db.prepare('SELECT count(*) AS n FROM app_reference_search').get().n, 2);
  const results = await searchJewishEncyclopedia(env, 'Abraham');
  assert.equal(results[0].id, 17);
  assert.equal(results[1].id, 23);
});
test('online browsing pages retain stable IDs; malformed identities are rejected', async () => {
  const first = await (await get('entries?initial=a&limit=1')).json();
  assert.equal(first.entries[0].id, 17);
  const next = await (await get('entries?limit=1&cursor=' + encodeURIComponent(first.nextCursor))).json();
  assert.equal(next.entries[0].id, 23);
  assert.equal((await get('entries/by-id/999')).status, 404);
  assert.equal((await get('entries/by-id/1%20OR%201')).status, 400);
  assert.equal((await get('entries?cursor=broken')).status, 400);
  assert.equal((await get('entries?limit=99999')).status, 400);
});
