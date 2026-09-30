import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('Effect schema oracle differs from the pinned upstream source only in local imports', async () => {
  const root = new URL('../upstream/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  for (const { file, sourceSha256 } of source.files) {
    let text = await readFile(new URL(file, root), 'utf8');
    text = text.replaceAll("'../resourcePageCursor.ts'", "'../resourcePageCursor'");
    text = text.replace(/'\.\/(commentaryReadingContract|supplementaryContract)\.ts'/g, "'@bible-strong/resource-domain/contracts/$1'");
    assert.equal(createHash('sha256').update(text).digest('hex'), sourceSha256, file);
  }
});
