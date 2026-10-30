import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import { IdentityError } from "./account-links";
import { appReader } from "./app-identity";
import { answerApp, appAskModels, freeModel, takeQuotaKey } from "./ai";
import { normalizeHistory } from "./ai.mjs";
import { keyedHash } from "./privacy.mjs";
import { listen, speak } from "./app-voice";
import { dropReported } from "./answer-cache";
import { recordAskEvent } from "./ask-events";

type AppAsk = { Bindings: Env; Variables: { account: string; traceId: string } };
const tracePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const appAsk = new Hono<AppAsk>();
const textLimit = bodyLimit({ maxSize: 32000, onError: c => c.json({ error: "too-large" }, 413) });
const audioLimit = bodyLimit({ maxSize: 2_000_000, onError: c => c.json({ error: "too-large" }, 413) });
// A spoken question may be up to about a minute of audio; everything else is small JSON.
appAsk.use("*", (c, next) => (c.req.path.endsWith("/listen") ? audioLimit : textLimit)(c, next));
// These endpoints never resolve a Telegram wallet. Identity is always a verified Firebase UID.
appAsk.use('*', async (c, next) => {
  c.header('cache-control', 'no-store');
  const suppliedTrace = c.req.header('x-trace-id') ?? '';
  const traceId = tracePattern.test(suppliedTrace) ? suppliedTrace.toLowerCase() : crypto.randomUUID();
  c.set('traceId', traceId);
  c.header('X-Trace-ID', traceId);
  c.header('Access-Control-Expose-Headers', 'X-Trace-ID');
  try {
    const identity = await appReader(c.req.raw, c.env);
    if (!identity) return c.json({ error: 'sign_in_required' }, 401);
    c.set('account', await keyedHash(c.env, 'app-ask', identity.uid));
  } catch (error) { return c.json({ error: error instanceof IdentityError ? error.reason : 'sign_in_unavailable' }, error instanceof IdentityError ? error.status : 503); }
  return next();
});
appAsk.get('/models', c => c.json({
  default: freeModel(c.env).id, maxQuestionLength: 4000,
  models: appAskModels(c.env).map(({ id, name, provider, what }) => ({ id, name, provider, what })),
  billing: { purchasesEnabled: false },
}));
appAsk.post('/report', async c => {
  if (Number(c.req.header('content-length') ?? 0) > 1024) return c.json({ error: 'too-large' }, 413);
  const raw = await c.req.text();
  if (raw.length > 1024) return c.json({ error: 'too-large' }, 413);
  let body: { reason?: unknown; model?: unknown; traceId?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: 'bad-request' }, 400); }
  if (!body || !['wrong', 'harmful'].includes(String(body.reason))) return c.json({ error: 'bad-request' }, 400);
  const day = new Date().toISOString().slice(0, 10);
  if (!await takeQuotaKey(c.env, `app_report:${c.get('account')}:${day}`, 10)) return c.json({ error: 'limit' }, 429);
  // Aggregate reports with no account, prompt or answer content. Reviewers can prioritize the
  // model/reason; a future opt-in diagnostic flow may ask the reader to share more.
  const model = appAskModels(c.env).find(m => m.id === body.model)?.id ?? 'default';
  // A reported answer that came from the answer cache is removed from it (answer-cache.ts).
  const traced = typeof body.traceId === 'string' && tracePattern.test(body.traceId);
  if (traced) await dropReported(c.env, body.traceId as string);
  await c.env.SUBS.put(`app_ask_report:${day}:${crypto.randomUUID()}`, JSON.stringify({ reason: body.reason, model, at: Date.now(), ...(traced ? { traceId: (body.traceId as string).toLowerCase() } : {}) }), { expirationTtl: 90 * 86400 });
  return c.json({ ok: true });
});
// Voice (app-voice.ts): a spoken question as text, and an answer read aloud. The reader's agreement
// to the free models' provider covers both, as it does Ask.
appAsk.post('/listen', async c => {
  if (c.env.ASK_APP_ENABLED === 'off') return c.json({ error: 'unavailable' }, 503);
  const agreed = (c.req.header('x-ai-consent') ?? '').split(',').map(s => s.trim());
  if (!agreed.includes('Cloudflare (Workers AI)')) return c.json({ error: 'consent', provider: 'Cloudflare (Workers AI)' }, 428);
  const r = await listen(c.env, c.get('account'), await c.req.arrayBuffer());
  return r.ok ? c.json({ text: r.text }) : c.json({ error: r.error }, r.status as 400);
});
appAsk.post('/speak', async c => {
  if (c.env.ASK_APP_ENABLED === 'off') return c.json({ error: 'unavailable' }, 503);
  let body: { text?: unknown; voice?: unknown; consent?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad-request' }, 400); }
  const consent = Array.isArray(body?.consent) ? body.consent : [];
  if (!consent.includes('Cloudflare (Workers AI)')) return c.json({ error: 'consent', provider: 'Cloudflare (Workers AI)' }, 428);
  return speak(c.env, c.get('account'), typeof body.text === 'string' ? body.text : '', typeof body.voice === 'string' ? body.voice : 'orpheus');
});
appAsk.post('/', async c => {
  if (c.env.ASK_APP_ENABLED === 'off') return c.json({ error: 'unavailable' }, 503);
  if (Number(c.req.header('content-length') ?? 0) > 32000) return c.json({ error: 'too-large' }, 413);
  const raw = await c.req.text();
  if (raw.length > 32000) return c.json({ error: 'too-large' }, 413);
  let body: { q?: unknown; history?: unknown; consent?: unknown; stream?: unknown; model?: unknown; ui?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: 'bad-request' }, 400); }
  if (!body || typeof body !== 'object' || typeof body.q !== 'string') return c.json({ error: 'bad-request' }, 400);
  if (body.q.trim().length < 2 || body.q.length > 4000) return c.json({ error: body.q.length > 4000 ? 'too-long' : 'too-short' }, 400);
  const model = appAskModels(c.env).find(m => m.id === (body.model || freeModel(c.env).id));
  if (!model) return c.json({ error: 'model-unavailable' }, 400);
  const consent = Array.isArray(body.consent) ? body.consent.filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
  if (!consent.includes(model.provider)) return c.json({ error: 'consent', provider: model.provider }, 428);
  const ip = c.req.header('cf-connecting-ip')?.slice(0, 45);
  if (ip && !await takeQuotaKey(c.env, `ask_ip:${ip}:${new Date().toISOString().slice(0, 10)}`, Math.max(100, Number(c.env.ASK_IP_DAILY_LIMIT ?? 1000)))) return c.json({ error: 'limit' }, 429);
  const history = normalizeHistory(body.history as never, 8);
  const run = async (emit?: NonNullable<Parameters<typeof answerApp>[6]>['emit']) => {
    const startedAt = Date.now();
    const traceId = c.get('traceId');
    try {
      const result = await answerApp(c.env, body.q as string, c.get('account'), history, consent, 55000, { model: model.id, emit, study: body.ui === 'study-v1', traceId });
      console.log(JSON.stringify({ event: 'app_ask_request', traceId, outcome: result.ok ? 'complete' : result.reason, model: model.id, elapsedMs: Date.now()-startedAt }));
      // A study answer records its own outcome (app-study-answer.ts); everything else, and every refusal, here.
      if (body.ui !== 'study-v1' || !result.ok) await recordAskEvent(c.env, { traceId, surface: body.ui === 'study-v1' ? 'study' : 'app', model: result.ok ? result.model : model.id, outcome: result.ok ? 'complete' : result.reason, elapsedMs: Date.now() - startedAt, sources: result.ok ? result.sources.length : undefined });
      return result;
    } catch (error) {
      console.log(JSON.stringify({ event: 'app_ask_request', traceId, outcome: 'failed', model: model.id, elapsedMs: Date.now()-startedAt }));
      await recordAskEvent(c.env, { traceId, surface: body.ui === 'study-v1' ? 'study' : 'app', model: model.id, outcome: 'failed', detail: String((error as Error)?.message ?? '').slice(0, 200), elapsedMs: Date.now() - startedAt });
      throw error;
    }
  };
  if (!body.stream) {
    const res = await run();
    return res.ok ? c.json({ ...res, sources: res.sources.map(({ text, ...source }) => ({ ...source, ...(res.ui ? { excerpt: text.slice(0, 1000) } : {}) })) }) : c.json({ error: res.reason }, res.reason === 'limit' || res.reason === 'free-paused' ? 429 : 503);
  }
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => { if (open) { try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); } catch { open = false; } } };
      const beat = setInterval(() => send({ ping: 1 }), 15000);
      const job = (async () => {
        try {
          const result = await run(send);
          if (result.ok) {
            // Never transmit retrieved passage text in the sources payload.
            const sources = result.sources.map(({ text, ...source }) => ({ ...source, ...(result.ui ? { excerpt: text.slice(0, 1000) } : {}) }));
            send({ done: true, answer: result.answer, sources, followups: result.followups ?? [], model: result.model, ...(result.ui ? { ui: result.ui, teachingFound: result.teachingFound } : {}) });
          } else send({ error: result.reason });
        } catch { send({ error: 'unavailable' }); }
        finally { clearInterval(beat); if (open) { open = false; controller.close(); } }
      })();
      // Finish accounting even when the user stops receiving the stream.
      c.executionCtx.waitUntil(job);
      await job;
    },
    cancel() { open = false; },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
});
