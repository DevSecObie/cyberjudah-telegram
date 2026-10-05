import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteJson } from '../../../shared/cms-json.ts';

test('JSON edits preserve untouched escapes, spacing, object order and nested values', () => {
  const source = '{ "b" : [1, {"quote":"escaped \\u0061", "say":"a \\\"quote\\\""}], "a":true }\n';
  const value = JSON.parse(source); value.b[1].say = 'corrected';
  assert.equal(rewriteJson(source, value), source.replace('"a \\\"quote\\\""', '"corrected"'));
  assert.equal(rewriteJson(source, { a: true, b: JSON.parse(source).b }), source);
});
test('JSON insertion, deletion and moves preserve existing records without sorting them', () => {
  for (const source of ['[]\n', '[\n]\n', '[{"id":"b","n":1},{"id":"a","n":2}]\n', '[\n  {"id":"b","n":1},\n  {"id":"a","n":2}\n]\n']) {
    const original = JSON.parse(source), added = [{ id: 'new', x: { y: [true, null, 'x'] } }, ...original];
    assert.deepEqual(JSON.parse(rewriteJson(source, added)), added);
    assert.deepEqual(JSON.parse(rewriteJson(source, [])), []);
    assert.deepEqual(JSON.parse(rewriteJson(source, [...original].reverse())), [...original].reverse());
  }
  const source = '{\n  "z": "keep",\n  "n": {"old": 1}\n}\n';
  assert.equal(rewriteJson(source, { z: 'keep', n: { added: 2 } }), '{\n  "z": "keep",\n  "n": {"added":2}\n}\n');
  assert.deepEqual(JSON.parse(rewriteJson(source, { z: 'keep', added: [1] })), { z: 'keep', added: [1] });
});
