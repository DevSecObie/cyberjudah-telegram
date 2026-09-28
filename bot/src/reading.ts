import { Hono } from 'hono';
import { Api, GrammyError, InlineKeyboard } from 'grammy';
import type { Env } from './env';
import type { InitData } from './initdata.mjs';
import { books, escapeHtml } from './data';
import { isAdmin } from './edit';
import { localClock, readingSummary, shiftDay, validReadingSettings, type ReadingLog, type ReadingSettings } from '../../shared/reading.mjs';

type SettingsRow = { user_id: number; timezone: string; time: string; enabled: number; weekly: number };
const defaults: ReadingSettings = { timezone: 'UTC', time: '08:00', enabled: false, weekly: false };
type Quote = { text: string; source?: string };
async function encouragement(env: Env, day: string): Promise<Quote | undefined> {
  const quotes = await env.SUBS.get<Quote[]>('reading:quotes', 'json') ?? [];
  // Exact wording and attribution supplied by the project owner; no recording link invented.
  return quotes.length ? quotes[Math.floor(Date.parse(day) / 86400000) % quotes.length] : { text: 'Study, Pray, Apply!' };
}
export async function readingCatalog(env: Env) {
  const list = await books(env);
  if (!list?.length) throw new Error('Reading library unavailable');
  return list.flatMap(b => (b.chapterIds ?? Array.from({ length: b.chapters }, (_, i) => i + 1)).map(chapter => ({ slug: b.slug, book: b.book, chapter })));
}
async function settings(env: Env, id: number): Promise<ReadingSettings> {
  const row = await env.DB.prepare('SELECT * FROM reading_settings WHERE user_id=?').bind(id).first<SettingsRow>();
  return row ? { timezone: row.timezone, time: row.time, enabled: !!row.enabled, weekly: !!row.weekly } : defaults;
}
async function logs(env: Env, id: number) {
  return (await env.DB.prepare('SELECT slug, chapter, day FROM reading_log WHERE user_id=? ORDER BY day, slug, chapter').bind(id).all<ReadingLog>()).results;
}
async function state(env: Env, id: number) {
  const prefs = await settings(env, id);
  const [catalog, history] = await Promise.all([readingCatalog(env), logs(env, id)]);
  const day = localClock(new Date(), prefs.timezone).day;
  return { settings: prefs, ...readingSummary(catalog, history, day), quote: await encouragement(env, day), admin: isAdmin(env, id) };
}
export const reading = new Hono<{ Bindings: Env; Variables: { tma: InitData } }>();
reading.get('/', async c => c.json(await state(c.env, c.get('tma').user!.id)));
reading.post('/quote', async c => {
  if (!isAdmin(c.env, c.get('tma').user!.id)) return c.json({ error: 'Admin only' }, 403);
  const body = await c.req.json().catch(() => null);
  if (!body || body.verified !== true || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 500 || typeof body.source !== 'string' || body.source.length > 500) return c.json({ error: 'Invalid quote' }, 400);
  try { const url = new URL(body.source); if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'youtu.be', 'cyberjudah.io', 'cyberjudah-telegram.oisrae1.workers.dev'].includes(url.hostname)) throw new Error(); } catch { return c.json({ error: 'Use a source recording link' }, 400); }
  const quotes = await c.env.SUBS.get<Quote[]>('reading:quotes', 'json') ?? [];
  if (!quotes.some(q => q.text === body.text.trim())) quotes.push({ text: body.text.trim(), source: body.source });
  await c.env.SUBS.put('reading:quotes', JSON.stringify(quotes.slice(-60)));
  return c.json({ ok: true });
});
reading.put('/settings', async c => {
  const body = await c.req.json().catch(() => null);
  if (!validReadingSettings(body)) return c.json({ error: 'Choose a valid timezone and a time in 15-minute steps.' }, 400);
  await c.env.DB.prepare('INSERT INTO reading_settings(user_id,timezone,time,enabled,weekly) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone,time=excluded.time,enabled=excluded.enabled,weekly=excluded.weekly')
    .bind(c.get('tma').user!.id, body.timezone, body.time, Number(body.enabled), Number(body.weekly)).run();
  return c.json(await state(c.env, c.get('tma').user!.id));
});
reading.post('/chapter', async c => {
  const body = await c.req.json<{ slug?: string; chapter?: number; read?: boolean }>().catch(() => null);
  const catalog = await readingCatalog(c.env);
  if (!body || typeof body.read !== 'boolean' || !catalog.some(b => b.slug === body.slug && b.chapter === body.chapter)) return c.json({ error: 'Invalid chapter' }, 400);
  const id = c.get('tma').user!.id, prefs = await settings(c.env, id), day = localClock(new Date(), prefs.timezone).day;
  if (body.read) await c.env.DB.prepare('INSERT OR IGNORE INTO reading_log(user_id,slug,chapter,day) VALUES(?,?,?,?)').bind(id, body.slug, body.chapter, day).run();
  else await c.env.DB.prepare('DELETE FROM reading_log WHERE user_id=? AND slug=? AND chapter=? AND day=?').bind(id, body.slug, body.chapter, day).run();
  return c.json(await state(c.env, id));
});

