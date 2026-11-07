import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationReport } from '../src/citations.mjs';

test('citation membership is unique, ordered, grouped and bound to the actual registry', () => {
  assert.deepEqual(citationReport('Source [2, 1, 2], then [1] and [100].', [1, 2, 100]), { supported: [2, 1, 100], unsupported_refs: [] });
  assert.deepEqual(citationReport('Source [2, 100].', 2), { supported: [2], unsupported_refs: ['[2, 100]'] });
  assert.deepEqual(citationReport('No citations at all.', 4), { supported: [], unsupported_refs: [] });
});

test('invalid numeric references are exposed exactly and never attached to arbitrary sources', () => {
  assert.deepEqual(citationReport('Bad [0] [-1] [1.5] [01] [999] [999] [9007199254740993].', 3), {
    supported: [], unsupported_refs: ['[0]', '[-1]', '[1.5]', '[01]', '[999]', '[9007199254740993]'],
  });
});
