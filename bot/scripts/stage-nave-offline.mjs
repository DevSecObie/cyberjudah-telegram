import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// The website and the native publication have independent release pins.
const [source, destination, origin] = process.argv.slice(2);
const readCatalog = async dir => JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8'));
const published = await readCatalog(source);
const staged = await readCatalog(destination);
assert.equal(published.schemaVersion, staged.schemaVersion);
assert.equal(published.format, staged.format);

for (const [language, file] of [['en', 'databases/en/nave.sqlite.zip'], ['fr', 'databases/nave-fr.sqlite.zip']]) {
  const id = `database:NAVE:${language}`;
  const entry = published.resources[id];
  assert.equal(entry.id, id);
  assert.equal(entry.file, file);
  const bytes = await readFile(join(source, file));
  assert.equal(bytes.length, entry.archiveBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.archiveSha256);
  await mkdir(dirname(join(destination, file)), { recursive: true });
  await writeFile(join(destination, file), bytes);
  let url = entry.url;
  if (origin) {
    const releaseUrl = new URL('/offline/' + file, origin);
    releaseUrl.search = new URL(entry.url).search;
    url = releaseUrl.href;
  }
  staged.resources[id] = { ...entry, url };
}
staged.resourceCount = Object.keys(staged.resources).length;
staged.generatedAt = new Date(Math.max(Date.parse(staged.generatedAt), Date.parse(published.generatedAt))).toISOString();
await writeFile(join(destination, 'catalog.json'), JSON.stringify(staged) + '\n');
