import type { Env } from "./env";

/**
 * Ask CyberJudah's conversations, kept for each person so an answer paid for is never lost:
 * every question and its answer (with the sources, the follow-ups and the research steps)
 * is saved to the person's account on the server as it completes, and the app lists them
 * to reopen. Stored in KV: `chats:<user>` is the index, newest first; `chat:<user>:<id>`
 * holds one conversation.
 */
export type SavedSource = { n: number; kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string };
export type SavedTurn = { role: "user" | "assistant"; content: string; sources?: SavedSource[]; followups?: string[]; steps?: string[] };
export type Chat = { id: string; title: string; created: string; updated: string; turns: SavedTurn[] };
export type ChatSummary = { id: string; title: string; updated: string; count: number };

export const CHAT_ID = /^[a-z0-9]{8,40}$/;
const MAX_CHATS = 300;
const MAX_TURNS = 120;

const indexKey = (uid: number) => `chats:${uid}`;
const chatKey = (uid: number, id: string) => `chat:${uid}:${id}`;
/** A deleted conversation, remembered for a day: an answer still being written when it was deleted must not bring it back. */
const goneKey = (uid: number, id: string) => `chatgone:${uid}:${id}`;
const titleOf = (q: string) => { const t = q.replace(/\s+/g, " ").trim(); return t.length > 80 ? `${t.slice(0, 78).replace(/\s+\S*$/, "")}…` : t; };
/** The sources without the passage text: the app needs where they lead, not what they said. */
const slim = (s: SavedSource & { text?: string }): SavedSource => ({ n: s.n, kind: s.kind, title: s.title, url: s.url, ...(s.sub ? { sub: s.sub } : {}), ...(s.video ? { video: s.video, t: s.t ?? 0 } : {}), ...(s.date ? { date: s.date } : {}) });

export async function listChats(env: Env, uid: number): Promise<ChatSummary[]> {
  return ((await env.SUBS.get(indexKey(uid), "json")) as ChatSummary[] | null) ?? [];
}

export async function getChat(env: Env, uid: number, id: string): Promise<Chat | null> {
  if (!CHAT_ID.test(id)) return null;
  return (await env.SUBS.get(chatKey(uid, id), "json")) as Chat | null;
}

/**
 * One question and its answer, added to the conversation (created on its first question).
 * `replaceLast` is a retry: the same question asked again replaces its earlier exchange instead
 * of repeating it.
 */
export async function saveExchange(env: Env, uid: number, id: string, question: string, answer: { content: string; sources?: (SavedSource & { text?: string })[]; followups?: string[]; steps?: string[] }, replaceLast = false): Promise<void> {
  if (!CHAT_ID.test(id) || !answer.content.trim()) return;
  if (await env.SUBS.get(goneKey(uid, id))) return;
  const now = new Date().toISOString();
  const chat: Chat = (await getChat(env, uid, id)) ?? { id, title: titleOf(question), created: now, updated: now, turns: [] };
  const n = chat.turns.length;
  if (replaceLast && n >= 2 && chat.turns[n - 2].role === "user" && chat.turns[n - 2].content.trim() === question.trim()) chat.turns.splice(n - 2, 2);
  chat.turns.push({ role: "user", content: question }, { role: "assistant", content: answer.content, sources: (answer.sources ?? []).map(slim), followups: answer.followups ?? [], steps: answer.steps ?? [] });
  chat.turns = chat.turns.slice(-MAX_TURNS);
  chat.updated = now;
  await env.SUBS.put(chatKey(uid, id), JSON.stringify(chat));
  const index = (await listChats(env, uid)).filter((c) => c.id !== id);
  const kept = [{ id, title: chat.title, updated: now, count: chat.turns.length / 2 }, ...index].slice(0, MAX_CHATS);
  await env.SUBS.put(indexKey(uid), JSON.stringify(kept));
  // A conversation that falls off the end of the list goes with it.
  for (const gone of index.slice(MAX_CHATS - 1)) await env.SUBS.delete(chatKey(uid, gone.id));
}

export async function deleteChat(env: Env, uid: number, id: string): Promise<boolean> {
  if (!CHAT_ID.test(id)) return false;
  await env.SUBS.put(goneKey(uid, id), "1", { expirationTtl: 86400 });
  await env.SUBS.delete(chatKey(uid, id));
  await env.SUBS.put(indexKey(uid), JSON.stringify((await listChats(env, uid)).filter((c) => c.id !== id)));
  return true;
}
