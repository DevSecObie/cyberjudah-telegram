import type { Env, Exec } from "./env";
import type { Passage } from "./ai.mjs";
import { MORE_RUN } from "./ask-tools";
import { books, chapter, dataJson } from "./data";
import { parseReference } from "./refs.mjs";
import { captionCorrections, searchTeachings, transcriptAround } from "./teachings";
import { FEED_LABEL } from "./teachings.mjs";
import { createAppResearch, RESEARCH_RESOURCES } from "./app-study-research";
import { bs } from "./bs";
import { BOOKS, COLLECTION } from "./bs/core";
import { htmlToText } from "./html-text";

// Public library reading shared by Ask and the authenticated MCP transport.
export type Reading = { content: { type: "text"; text: string }[]; isError?: true; sources?: Passage[] };
type Answer = Reading;
const answer = (text: string, sources?: Passage[]): Reading => ({ content: [{ type: "text", text }], ...(sources ? { sources } : {}) });
const failure = (text: string): Reading => ({ isError: true, content: [{ type: "text", text }] });

/** Ask's links are paths on the site; an assistant outside the app needs the whole address. */
const linkOn = (env: Env, path: string) => (path.startsWith("/") ? `${env.SITE_URL}${path}` : path);
const lineOn = (env: Env) => (name: string, what: string, path: string) => `${name}: ${what} Link: ${linkOn(env, path)}`;
const quiet = () => {};
const noCitations = () => null;

/** The KJV text of a reference, as Ask reads it (agent.ts read_scripture). */
export async function readPassage(env: Env, reference: string, ctx?: Exec): Promise<Answer> {
  const list = await books(env, ctx);
  const ref = list ? parseReference(reference, list) : null;
  if (!ref) return failure(`"${reference}" is not a reference this Bible has. Use the book, chapter and verses, like "Exodus 12:14".`);
  const c = await chapter(env, ref.slug, ref.chapter, ctx);
  if (!c) return failure(`${ref.label} could not be read just now.`);
  const from = ref.verse ?? 1, to = ref.verseEnd ?? ref.verse ?? c.verses.length;
  const verses = c.verses.filter((v) => v.verse >= from && v.verse <= to);
  if (!verses.length) return failure(`${ref.label} has no such verses.`);
  const label = ref.verse ? `${ref.book} ${ref.chapter}:${from}${to > from ? `-${to}` : ""}` : `${ref.book} ${ref.chapter}`;
  return answer(`${label} (KJV)\n${verses.map((v) => `${v.verse} ${v.text}`).join("\n")}\nLink: ${linkOn(env, `/bible/${ref.slug}/${ref.chapter}`)}`);
}

/** The classes that said something, from the same search as "Said in Class" (teachings.ts). */
export async function searchClasses(env: Env, query: string, feed: string, page: number): Promise<Answer> {
  if (query.trim().length < 2 || query.length > 200 || !["", "classes", "captains", "history"].includes(feed) || !Number.isInteger(page) || page < 0 || page > 20) return failure("Give words from the class and a valid page or series.");
  const r = await searchTeachings(env, query, feed, page);
  if (!r.ok) return failure("The class search is not answering just now. Try again in a moment.");
  if (!r.hits.length) return answer(`No class matches “${query}”. Try other words, or a scripture with verse_study.`);
  const unmark = (s: string) => s.replace(/[]/g, "");
  const out = r.hits.map((h) => {
    const at = Math.max(0, Math.floor(h.start || 0));
    const when = `${Math.floor(at / 3600)}:${String(Math.floor((at % 3600) / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
    const kind = (FEED_LABEL as Record<string, string>)[h.feed] ?? h.feed;
    return `${unmark(h.title)} (${kind}, ${h.date || "date unknown"}) at ${when}\n“${unmark(h.excerpt)}”\nVideo: https://www.youtube.com/watch?v=${h.video}&t=${at}s\nNotes: ${h.note ? linkOn(env, h.note) : "none yet"}`;
  });
  return answer(`${out.join("\n\n")}${r.more ? `\n\nMore classes match: call again with page ${page + 1}.` : ""}`, r.hits.map(h => ({ kind: "spoken", title: unmark(h.title), video: h.video, t: Math.max(0, Math.floor(h.start || 0)), date: h.date || undefined, url: h.note || `https://www.youtube.com/watch?v=${h.video}&t=${Math.max(0, Math.floor(h.start || 0))}s`, text: unmark(h.excerpt) })));
}

