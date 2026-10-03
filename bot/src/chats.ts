import type { Env } from "./env";
import { open, pid, seal } from "./privacy.mjs";

/**
 * Ask CyberJudah's conversations, kept for each person so an answer paid for is never lost:
 * every question and its answer (with the sources, the follow-ups and the research steps)
 * is saved to the person's account on the server as it completes, and the app lists them
 * to reopen. Stored in KV under the person's pseudonymous ID (privacy.ts), never their
 * Telegram ID: `chats:<pid>` is the index, newest first; `chat:<pid>:<id>` holds one
 * conversation. Both are sealed (encrypted for that person alone), and both go by themselves
 * after CHAT_TTL without use (docs/PRIVACY.md).
 */
export type SavedSource = { n: number; kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string };
/** A change the assistant proposed, which only the reader can carry out (see assistant.mjs). `state` is set when the reader acts on it. */
export type SavedAction = { id: string; kind: "reminder"; summary: string; settings: Record<string, unknown>; state?: "applied" | "cancelled" };
export type SavedTurn = { role: "user" | "assistant"; content: string; sources?: SavedSource[]; followups?: string[]; steps?: string[]; actions?: SavedAction[]; cut?: boolean };
export type Chat = { id: string; title: string; created: string; updated: string; turns: SavedTurn[] };
export type ChatSummary = { id: string; title: string; updated: string; count: number };

export const CHAT_ID = /^[a-z0-9]{8,40}$/;
const MAX_CHATS = 300;
const MAX_TURNS = 120;
/** Saved conversations are kept 180 days from their last use, then removed by themselves. */
export const CHAT_TTL = 180 * 86400;

const indexKey = (owner: string) => `chats:${owner}`;
const chatKey = (owner: string, id: string) => `chat:${owner}:${id}`;
/** A deleted conversation, remembered for a day: an answer still being written when it was deleted must not bring it back. */
const goneKey = (owner: string, id: string) => `chatgone:${owner}:${id}`;
/** A question still being answered: so a refresh, a lost connection or another device can wait for it instead of calling it lost. */
const pendingKey = (owner: string, id: string) => `chatpending:${owner}:${id}`;
export type Pending = { q: string; at: string };
/** Ten minutes is longer than any answer takes; a marker left by a crash goes by itself. */
const PENDING_TTL = 600;
const titleOf = (q: string) => { const t = q.replace(/\s+/g, " ").trim(); return t.length > 80 ? `${t.slice(0, 78).replace(/\s+\S*$/, "")}…` : t; };
/** The sources without the passage text: the app needs where they lead, not what they said. */
const slim = (s: SavedSource & { text?: string }): SavedSource => ({ n: s.n, kind: s.kind, title: s.title, url: s.url, ...(s.sub ? { sub: s.sub } : {}), ...(s.video ? { video: s.video, t: s.t ?? 0 } : {}), ...(s.date ? { date: s.date } : {}) });

const put = async (env: Env, owner: string, key: string, value: unknown) => env.SUBS.put(key, await seal(env, owner, value), { expirationTtl: CHAT_TTL });

/**
 * Conversations saved before records were pseudonymous and sealed (under `chats:<telegram id>`)
 * move to the new keys the first time they are read, sealed, and the old records are removed.
 */
export async function moveLegacy(env: Env, uid: number, owner: string): Promise<ChatSummary[] | null> {
  const old = (await env.SUBS.get(`chats:${uid}`, "json")) as ChatSummary[] | null;
  if (!old) return null;
  for (const c of old) {
    const chat = await env.SUBS.get(`chat:${uid}:${c.id}`);
    if (chat) await put(env, owner, chatKey(owner, c.id), JSON.parse(chat));
    await env.SUBS.delete(`chat:${uid}:${c.id}`);
  }
  await put(env, owner, indexKey(owner), old);
  await env.SUBS.delete(`chats:${uid}`);
  return old;
}

export async function listChats(env: Env, uid: number): Promise<ChatSummary[]> {
  const owner = await pid(env, uid);
  const list = await open<ChatSummary[]>(env, owner, await env.SUBS.get(indexKey(owner)));
  return list ?? (await moveLegacy(env, uid, owner)) ?? [];
}

