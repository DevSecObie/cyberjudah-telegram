import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAIStream } from '../src/ai-stream.mjs';
const stream = (parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
test('streamed answers preserve split SSE frames and report final usage', async () => {
  const pieces = [];
  const result = await readAIStream(stream(['data: {"res', 'ponse":"Judah "}\r\n\r\ndata: {"response":"[1]"}\n\n', 'data: {"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n']), p => pieces.push(p));
  assert.deepEqual(pieces, ['Judah ', '[1]']);
  assert.equal(result.response, 'Judah [1]');
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 4 });
});
test('chat-completions deltas and non-newline EOF are accepted', async () => {
  const result = await readAIStream(stream(['data: {"choices":[{"delta":{"content":"An answer"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}']), () => {});
  assert.equal(result.response, 'An answer');
});
test('a broken or error stream is not presented as a complete answer', async () => {
  await assert.rejects(readAIStream(stream(['data: {"response":"Partial"}\n\n']), () => {}), /INCOMPLETE/);
  await assert.rejects(readAIStream(stream(['data: {"error":"busy"}\n\n']), () => {}), /FAILED/);
});
