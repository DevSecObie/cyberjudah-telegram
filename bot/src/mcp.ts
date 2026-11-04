import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Env, Exec } from "./env";
import { MORE_RUN } from "./ask-tools";
import { books, chapter } from "./data";
import { parseReference } from "./refs.mjs";
import { searchTeachings, transcriptAround } from "./teachings";
import { FEED_LABEL } from "./teachings.mjs";
import { createAppResearch, RESEARCH_RESOURCES } from "./app-study-research";
import { bs } from "./bs";
import { BOOKS, COLLECTION } from "./bs/core";
import { dataJson } from "./data";
import { htmlToText } from "./html-text";

/**
 * CyberJudah for AI assistants: an MCP server at /mcp, laid out after Bible Strong's
 * (packages/mcp-service in smontlouis/bible-strong, ADR-0085) and Cloudflare's stateless
 * remote MCP guide. One server is built for each request; nothing is kept between requests.
 *
 * - Every tool only reads, and only what the app already shows every reader: the public data
 *   site (data.cyberjudah.io), the public resource feed (/bs/v1) and the class search. Nothing
 *   about a person (accounts, studies, chats, credits) and no outside web.
 * - The text comes from the app's data, never from the model: a tool takes a reference, a
 *   name or a subject and answers with the app's own words and a link.
 * - For now it is private: it answers only a request carrying the owner's key (MCP_KEY, a
 *   Worker secret the owner sets). Without that secret it answers nothing at all.
 */

export const INSTRUCTIONS =
  "CyberJudah reads the King James Bible (1611, with the Apocrypha) and what the IUIC classes " +
  "taught on it: the classes and notes on each verse with the moment in the class, the precepts, " +
  "the People, the Timeline, the Law handbook and Strong's. Never quote Scripture or a class from " +
  "memory: read it with a tool, then cite the reference and the class with its link. Keep the " +
  "classes' own words; do not soften or reword them. The Bishops' and Deacons' teaching comes " +
  "first. Give each link a tool returns with what it supports; never build one yourself. " +
  "To read everything: the indexes in read_data (api/notes/index.json lists every class, study " +
  "note and episode; api/index.json lists every data file) lead to read_note and read_data for " +
  "each item, and search_library searches any one resource.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

type Answer = { content: { type: "text"; text: string }[]; isError?: true };
const answer = (text: string): Answer => ({ content: [{ type: "text", text }] });
const failure = (text: string): Answer => ({ isError: true, content: [{ type: "text", text }] });

/** A reading that fails tells the model something it can act on, never a trace. */
const guarded = (name: string, read: () => Promise<Answer>) => read().catch((cause: unknown) => {
  console.error(JSON.stringify({ message: "mcp tool failure", tool: name, error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) }));
  return failure("CyberJudah could not answer this just now. Try again in a moment.");
});

/** Ask's links are paths on the site; an assistant outside the app needs the whole address. */
const linkOn = (env: Env, path: string) => (path.startsWith("/") ? `${env.SITE_URL}${path}` : path);
const lineOn = (env: Env) => (name: string, what: string, path: string) => `${name}: ${what} Link: ${linkOn(env, path)}`;
const quiet = () => {};
const noCitations = () => null;