/** One of Ask's lookups (ask-tools.ts), with nothing streamed and no citation numbers. */
export const lookup = (env: Env, ctx: Exec | undefined, tool: keyof typeof MORE_RUN, input: Record<string, unknown>) =>
  MORE_RUN[tool](env, input, ctx, quiet, lineOn(env), noCitations).then((r) => (r.error ? failure(r.content) : answer(r.content)));


/** Site paths and data files a reader can already open; nothing else is read. */
export const SITE_PATH = /^\/[a-z0-9][a-z0-9/_-]*$/i;
export const DATA_PATH = /^(?:api|search)\/[a-z0-9][a-z0-9/_.-]*\.json$/i;
export const RESOURCE_PATH = /^v1\/[a-z0-9-]+\/[A-Za-z0-9/_.,:-]*(?:\?[A-Za-z0-9_.,:%&=+ -]*)?$/;
const PART = 40_000;
const noDots = (p: string) => !p.split(/[/?]/).some((seg) => seg === ".." || seg === ".");

/** A long text in parts, so one answer never floods the assistant. */
function part(text: string, offset: number): string {
  if (offset >= text.length) return offset ? "Nothing more: that was the end." : text;
  const end = Math.min(text.length, offset + PART);
  return `${text.slice(offset, end)}${end < text.length ? `\n\n[Part ${Math.floor(offset / PART) + 1}: characters ${offset} to ${end} of ${text.length}. Call again with offset ${end} to read on.]` : ""}`;
}

export async function searchLibrary(env: Env, resource: (typeof RESEARCH_RESOURCES)[number], query: string, ctx?: Exec): Promise<Answer> {
  const research = createAppResearch(env, [], quiet, ctx);
  await research.search([{ resource, query }]);
  if (research.unavailable.length) return failure(`${resource.replaceAll("-", " ")} could not be read just now. Try again in a moment.`);
  if (!research.sources.length) return answer(`Nothing in ${resource.replaceAll("-", " ")} for “${query}”. Try other words.`);
  return answer(research.sources.map((s) => {
    const at = s.video ? `\nVideo: https://www.youtube.com/watch?v=${s.video}${s.t ? `&t=${Math.floor(s.t)}s` : ""}` : "";
    return `${s.title}${s.sub ? ` · ${s.sub}` : ""}${s.date ? ` (${s.date})` : ""}\n${s.text}\nLink: ${linkOn(env, s.url)}${at}`;
  }).join("\n\n"));
}

export async function readNote(env: Env, path: string, offset: number, ctx?: Exec): Promise<Answer> {
  if (!SITE_PATH.test(path) || !noDots(path) || !Number.isSafeInteger(offset) || offset < 0) return failure("Give a site path like /classes/2026/<slug>.");
  const note = await dataJson<Record<string, unknown>>(env, `/api/notes${path.replace(/\/$/, "")}.json`, ctx);
  if (!note) return failure(`No note at ${path}. Find its path in read_data api/notes/index.json.`);
  const head = ["title", "teacher", "date", "range", "series"].map((k) => (typeof note[k] === "string" && note[k] ? `${k}: ${note[k]}` : "")).filter(Boolean).join("\n");
  const video = typeof note.videoId === "string" ? `\nVideo: https://www.youtube.com/watch?v=${note.videoId}` : "";
  const full = `${head}${video}\nLink: ${linkOn(env, path)}\n\n${typeof note.body === "string" ? note.body : JSON.stringify(note)}`;
  const text = part(full, offset);
  return answer(text, offset >= full.length ? [] : [{ kind: "note", title: typeof note.title === "string" ? note.title : path, url: path, sub: `characters:${offset}`, text, teacher: typeof note.teacher === "string" ? note.teacher : undefined, date: typeof note.date === "string" ? note.date : undefined }]);
}

