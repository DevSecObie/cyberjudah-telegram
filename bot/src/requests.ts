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
/** First name only: no @username is kept for a request (#622). */
export type Teller = { pid: string; name: string; via: "telegram" | "app"; chat?: number };
/**
 * Who is asking, as the sign-in proved it: `pid` is their pseudonymous ID (a Telegram reader's, or
 * an app reader's keyed from their sign-in, app-requests.ts), `chat` the Telegram chat to tell them in.
 */
export type Asker = { pid: string; name: string; via: "telegram" | "app"; chat?: number };
/** A reader as a number (a Telegram ID, also matched against requests from before pids) or a pid. */
type Who = number | string;
const pidOf = (env: Keys, who: Who) => (typeof who === "number" ? pid(env, who) : Promise.resolve(who));
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
export async function withoutReader(env: Keys, r: NoteRequest, who: Who): Promise<NoteRequest | null> {
  const me = await pidOf(env, who);
  if (!r.users.some((u) => u === me || u === who)) return r;
  const count = Math.max(0, r.count - 1);
  if (!count) return null;
  const tell = (await tellersOf(env, r)).filter((t) => t.pid !== me);
  return { ...r, users: r.users.filter((u) => u !== me && u !== who), count, tell: await sealTellers(env, r.video, tell) };
}

/** Whether this reader has asked for the class. */
export async function askedBy(env: Keys, r: NoteRequest | null, who: Who): Promise<boolean> {
  if (!r) return false;
  const me = await pidOf(env, who);
  return r.users.some((u) => u === me || u === who);
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
  const who: Who = typeof asker === "number" ? asker : asker.pid;
  const me = await pidOf(env, who);
  const at = now.toISOString();
  const cur = (await env.SUBS.get(key(video), "json")) as NoteRequest | null;
  const asked = await askedBy(env, cur, who);
  const tellers = await tellersOf(env, cur);
  const told = tellers.some((t) => t.pid === me);
  if (asked && (told || !tell)) return { count: cur!.count, mine: true, added: false, tell: told };
  const a: Asker = typeof asker === "number" ? { pid: me, name: "", via: "telegram", chat: asker } : asker;
  // A @username kept before #622 is dropped the next time the request is written.
  const kept = tellers.map(({ pid: p, name, via, chat }) => ({ pid: p, name, via, ...(chat ? { chat } : {}) }) satisfies Teller);
  const nextTell = tell && !told
    ? [...kept, { pid: me, name: a.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 64), via: a.via,
      ...(a.via === "telegram" && a.chat ? { chat: a.chat } : {}) } satisfies Teller]
    : kept;
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