/** An atomic claim prevents overlapping cron invocations from sending the same message twice.
 * Ambiguous network failures retain the claim: prefer a missed reminder to duplicate messages. */
export async function sendReading(env: Env, now = new Date(), api: Pick<Api, 'sendMessage'> = new Api(env.BOT_TOKEN)) {
  const catalog = await readingCatalog(env);
  let after = 0;
  for (;;) {
    const page = await env.DB.prepare('SELECT * FROM reading_settings WHERE user_id>? AND (enabled=1 OR weekly=1) ORDER BY user_id LIMIT 100').bind(after).all<SettingsRow>();
    if (!page.results.length) break;
    for (const row of page.results) {
      after = row.user_id;
      const clock = localClock(now, row.timezone);
      // A 15-minute delivery window handles quarter-hour zones and cron jitter.
      const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      if (mins(clock.time) < mins(row.time) || mins(clock.time) >= mins(row.time) + 15) continue;
      const history = await logs(env, row.user_id), summary = readingSummary(catalog, history, clock.day);
      const monday = new Date(`${clock.day}T12:00:00Z`).getUTCDay() === 1;
      const weekly = !!row.weekly && monday;
      const daily = !!row.enabled && summary.count < 4 && !summary.finished;
      if (!weekly && !daily) continue;
      const kind = 'reading';
      const claimed = await env.DB.prepare("INSERT OR IGNORE INTO reading_deliveries(user_id,kind,day,status) VALUES(?,?,?,'claimed')").bind(row.user_id, kind, clock.day).run();
      if (!claimed.meta.changes) continue;
      const previous = history.filter(r => r.day >= shiftDay(clock.day, -7) && r.day < clock.day);
      const recap = weekly ? `<b>Your weekly reading recap</b>\n${previous.length} chapters across ${new Set(previous.map(r => r.day)).size} days.\n\n` : '';
      const chapters = summary.chapters.filter(c => !c.read).map(c => `${c.book} ${c.chapter}`).join(', ');
      const quote = await encouragement(env, clock.day);
      const words = quote ? `“${escapeHtml(quote.text)}”\n${quote.source ? `<a href="${escapeHtml(quote.source)}">Bishop Nathanyel · Source</a>` : 'Bishop Nathanyel'}` : 'Give attendance to reading. — 1 Timothy 4:13 (KJV)';
      const text = `${recap}<b>4 chapters a day</b>\n${summary.count >= 4 ? "Today's goal is complete." : daily ? `${summary.count}/4 complete today. Next: ${escapeHtml(chapters)}.` : 'Keep making time for your reading.'}\n\n${words}`;
      const keyboard = new InlineKeyboard().webApp('Open my Bible tracker', `${env.WORKER_URL}/plan`).row().text('Pause reading messages', 'reading:pause');
      try {
        await api.sendMessage(row.user_id, text, { parse_mode: 'HTML', reply_markup: keyboard });
        await env.DB.prepare("UPDATE reading_deliveries SET status='sent' WHERE user_id=? AND kind=? AND day=?").bind(row.user_id, kind, clock.day).run();
      } catch (error) {
        if (error instanceof GrammyError && error.error_code === 403) await env.DB.prepare('UPDATE reading_settings SET enabled=0,weekly=0 WHERE user_id=?').bind(row.user_id).run();
        console.error(JSON.stringify({ event: 'reading_delivery_failed', user: row.user_id, code: error instanceof GrammyError ? error.error_code : 'network' }));
      }
    }
  }
  await env.DB.prepare('DELETE FROM reading_deliveries WHERE day<?').bind(shiftDay(now.toISOString().slice(0, 10), -35)).run();
}