export async function readTranscript(env: Env, video: string, at: number, span: number, ctx?: Exec): Promise<Answer> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video) || !Number.isFinite(at) || at < 0 || at > 86400 || !Number.isInteger(span) || span < 30 || span > 600) return failure("Give a video ID, a moment and a span from 30 to 600 seconds.");
  const w = await transcriptAround(env, video, at, ctx, span);
  if (!w.ok) return failure("No transcript for that video and moment.");
  const clock = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  // Clear caption errors (a book or feast word misheard), shown beside the captions, never in place of them.
  const fixes = (await captionCorrections(env, video, ctx)).filter(([, t]) => t >= at - span && t <= at + span);
  const fixed = fixes.length ? `\n\nCaption corrections (the captions above are as YouTube gave them):\n${fixes.map(([, t, was, now]) => `[${clock(t)}] “${was}” reads “${now}”`).join("\n")}` : "";
  const text = `${w.title} (${w.date || "date unknown"})\nVideo: https://www.youtube.com/watch?v=${video}&t=${Math.floor(at)}s\nNotes: ${w.url ? linkOn(env, w.url) : "none yet"}\n\n${w.chunks.map((c) => `[${clock(c.t)}] ${c.text}`).join("\n")}${fixed}`;
  return answer(text, [{ kind: "spoken", title: w.title, video, t: at, date: w.date || undefined, url: w.url || `https://www.youtube.com/watch?v=${video}&t=${Math.floor(at)}s`, text }]);
}

/** HTML as the text a reader sees: a real parser, so no markup survives into the answer. */
/** The app's public resource feed, asked in the Worker itself (bs/index.ts), GET only. */
async function feed(env: Env, path: string): Promise<{ status: number; text: string }> {
  const res = await bs.request(`https://mcp.internal/${path}`, { method: "GET" }, env);
  return { status: res.status, text: await res.text() };
}

export async function readResource(env: Env, path: string, offset: number): Promise<Answer> {
  if (!noDots(path)) return failure("Give a path after /bs/ like v1/naves/en/topics?search=sabbath.");
  const r = await feed(env, path);
  if (r.status === 404 || r.status === 400) return failure(`Nothing at /bs/${path}.`);
  if (r.status !== 200) return failure("The resource feed is not answering just now. Try again in a moment.");
  return answer(part(r.text, offset));
}

export async function readCommentary(env: Env, reference: string, ctx?: Exec): Promise<Answer> {
  const list = await books(env, ctx);
  const ref = list ? parseReference(reference, list) : null;
  if (!ref || ref.verse == null) return failure(`Give one verse, like "Deuteronomy 28:68".`);
  const book = (BOOKS as { id: number; slug: string }[]).find((b) => b.slug === ref.slug);
  if (!book) return failure(`${ref.book} has no commentary.`);
  const r = await feed(env, `v1/commentaries/${COLLECTION}/en/verses/${book.id}-${ref.chapter}-${ref.verse}`);
  if (r.status === 404) return answer(`No commentary yet on ${ref.label}.`);
  if (r.status !== 200) return failure("The commentary is not answering just now. Try again in a moment.");
  // The feed's commentary is HTML for the app's screen; the assistant reads it as plain text.
  let html = "";
  try { const c = (JSON.parse(r.text) as { content?: unknown }).content; html = typeof c === "string" ? c : ""; } catch { /* below */ }
  if (!html) return answer(`No commentary yet on ${ref.label}.`);
  const text = htmlToText(html);
  const content = part(`${ref.label} (commentary from the classes)\n\n${text}`, 0);
  return answer(content, [{ kind: "commentary", title: ref.label, url: `/bible/${ref.slug}/${ref.chapter}#v${ref.verse}`, text: content }]);
}

export async function readData(env: Env, path: string, offset: number, ctx?: Exec): Promise<Answer> {
  if (!DATA_PATH.test(path) || !noDots(path) || !Number.isSafeInteger(offset) || offset < 0) return failure("Give a data path like api/cases/index.json.");
  const data = await dataJson<unknown>(env, `/${path}`, ctx);
  if (data == null) return failure(`No data file at ${path}. Start at api/index.json.`);
  const full = JSON.stringify(data), text = part(full, offset);
  return answer(text, offset >= full.length ? [] : [{ kind: "data", title: path, url: `${env.DATA_ORIGIN.replace(/\/$/, "")}/${path}`, sub: `characters:${offset}`, text }]);
}
