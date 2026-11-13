import type { Env } from "./env";
import { open, pid, seal } from "./privacy.mjs";

/**
 * Requests for class notes. Writing notes from a transcript costs money, so not every class gets
 * them: a reader asks for the class they want, one vote each, and the admins see the classes most
 * asked for first, and each class asked for has an issue the scheduled notes job works from
 * (request-issues.ts). A request is
 * kept until the notes are published (notes-ready.ts) or an admin marks it done. Who asked is kept
 * to count each reader once, as pseudonymous IDs (privacy.mjs); Telegram IDs from before are
 * converted when the request is next touched.
 *
 * A reader who asks to be told when the notes are ready is also kept in `tell`, sealed: their name
 * (shown to the admins with the request) and, when they asked in Telegram, the chat the bot answers
 * in. It is deleted with the request once they have been told.
 */
export type NoteRequest = { video: string; title: string; count: number; users: (string | number)[]; first: string; last: string; issue?: number; tell?: string };
/** A reader to tell when the notes are ready: in Telegram by the bot, in the phone app when it next opens. */
export type Teller = { pid: string; name: string; username?: string; via: "telegram" | "app"; chat?: number };
/** Who is asking, as the sign-in proved it. */
export type Asker = { id: number; name: string; username?: string; via: "telegram" | "app" };
type Keys = Pick<Env, "SUBS" | "PRIVACY_KEY" | "BOT_TOKEN">;
const asPids = async (env: Keys, users: (string | number)[]) => Promise.all(users.map((u) => (typeof u === "number" ? pid(env, u) : u)));

const sealOwner = (video: string) => `notereq:${video}`;

/** The readers waiting to be told, opened. */
export async function tellersOf(env: Keys, r: NoteRequest | null): Promise<Teller[]> {
  if (!r?.tell) return [];
  const list = await open(env, sealOwner(r.video), r.tell);
  return Array.isArray(list) ? (list as Teller[]) : [];
}

const sealTellers = (env: Keys, video: string, list: Teller[]) => (list.length ? seal(env, sealOwner(video), list) : Promise.resolve(undefined));

/** This request without one reader in it (their ask, and their wish to be told). Null when nobody else asked. */
export async function withoutReader(env: Keys, r: NoteRequest, userId: number): Promise<NoteRequest | null> {
  const me = await pid(env, userId);
  if (!r.users.some((u) => u === me || u === userId)) return r;
  const count = Math.max(0, r.count - 1);
  if (!count) return null;
  const tell = (await tellersOf(env, r)).filter((t) => t.pid !== me);
  return { ...r, users: r.users.filter((u) => u !== me && u !== userId), count, tell: await sealTellers(env, r.video, tell) };
}

/** Whether this reader has asked for the class. */
export async function askedBy(env: Keys, r: NoteRequest | null, userId: number): Promise<boolean> {
  if (!r) return false;
  const me = await pid(env, userId);
  return r.users.some((u) => u === me || u === userId);
}
export type RequestRow = { video: string; title: string; count: number; last: string };

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const key = (video: string) => `notereq:${video}`;
/** The admins hear of a class when it is first asked for, and as it gathers more asks. */
export const MILESTONES = new Set([1, 5, 10, 25, 50, 100]);

export const validVideo = (video: string) => VIDEO.test(video);

export async function getRequest(env: Pick<Env, "SUBS">, video: string): Promise<NoteRequest | null> {
  return validVideo(video) ? ((await env.SUBS.get(key(video), "json")) as NoteRequest | null) : null;
}

/**
 * One reader's ask for a class's notes. Asking twice counts once; asking again with `tell` on
 * adds the reader to those told when the notes are ready.
 */
export async function requestNotes(env: Keys, video: string, asker: number | Asker, title: string, now = new Date(),
  notify?: (r: NoteRequest) => Promise<void> | void, tell = false): Promise<{ count: number; mine: boolean; added: boolean; tell: boolean }> {
  if (!validVideo(video)) throw new Error("bad-video");
  const who: Asker = typeof asker === "number" ? { id: asker, name: "", via: "telegram" } : asker;
  const at = now.toISOString();
  const cur = (await env.SUBS.get(key(video), "json")) as NoteRequest | null;
  const me = await pid(env, who.id);
  const asked = await askedBy(env, cur, who.id);
  const tellers = await tellersOf(env, cur);
  const told = tellers.some((t) => t.pid === me);
  if (asked && (told || !tell)) return { count: cur!.count, mine: true, added: false, tell: told };
  const nextTell = tell && !told
    ? [...tellers, { pid: me, name: who.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 64), via: who.via,
      ...(who.username ? { username: who.username.slice(0, 64) } : {}), ...(who.via === "telegram" ? { chat: who.id } : {}) } satisfies Teller]
    : tellers;
  const base: NoteRequest = cur
    ? (asked ? cur : { ...cur, title: cur.title || title, count: cur.count + 1, users: [...(await asPids(env, cur.users)), me].slice(-5000), last: at })
    : { video, title: title.slice(0, 200), count: 1, users: [me], first: at, last: at };
  const next: NoteRequest = { ...base, tell: await sealTellers(env, video, nextTell.slice(-5000)) };
  await env.SUBS.put(key(video), JSON.stringify(next), { metadata: { title: next.title, count: next.count, last: next.last } satisfies Omit<RequestRow, "video"> });
  if (!asked && notify && MILESTONES.has(next.count)) await notify(next);
  return { count: next.count, mine: true, added: !asked, tell: tell || told };
}

/** Every class asked for, the most asked first, then the most recently asked. */
export async function listRequests(env: Pick<Env, "SUBS">): Promise<RequestRow[]> {
  const rows: RequestRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SUBS.list<Omit<RequestRow, "video">>({ prefix: "notereq:", cursor });
    for (const k of page.keys) {
      const m = k.metadata;
      rows.push({ video: k.name.slice("notereq:".length), title: m?.title ?? "", count: m?.count ?? 0, last: m?.last ?? "" });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return rows.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

/** An admin marks a class's notes done (or turns the request down): it leaves the list. */
export async function closeRequest(env: Pick<Env, "SUBS">, video: string): Promise<boolean> {
  if (!validVideo(video)) return false;
  await env.SUBS.delete(key(video));
  return true;
}
