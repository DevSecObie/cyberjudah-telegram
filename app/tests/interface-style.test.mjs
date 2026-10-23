import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Only Bible Strong's More section strips transform their authored labels to uppercase.
test('interface styles preserve capitalization except More section strips', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const failures = [];
  for (const relative of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, relative);
    if (!/\.(?:css|[jt]sx?)$/.test(file) || !fs.statSync(file).isFile()) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach(line => {
      if (/text-transform\s*:\s*uppercase|textTransform\s*:\s*['"]uppercase/i.test(line)) failures.push(`${relative}: ${line.split('{')[0].trim()}`);
    });
  }
  assert.deepEqual(failures, ['styles/content.css: .mcard__head'], 'Only More section strips use uppercase transforms');
});
