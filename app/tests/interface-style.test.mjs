import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Source policy: typography must preserve authored capitalization. Acronyms such as KJV
// remain in their original text; no CSS/inline-style exception is needed for them.
test('interface styles never force labels into all caps', () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const failures = [];
  for (const relative of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, relative);
    if (!/\.(?:css|[jt]sx?)$/.test(file) || !fs.statSync(file).isFile()) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/text-transform\s*:\s*uppercase|textTransform\s*:\s*['"]uppercase/i.test(line)) failures.push(`${relative}:${i + 1}`);
    });
  }
  assert.deepEqual(failures, [], 'Use authored title-style labels instead of uppercase transforms');
});
