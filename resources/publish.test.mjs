import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle, writeBundle } from './bundle.mjs';
import { publishArtifact } from './publish.mjs';

async function fixture() {
  const output = await mkdtemp(path.join(tmpdir(), 'resource-publication-'));
  const bundle = await buildBundle({ id: 'josephus', kind: 'reference', title: 'SYNTHETIC TEST ONLY', language: 'en', source: [{ url: 'https://example.invalid/fixture', revision: 'test', sha256: 'a'.repeat(64) }], license: [{ id: 'public-domain', url: 'https://example.invalid/fixture', attribution: 'Synthetic test', modifications: '' }], approval: { reference: 'https://example.invalid/fixture', approvedBy: 'TEST ONLY' } }, [{ key: 'test', data: { text: 'Synthetic.' } }]);
  const objects = await writeBundle(output, bundle);
  await writeFile(path.join(output, 'inventory.json'), JSON.stringify({ objects }));
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify({ schemaVersion: 1, revision: 1, resources: [bundle.entry] }));
  return { output, objects };
}
test('dry verification performs no requests or uploads; tampering is rejected before writes', async () => {
  const { output, objects } = await fixture();
  const unexpected = () => { throw new Error('unexpected remote action'); };
  const result = await publishArtifact({ output, request: unexpected, upload: unexpected });
  assert.equal(result.remoteWrites, 0);
  await writeFile(path.join(output, objects[0].file), 'tampered\n');
  await assert.rejects(publishArtifact({ output, execute: true, request: unexpected, upload: unexpected }), /checksum/);
});
test('upload failure never publishes; success uses current ETag, merges catalog and uploads manifests last', async () => {
  const { output, objects } = await fixture();
  const current = { schemaVersion: 1, revision: 6, resources: [{ id: 'other', release: 'v1', manifestSha256: 'b'.repeat(64) }] };
  const calls = [], uploaded = [];
  const request = async (url, options) => { calls.push({ url, options }); return options.method === 'PUT' ? Response.json(JSON.parse(options.body)) : Response.json(current, { headers: { etag: '"current"' } }); };
  const args = { output, execute: true, bucket: 'test-only-bucket', api: 'https://example.invalid', initData: 'SYNTHETIC', request };
  await assert.rejects(publishArtifact({ ...args, upload: async () => { throw new Error('upload failed'); } }), /upload failed/);
  assert.equal(calls.length, 1); calls.length = 0;
  const result = await publishArtifact({ ...args, upload: async (_bucket, key) => { uploaded.push(key); } });
  assert.equal(result.published.revision, 7); assert.equal(result.published.resources.length, 2);
  assert.equal(result.remoteWrites, objects.length + 1);
  assert.ok(uploaded.at(-1).endsWith('manifest.json'));
  assert.equal(calls[1].options.headers['if-match'], '"current"');
  assert.equal(calls[1].url, 'https://example.invalid/api/resources/catalog');
});
test('catalog conflict is reported without a direct pointer write or blind retry', async () => {
  const { output } = await fixture(); let requests = 0;
  await assert.rejects(publishArtifact({ output, execute: true, bucket: 'test-only-bucket', api: 'https://example.invalid', initData: 'SYNTHETIC', upload: async () => {}, request: async (_url, opts) => { requests++; return opts.method === 'PUT' ? new Response(null, { status: 409 }) : Response.json({ schemaVersion: 1, revision: 0, resources: [] }); } }), /409.*prior catalog remains/);
  assert.equal(requests, 2);
});
