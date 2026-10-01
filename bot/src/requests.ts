import type { Env } from "./env";

/**
 * Requests for class notes. Writing notes from a transcript costs money, so not every class gets
 * them: a reader asks for the class they want, one vote each, and the admins see the classes most
 * asked for first and draft those (the draft-notes workflow takes their video ids). A request is
 * kept until an admin marks it done.
 */
export type NoteRequest = { video: string; title: string; count: number; users: number[]; first: string; last: string };
export type RequestRow = { video: string; title: string; count: number; last: string };

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const key = (video: string) => `notereq:${video}`;
/** The admins hear of a class when it is first asked for, and as it gathers more asks. */
export const MILESTONES = new Set([1, 5, 10, 25, 50, 100]);

export const validVideo = (video: string) => VIDEO.test(video);

export async function getRequest(env: Pick<Env, "SUBS">, video: string): Promise<NoteRequest | null> {
  return validVideo(video) ? ((await env.SUBS.get(key(video), "json")) as NoteRequest | null) : null;
}

/** One reader's ask for a class's notes. Asking twice counts once. */
export async function requestNotes(env: Pick<Env, "SUBS">, video: string, userId: number, title: string, now = new Date(),
  notify?: (r: NoteRequest) => Promise<void> | void): Promise<{ count: number; mine: boolean; added: boolean }> {
  if (!validVideo(video)) throw new Error("bad-video");
  const at = now.toISOString();
  const cur = (await env.SUBS.get(key(video), "json")) as NoteRequest | null;
  if (cur?.users.includes(userId)) return { count: cur.count, mine: true, added: false };
  const next: NoteRequest = cur
    ? { ...cur, title: cur.title || title, count: cur.count + 1, users: [...cur.users, userId].slice(-5000), last: at }
    : { video, title: title.slice(0, 200), count: 1, users: [userId], first: at, last: at };
  await env.SUBS.put(key(video), JSON.stringify(next), { metadata: { title: next.title, count: next.count, last: next.last } satisfies Omit<RequestRow, "video"> });
  if (notify && MILESTONES.has(next.count)) await notify(next);
  return { count: next.count, mine: true, added: true };
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