export async function markPending(env: Env, uid: number, id: string, q: string): Promise<void> {
  if (!CHAT_ID.test(id)) return;
  const owner = await pid(env, uid);
  await env.SUBS.put(pendingKey(owner, id), await seal(env, owner, { q, at: new Date().toISOString() } satisfies Pending), { expirationTtl: PENDING_TTL });
}
export async function clearPending(env: Env, uid: number, id: string): Promise<void> {
  if (CHAT_ID.test(id)) await env.SUBS.delete(pendingKey(await pid(env, uid), id));
}
export async function getPending(env: Env, uid: number, id: string): Promise<Pending | null> {
  if (!CHAT_ID.test(id)) return null;
  const owner = await pid(env, uid);
  return open<Pending>(env, owner, await env.SUBS.get(pendingKey(owner, id)));
}

export async function getChat(env: Env, uid: number, id: string): Promise<Chat | null> {
  if (!CHAT_ID.test(id)) return null;
  const owner = await pid(env, uid);
  const sealed = await env.SUBS.get(chatKey(owner, id));
  if (sealed) return open<Chat>(env, owner, sealed);
  // Not moved yet: moving the whole list brings this one too.
  if (!(await moveLegacy(env, uid, owner))) return null;
  return open<Chat>(env, owner, await env.SUBS.get(chatKey(owner, id)));
}

/**
 * One question and its answer, added to the conversation (created on its first question).
 * `replaceLast` is a retry: the same question asked again replaces its earlier exchange instead
 * of repeating it.
 */
export async function saveExchange(env: Env, uid: number, id: string, question: string, answer: { content: string; sources?: (SavedSource & { text?: string })[]; followups?: string[]; steps?: string[]; actions?: SavedAction[]; cut?: boolean }, replaceLast = false): Promise<void> {
  if (!CHAT_ID.test(id) || !answer.content.trim()) return;
  const owner = await pid(env, uid);
  if (await env.SUBS.get(goneKey(owner, id))) return;
  const now = new Date().toISOString();
  const chat: Chat = (await getChat(env, uid, id)) ?? { id, title: titleOf(question), created: now, updated: now, turns: [] };
  const n = chat.turns.length;
  if (replaceLast && n >= 2 && chat.turns[n - 2].role === "user" && chat.turns[n - 2].content.trim() === question.trim()) chat.turns.splice(n - 2, 2);
  chat.turns.push({ role: "user", content: question }, { role: "assistant", content: answer.content, sources: (answer.sources ?? []).map(slim), followups: answer.followups ?? [], steps: answer.steps ?? [], ...(answer.actions?.length ? { actions: answer.actions } : {}), ...(answer.cut ? { cut: true } : {}) });
  chat.turns = chat.turns.slice(-MAX_TURNS);
  chat.updated = now;
  await put(env, owner, chatKey(owner, id), chat);
  const index = (await listChats(env, uid)).filter((c) => c.id !== id);
  const kept = [{ id, title: chat.title, updated: now, count: chat.turns.length / 2 }, ...index].slice(0, MAX_CHATS);
  await put(env, owner, indexKey(owner), kept);
  // A conversation that falls off the end of the list goes with it.
  for (const gone of index.slice(MAX_CHATS - 1)) await env.SUBS.delete(chatKey(owner, gone.id));
}

export async function deleteChat(env: Env, uid: number, id: string): Promise<boolean> {
  if (!CHAT_ID.test(id)) return false;
  const owner = await pid(env, uid);
  await env.SUBS.put(goneKey(owner, id), "1", { expirationTtl: 86400 });
  await env.SUBS.delete(chatKey(owner, id));
  await put(env, owner, indexKey(owner), (await listChats(env, uid)).filter((c) => c.id !== id));
  return true;
}

/** Every saved conversation removed at once (Delete my data). */
export async function deleteAllChats(env: Env, uid: number): Promise<number> {
  const owner = await pid(env, uid);
  const list = await listChats(env, uid);
  for (const c of list) { await env.SUBS.put(goneKey(owner, c.id), "1", { expirationTtl: 86400 }); await env.SUBS.delete(chatKey(owner, c.id)); }
  await env.SUBS.delete(indexKey(owner));
  return list.length;
}

/** The reader applied or cancelled a proposed change: remembered on the answer, so a reopened chat shows what was done. */
export async function setActionState(env: Env, uid: number, id: string, actionId: string, state: "applied" | "cancelled"): Promise<boolean> {
  const chat = await getChat(env, uid, id);
  if (!chat) return false;
  let found = false;
  for (const t of chat.turns) for (const a of t.actions ?? []) if (a.id === actionId) { a.state = state; found = true; }
  if (!found) return false;
  const owner = await pid(env, uid);
  await put(env, owner, chatKey(owner, id), chat);
  return true;
}
