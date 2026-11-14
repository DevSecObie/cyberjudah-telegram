import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';

// Owner decision 2026-11-10 ("use the best for all"): speech is heard by Deepgram Nova-3 and read by
// Deepgram Aura-2, both on Workers AI. Nova-3 takes the audio with its type and answers in Deepgram's
// shape; Aura-2 lacks four Aura-1 voices, so a reader's saved choice of one is read by the closest.
const out = new URL('./.build/app-voice-models.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/app-voice.ts"; export { VOICES, VOICE_ALIASES, voiceId, VOICE_MODEL } from "./src/ai.mjs";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { listen, listenUsd, speak, speechPieces, AURA_MAX_CHARS, LISTEN_MODEL, VOICES, VOICE_ALIASES, voiceId, VOICE_MODEL } = await import(out);

const audioStore = () => { const kept = new Map(); return { kept, async get(k) { return kept.has(k) ? { body: kept.get(k) } : null; }, async put(k, v) { kept.set(k, v); } }; };

test('speech is heard by Nova-3: the audio goes with its type and the transcript is read from Deepgram results', async t => {
  const { env } = financialDb(t), calls = [];
  env.AI = { run: async (id, input) => { calls.push({ id, input }); return { results: { channels: [{ alternatives: [{ transcript: '  Placeholder spoken words  ' }] }] } }; } };
  const r = await listen(env, 'acct-a', new Uint8Array([1, 2, 3]).buffer, 'audio/webm');
  assert.deepEqual(r, { ok: true, text: 'Placeholder spoken words' });
  assert.equal(calls[0].id, '@cf/deepgram/nova-3');
  assert.equal(LISTEN_MODEL, '@cf/deepgram/nova-3');
  assert.equal(calls[0].input.audio.contentType, 'audio/webm');
  assert.deepEqual([...new Uint8Array(await new Response(calls[0].input.audio.body).arrayBuffer())], [1, 2, 3], 'the audio is sent as a stream of the same bytes');
  // No type given: Deepgram is left to detect the container.
  await listen(env, 'acct-a', new Uint8Array([4]).buffer);
  assert.equal(calls[1].input.audio.contentType, 'application/octet-stream');
  // Nothing heard is "not-heard", not an empty question.
  env.AI = { run: async () => ({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } }) };
  assert.deepEqual(await listen(env, 'acct-a', new Uint8Array([5]).buffer, 'audio/mp4'), { ok: false, status: 422, error: 'not-heard' });
});

test('answers are read by Aura-2; a retired Aura-1 voice is read by the closest Aura-2 voice; kept audio is keyed by model', async t => {
  const { env } = financialDb(t), calls = [];
  env.AUDIO = audioStore();
  env.AI = { run: async (id, input) => { calls.push({ id, input }); return new Uint8Array([9, 9]); } };
  assert.equal(VOICE_MODEL, '@cf/deepgram/aura-2-en');
  for (const [old, now] of Object.entries(VOICE_ALIASES)) {
    assert.equal(voiceId(old), now);
    assert.ok(VOICES.some(v => v.id === now), `${now} is offered`);
    assert.ok(!VOICES.some(v => v.id === old), `${old} is no longer offered`);
  }
  assert.equal(voiceId('asteria'), 'asteria');
  for (const name of ['nobody', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(voiceId(name), undefined, name);
  const res = await speak(env, 'acct-a', 'Placeholder answer words to read aloud.', 'stella');
  assert.equal(res.status, 200);
  assert.equal(calls[0].id, '@cf/deepgram/aura-2-en');
  assert.equal(calls[0].input.speaker, 'thalia');
  const keys = [...env.AUDIO.kept.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^tts\/answers\/aura-2-en\/thalia\/[0-9a-f]{64}\.mp3$/);
  // The same words in the old voice name are served from the kept audio, with no second model call.
  assert.equal((await speak(env, 'acct-a', 'Placeholder answer words to read aloud.', 'thalia')).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await speak(env, 'acct-a', 'Placeholder answer words to read aloud.', 'nobody')).status, 400);
});

test('an answer longer than Aura-2 reads at once is read in parts, cut after sentences, and joined as one MP3', async t => {
  const sentence = 'Placeholder fixture sentence for reading aloud. ';
  const pieces = speechPieces(sentence.repeat(60));
  assert.ok(pieces.length >= 2 && pieces.every(p => p.length <= AURA_MAX_CHARS && p.endsWith('.')), pieces.map(p => p.length).join());
  assert.equal(pieces.join(' '), sentence.repeat(60).trim());
  assert.deepEqual(speechPieces('x'.repeat(4100)).map(p => p.length), [2000, 2000, 100], 'text with no break is cut at the limit');
  const { env } = financialDb(t), calls = [];
  env.AUDIO = audioStore();
  env.AI = { run: async (id, input) => { calls.push(input.text.length); return new Uint8Array([calls.length]); } };
  env.ASK_FREE_DAILY_USD_CAP = '1'; // room for one long answer's reservation
  const res = await speak(env, 'acct-a', sentence.repeat(60), 'asteria');
  assert.equal(res.status, 200);
  assert.ok(calls.length >= 2 && calls.every(n => n <= AURA_MAX_CHARS));
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], calls.map((_, i) => i + 1), 'the parts are joined in order');
});

test('a recording is reserved by its length, estimated from its size, so a long low-bitrate one is covered', () => {
  assert.equal(listenUsd(10), 0.0065);
  assert.ok(listenUsd(2_000_000) >= 17 * 0.0052, 'the largest accepted recording reserves at least 17 minutes');
  assert.ok(listenUsd(2_000_000) <= 0.15, 'and stays within one free answer');
});
