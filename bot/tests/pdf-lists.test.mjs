import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { notePdf } from '../src/pdf.mjs';

/** The words a PDF draws, in drawing order: every page's content stream inflated, each hex "Tj" string decoded. */
function drawnText(bytes) {
  const buf = Buffer.from(bytes); const s = buf.toString('latin1'); const words = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const len = /\/Length (\d+)/.exec(m[1]); if (!len) continue;
    const start = m.index + m[0].length; re.lastIndex = start + Number(len[1]);
    if (/\/Type \/(ObjStm|XRef)|\/Length1/.test(m[1])) continue;
    let body; try { body = inflateSync(buf.subarray(start, start + Number(len[1]))).toString('latin1'); } catch { continue; }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) words.push(Buffer.from(t[1], 'hex').toString('latin1'));
  }
  return words.join(' ').replace(/\s+/g, ' ');
}

test('PDF lists: tight, loose, nested and ordered items keep their words, in order, each drawn once', async () => {
  // A nested list the way the class notes write them: a verse in bold, its words loose beneath, tight and ordered lists after.
  const body = [
    '## Scriptures opened',
    '',
    '- **[Genesis 12:1](/bible/genesis/12#v1)** the call',
    '  - Get thee out of thy country',
    '  - Unto a land that I will shew thee',
    '',
    '- **[Isaiah 51:2](/bible/isaiah/51#v2)** the same',
    '',
    '  Look unto Abraham your father, and unto Sarah that bare you.',
    '',
    '  For I called him alone, and blessed him, and increased him.',
    '',
    '1. First ordered',
    '2. Second ordered',
    '3. Third ordered',
    '',
    '- plain one',
    '- plain two',
    '',
    'After the lists.',
  ].join('\n');
  const bytes = await notePdf({ title: 'List regression', teacher: 'Deacon Yashua', kind: 'class', date: '2026-10-06', url: '/classes/list-regression', body });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const text = drawnText(bytes);
  // Every item's words are drawn, the loose paragraphs included, and nothing is drawn twice.
  for (const words of ['Genesis 12:1', 'the call', 'Get thee out of thy country', 'Unto a land that I will shew thee', 'Isaiah 51:2', 'the same', 'Look unto Abraham your father', 'For I called him alone', 'First ordered', 'Second ordered', 'Third ordered', 'plain one', 'plain two', 'After the lists.']) {
    assert.equal(text.split(words).length - 1, 1, `"${words}" is drawn exactly once in: ${text}`);
  }
  // Reading order survives: nested items follow their parent, loose paragraphs follow theirs, the ordered list follows the bullets.
  const order = ['Genesis 12:1', 'Get thee out', 'Unto a land', 'Isaiah 51:2', 'Look unto Abraham', 'For I called him alone', 'First ordered', 'Second ordered', 'Third ordered', 'plain one', 'plain two', 'After the lists.'].map((w) => text.indexOf(w));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // The marks: a number for each ordered item and a bullet for each of the six others.
  assert.deepEqual(['1.', '2.', '3.'].map((n) => text.split(` ${n} `).length - 1), [1, 1, 1]);
  assert.equal((text.match(//g) ?? []).length, 6, 'six bullets (WinAnsi 0x95)');
});
