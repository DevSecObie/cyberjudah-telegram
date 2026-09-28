import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { prepare, stripTags, unescape } from '../src/pdf-text.mjs';
import { notePdf } from '../src/pdf.mjs';

test('PDF entities decode exactly once, including numeric references', () => {
  assert.equal(unescape('&amp;lt; &amp;gt; &amp;quot; &amp;#39;'), '&lt; &gt; &quot; &#39;');
  assert.equal(unescape('A &amp; B &#39; &#x41; &nbsp;'), "A & B ' A \u00a0");
  assert.equal(stripTags('<p>A &amp;lt; B &lt; C</p>'), 'A &lt; B < C');
});
test('PDF preparation removes parsed comments and nested web-only elements without changing markdown', () => {
  const input = '## Reading\n\n**Keep &amp;lt;**\n<!-- outer <!-- nested -->\n<div class="other class-video-mount"><div>player</div></div>\n<figure><figure>nested</figure>caption</figure>\n<section class="shown-all extra"><section>frames</section></section>\n<script>alert(1)</script>\nEnd';
  const result = prepare(input);
  assert.match(result, /## Reading/); assert.match(result, /\*\*Keep &amp;lt;\*\*/);
  assert.doesNotMatch(result, /<!--|player|nested|caption|frames|alert\(1\)/);
  assert.match(result, /End$/);
  assert.doesNotMatch(prepare('Before<!-- unclosed comment <script>bad'), /comment|script|bad/);
});
test('PDF text extraction excludes executable node contents and respects quoted angle brackets', () => {
  assert.equal(stripTags('<p title="a > b">Good <b>reading</b></p><script>bad()</script><style>body{}</style><!-- hidden -->'), 'Good reading');
  assert.equal(stripTags('&lt;script&gt;literal&lt;/script&gt;'), '<script>literal</script>');
});
test('a multi-page note with HTML, entity examples and scripture still exports as a PDF', async () => {
  const bytes = await notePdf({ title: 'Study, Pray, Apply!', teacher: 'Bishop Nathanyel', kind: 'class', date: '2026-09-28', url: '/classes/pdf-regression', body: '## Reading\n\n> Give attendance to reading.\n\n' + '**Read** &amp;lt; literally. <sup>1</sup> Study and apply.\n\n'.repeat(100) });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(), 'Study, Pray, Apply!');
  assert.ok(pdf.getPageCount() > 1);
  assert.equal(pdf.getAuthor(), 'Bishop Nathanyel');
});