/** The KJV text of a reference, as Ask reads it (agent.ts read_scripture). */
async function readPassage(env: Env, reference: string, ctx?: Exec): Promise<Answer> {
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
async function searchClasses(env: Env, query: string, feed: string, page: number): Promise<Answer> {
  const r = await searchTeachings(env, query, feed, page);
  if (!r.ok) return failure("The class search is not answering just now. Try again in a moment.");
  if (!r.hits.length) return answer(`No class matches “${query}”. Try other words, or a scripture with verse_study.`);
  const unmark = (s: string) => s.replace(/[]/g, "");
  const out = r.hits.map((h) => {
    const at = Math.max(0, Math.floor(h.start || 0));
    const when = `${Math.floor(at / 3600)}:${String(Math.floor((at % 3600) / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
    const kind = (FEED_LABEL as Record<string, string>)[h.feed] ?? h.feed;
    return `${unmark(h.title)} (${kind}${h.date ? `, ${h.date}` : ""}) at ${when}\n“${unmark(h.excerpt)}”\nVideo: https://www.youtube.com/watch?v=${h.video}&t=${at}s${h.note ? `\nNotes: ${linkOn(env, h.note)}` : ""}`;
  });
  return answer(`${out.join("\n\n")}${r.more ? `\n\nMore classes match: call again with page ${page + 1}.` : ""}`);
}

/** One of Ask's lookups (ask-tools.ts), with nothing streamed and no citation numbers. */
const lookup = (env: Env, ctx: Exec | undefined, tool: keyof typeof MORE_RUN, input: Record<string, unknown>) =>
  MORE_RUN[tool](env, input, ctx, quiet, lineOn(env), noCitations).then((r) => (r.error ? failure(r.content) : answer(r.content)));


/** Site paths and data files a reader can already open; nothing else is read. */
const SITE_PATH = /^\/[a-z0-9][a-z0-9/_-]*$/i;
const DATA_PATH = /^(?:api|search)\/[a-z0-9][a-z0-9/_.-]*\.json$/i;
const RESOURCE_PATH = /^v1\/[a-z0-9-]+\/[A-Za-z0-9/_.,:-]*(?:\?[A-Za-z0-9_.,:%&=+ -]*)?$/;
const PART = 40_000;
const noDots = (p: string) => !p.split(/[/?]/).some((seg) => seg === ".." || seg === ".");

/** A long text in parts, so one answer never floods the assistant. */
function part(text: string, offset: number): string {
  if (offset >= text.length) return offset ? "Nothing more: that was the end." : text;
  const end = Math.min(text.length, offset + PART);
  return `${text.slice(offset, end)}${end < text.length ? `\n\n[Part ${Math.floor(offset / PART) + 1}: characters ${offset} to ${end} of ${text.length}. Call again with offset ${end} to read on.]` : ""}`;
}

async function searchLibrary(env: Env, resource: (typeof RESEARCH_RESOURCES)[number], query: string, ctx?: Exec): Promise<Answer> {
  const research = createAppResearch(env, [], quiet, ctx);
  await research.search([{ resource, query }]);
  if (research.unavailable.length) return failure(`${resource.replaceAll("-", " ")} could not be read just now. Try again in a moment.`);
  if (!research.sources.length) return answer(`Nothing in ${resource.replaceAll("-", " ")} for “${query}”. Try other words.`);
  return answer(research.sources.map((s) => {
    const at = s.video ? `\nVideo: https://www.youtube.com/watch?v=${s.video}${s.t ? `&t=${Math.floor(s.t)}s` : ""}` : "";
    return `${s.title}${s.sub ? ` · ${s.sub}` : ""}${s.date ? ` (${s.date})` : ""}\n${s.text}\nLink: ${linkOn(env, s.url)}${at}`;
  }).join("\n\n"));
}

async function readNote(env: Env, path: string, offset: number, ctx?: Exec): Promise<Answer> {
  if (!noDots(path)) return failure("Give a site path like /classes/2026/<slug>.");
  const note = await dataJson<Record<string, unknown>>(env, `/api/notes${path.replace(/\/$/, "")}.json`, ctx);
  if (!note) return failure(`No note at ${path}. Find its path in read_data api/notes/index.json.`);
  const head = ["title", "teacher", "date", "range", "series"].map((k) => (typeof note[k] === "string" && note[k] ? `${k}: ${note[k]}` : "")).filter(Boolean).join("\n");
  const video = typeof note.videoId === "string" ? `\nVideo: https://www.youtube.com/watch?v=${note.videoId}` : "";
  return answer(part(`${head}${video}\nLink: ${linkOn(env, path)}\n\n${typeof note.body === "string" ? note.body : JSON.stringify(note)}`, offset));
}

async function readTranscript(env: Env, video: string, at: number, span: number, ctx?: Exec): Promise<Answer> {
  const w = await transcriptAround(env, video, at, ctx, span);
  if (!w.ok) return failure("No transcript for that video and moment.");
  const clock = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return answer(`${w.title}${w.date ? ` (${w.date})` : ""}\nVideo: https://www.youtube.com/watch?v=${video}&t=${Math.floor(at)}s${w.url ? `\nNotes: ${linkOn(env, w.url)}` : ""}\n\n${w.chunks.map((c) => `[${clock(c.t)}] ${c.text}`).join("\n")}`);
}

/** HTML as the text a reader sees: a real parser, so no markup survives into the answer. */
/** The app's public resource feed, asked in the Worker itself (bs/index.ts), GET only. */
async function feed(env: Env, path: string): Promise<{ status: number; text: string }> {
  const res = await bs.request(`https://mcp.internal/${path}`, { method: "GET" }, env);
  return { status: res.status, text: await res.text() };
}

async function readResource(env: Env, path: string, offset: number): Promise<Answer> {
  if (!noDots(path)) return failure("Give a path after /bs/ like v1/naves/en/topics?search=sabbath.");
  const r = await feed(env, path);
  if (r.status === 404 || r.status === 400) return failure(`Nothing at /bs/${path}.`);
  if (r.status !== 200) return failure("The resource feed is not answering just now. Try again in a moment.");
  return answer(part(r.text, offset));
}

async function readCommentary(env: Env, reference: string, ctx?: Exec): Promise<Answer> {
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
  return answer(part(`${ref.label} (commentary from the classes)\n\n${text}`, 0));
}

async function readData(env: Env, path: string, offset: number, ctx?: Exec): Promise<Answer> {
  if (!noDots(path)) return failure("Give a data path like api/cases/index.json.");
  const data = await dataJson<unknown>(env, `/${path}`, ctx);
  if (data == null) return failure(`No data file at ${path}. Start at api/index.json.`);
  return answer(part(JSON.stringify(data), offset));
}

export function createCyberJudahServer(env: Env, ctx?: Exec): McpServer {
  const server = new McpServer({ name: "cyberjudah", title: "CyberJudah", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, input: S, read: (args: z.infer<z.ZodObject<S>>) => Promise<Answer>) =>
    server.registerTool(name, { title, description, inputSchema: z.object(input), annotations: READ_ONLY }, (args: z.infer<z.ZodObject<S>>) => guarded(name, () => read(args)));

  const reference = z.string().trim().min(2).max(80).describe("Book and chapter, with an optional verse or range, like \"Deuteronomy 28:68\".");

  tool("read_passage", "Read a passage", "The exact King James text (1611, with the Apocrypha) of a chapter, a verse or a range. Quote Scripture only from what this returns.",
    { reference }, ({ reference }) => readPassage(env, reference, ctx));
  tool("verse_study", "What the classes taught on a verse", "Everything the app has on a verse or chapter: the classes and notes that read it (with the moment), the precepts placed on it, and its cross-references.",
    { reference }, ({ reference }) => lookup(env, ctx, "verse_study", { reference }));
  tool("search_classes", "Search the classes", "Find where the classes said something: each match gives the class, its date, the words spoken and a link to that moment of the video. Feed narrows it to Sabbath classes, 15 Min with Captains or Our Hidden History.",
    {
      query: z.string().trim().min(2).max(200).describe("Words or a phrase spoken in class."),
      feed: z.enum(["classes", "captains", "history"]).optional().describe("Only one series."),
      page: z.number().int().min(0).max(20).optional().describe("The next page of matches."),
    }, ({ query, feed, page }) => searchClasses(env, query, feed ?? "", page ?? 0));
  tool("person", "A person in the Bible", "A person's entry in the app's People: who they were, their family, their tribe, where they first appear. Give a name or a People id.",
    { name: z.string().trim().min(2).max(80) }, ({ name }) => lookup(env, ctx, "person", { name }));
  tool("timeline", "The Timeline", "Search the app's Timeline: the Bible's history and the captivities, through the Final Captivity to the twelve tribes today, each event with its dates, the classes' own words and their sources. Give a name, place, event or year.",
    { query: z.string().trim().min(1).max(120) }, ({ query }) => lookup(env, ctx, "timeline", { query }));
  tool("look_up_word", "Look up a word", "Easton's Bible Dictionary and Strong's (the Hebrew and Greek behind the KJV). Give an English word or name, or a Strong's number like H430 or G26.",
    { word: z.string().trim().min(1).max(60) }, ({ word }) => lookup(env, ctx, "look_up_word", { word }));
  tool("law", "The Law handbook", "The commandments, statutes and judgments by subject, each with its scriptures. Give a subject (\"sabbath\", \"clean meats\") or a section id like 2A.",
    { query: z.string().trim().min(1).max(120) }, ({ query }) => lookup(env, ctx, "law", { query }));
  tool("precepts", "Precepts on a subject", "The scriptures lined up precept upon precept on one subject, with their text.",
    { topic: z.string().trim().min(1).max(120) }, ({ topic }) => lookup(env, ctx, "precepts", { topic }));

  tool("search_library", "Search one part of the library", "Search one public resource of the app: transcripts (the teachers' recorded words with the moment), teachings (classes, captions, notes), people, encyclopedia, jewish-encyclopedia, study-notes, topics, law, precepts, cases, glossary, doctrines, timeline, strong, dictionary, nave, scripture, verse-study, commentary (one verse), class-notes (the class notes read in full), places, library (the books the classes read from) or cross-references (one verse).",
    { resource: z.enum(RESEARCH_RESOURCES), query: z.string().trim().min(2).max(120) }, ({ resource, query }) => searchLibrary(env, resource, query, ctx));
  tool("read_note", "Read a class or study note", "The whole note of a class, a study chapter or an episode, word for word: give its site path from an index or a link, like /classes/2026/<slug> or /study/genesis/2. Long notes come in parts: pass offset to read on.",
    { path: z.string().trim().regex(SITE_PATH).max(200), offset: z.number().int().min(0).optional() }, ({ path, offset }) => readNote(env, path, offset ?? 0, ctx));
  tool("read_transcript", "Read what was said in a class", "The verbatim transcript of a class or episode around a moment: give the YouTube video id and the second (from search_classes or a note). Span is how many seconds either side, up to 600.",
    { video: z.string().regex(/^[A-Za-z0-9_-]{11}$/), at: z.number().min(0).max(86400), span: z.number().int().min(30).max(600).optional() }, ({ video, at, span }) => readTranscript(env, video, at, span ?? 180, ctx));
  tool("commentary", "The Bishops' commentary on a verse", "What CyberJudah's commentary holds for one verse: the class breakdowns on it, each with its teacher and the moment. Give a single verse, like \"Deuteronomy 28:68\".",
    { reference }, ({ reference }) => readCommentary(env, reference, ctx));
  tool("read_data", "Read any public data file", "Read any file of the public data site as JSON: start at api/index.json (every file) or api/notes/index.json (every note). For example api/cases/index.json, api/cases/<slug>.json, api/doctrine/<slug>.json, api/places/<id>.json, api/history/<slug>.json (an episode with its verbatim transcript), api/topics/<slug>.json, api/encyclopedia/index.json, api/library/index.json, api/concordance/<book>/<chapter>.json. Long files come in parts: pass offset to read on.",
    { path: z.string().trim().regex(DATA_PATH).max(200), offset: z.number().int().min(0).optional() }, ({ path, offset }) => readData(env, path, offset ?? 0, ctx));
  tool("read_resource", "Read the study resource feed", "Read the app's public study resource feed (the one its Bible Strong screens use) as JSON, by its path after /bs/: v1/commentaries/cyberjudah/en/verses/<book>-<chapter>-<verse>, v1/strong-lexicon/entries/<H430>, v1/dictionaries/directory?language=en&search=<word>, v1/naves/en/topics?search=<word>, v1/timelines/en/events, v1/cross-references/en/verses/<key>. Book numbers run 1 (Genesis) to 81 in the 1611 order.",
    { path: z.string().trim().regex(RESOURCE_PATH).max(240), offset: z.number().int().min(0).optional() }, ({ path, offset }) => readResource(env, path, offset ?? 0));

  return server;
}

const encoder = new TextEncoder();
/** The key compared in constant time, through a digest so the lengths match. */
async function keyMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(a, b);
}

const plain = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/** The /mcp route: off without MCP_KEY, then the key, a rate limit, and the stateless handler. */
export async function mcp(request: Request, env: Env, ctx?: Exec): Promise<Response> {
  if (!env.MCP_KEY) return plain("Not found", 404);
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!given || !(await keyMatches(given, env.MCP_KEY))) return plain("Unauthorized", 401, { "www-authenticate": 'Bearer realm="cyberjudah-mcp"' });
  if (env.MCP_LIMIT) {
    const { success } = await env.MCP_LIMIT.limit({ key: "owner" });
    if (!success) return plain("Too many requests. Try again in a minute.", 429, { "retry-after": "60" });
  }
  // One server per request, from the same definition: nothing is kept between requests.
  const handler: McpHttpHandler = createMcpHandler(() => createCyberJudahServer(env, ctx), {
    // Tools answer at once: one JSON body, never a stream to keep open (as Bible Strong's does).
    responseMode: "json",
    onerror: (error) => console.error(JSON.stringify({ message: "mcp error", error: error.message })),
  });
  return handler.fetch(request);
}
