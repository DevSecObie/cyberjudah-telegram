import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Env, Exec } from "./env";
import { RESEARCH_RESOURCES } from "./app-study-research";
import { accessTokenValid, challenge } from "./mcp-oauth";
import { findTeaching } from "./mcp-research";
import { readPassage, searchClasses, lookup, searchLibrary, readNote, readResource, readData, readTranscriptRange, lintTranscriptReading, readCommentaryMcp, MCP_PART, SITE_PATH, DATA_PATH, RESOURCE_PATH } from "./public-reading";

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
 * - Private by default: it answers only a request carrying the owner's key (MCP_KEY, a Worker
 *   secret the owner sets), or a token from the owner's sign-in (mcp-oauth.ts). Without that
 *   secret it answers nothing at all. MCP_PUBLIC=1 (the owner's switch) also lets anyone read
 *   without a key, rate limited per address.
 * - Answers are short by default (about 3,000 tokens) and long readings come in parts, as the
 *   published guidance on tools for agents advises: find_teaching first, then read in full.
 */

export const INSTRUCTIONS =
  "CyberJudah reads the King James Bible (1611, with the Apocrypha) and what the IUIC classes " +
  "taught on it: every class's transcript (with or without written notes), the class and study " +
  "notes, the commentary on each verse, the precepts, the People, the Timeline, the Law handbook " +
  "and Strong's. Never quote Scripture or a class from memory: read it with a tool, then cite the " +
  "reference and the class with its link. Keep the classes' own words; do not soften or reword them. " +
  "The Bishops' and Deacons' teaching comes first. Give each link a tool returns with what it " +
  "supports; never build one yourself.\n\n" +
  "How to research a question: (1) find_teaching with the question in plain words: it searches " +
  "every transcript and note by meaning and by keyword. (2) For a scripture, verse_study (every " +
  "class that read it, the precepts placed on it, cross-references) and commentary. (3) Read the " +
  "best moments in full with read_transcript (video and second from any result) or read_note; a " +
  "transcript is the class's own words and is evidence even when no notes were written. (4) Use " +
  "lint_transcript before quoting an old or unpunctuated recording: it says how far its captions " +
  "can be trusted. Answers are short by default; long readings come in parts (offset or from), " +
  "and max_chars sets the size of a part.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

type Answer = { content: { type: "text"; text: string }[]; isError?: true };
const failure = (text: string): Answer => ({ isError: true, content: [{ type: "text", text }] });

/** A reading that fails tells the model something it can act on, never a trace. */
const guarded = (name: string, read: () => Promise<Answer>) => read().catch((cause: unknown) => {
  console.error(JSON.stringify({ message: "mcp tool failure", tool: name, error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) }));
  return failure("CyberJudah could not answer this just now. Try again in a moment.");
});

export function createCyberJudahServer(env: Env, ctx?: Exec): McpServer {
  const server = new McpServer({ name: "cyberjudah", title: "CyberJudah", version: "2.0.0" }, { instructions: INSTRUCTIONS });
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, input: S, read: (args: z.infer<z.ZodObject<S>>) => Promise<Answer>) =>
    server.registerTool(name, { title, description, inputSchema: z.object(input), annotations: READ_ONLY }, (args: z.infer<z.ZodObject<S>>) => guarded(name, async () => { const r = await read(args); return { content: r.content, ...(r.isError ? { isError: true as const } : {}) }; }));

  const reference = z.string().trim().min(2).max(80).describe("Book and chapter, with an optional verse or range, like \"Deuteronomy 28:68\" or \"2 Esdras 13\".");
  const offset = z.number().int().min(0).optional().describe("Where to read on from, as the last part said.");
  const maxChars = z.number().int().min(2000).max(40000).optional().describe("The most characters in one part (default 12000, about 3,000 tokens).");
  const video = z.string().regex(/^[A-Za-z0-9_-]{11}$/).describe("The 11-character YouTube video id, from any result's video link.");
  const opts = (m?: number) => ({ maxChars: m ?? MCP_PART });

  tool("find_teaching", "Find where the classes taught on a question", "Start here for any question. Searches the whole library by meaning and by keyword together, reranked by whether a passage answers the question: every class transcript (Sabbath classes, 15 Min w/ Captains, Our Hidden History, with or without written notes), the class and study notes, the law, the cases and the verses. Each result gives its kind, teacher, date, the passage, its link and, for a transcript, the video and second to read on from with read_transcript. Example: {\"question\": \"who are the twelve tribes today\"}.",
    { question: z.string().trim().min(3).max(300).describe("The question or subject, in plain words."), limit: z.number().int().min(1).max(20).optional().describe("How many passages (default 8).") },
    ({ question, limit }) => findTeaching(env, question, limit ?? 8, ctx));
  tool("read_passage", "Read a passage", "The exact King James text (1611, with the Apocrypha) of a chapter, a verse or a range. Quote Scripture only from what this returns. Books are named as in the 1611 Bible (\"1 Maccabees\", \"Wisdom of Solomon\"); common short forms work (\"Jn 3:16\").",
    { reference }, ({ reference }) => readPassage(env, reference, ctx));
  tool("verse_study", "What the classes taught on a verse", "Everything the app has on a verse or chapter, in three parts. STUDY NOTE: the 4 Chapters a Day note's points on the verse, each with its source or marked unsourced, and the precepts the note places on it. CLASSES: every recording found reading the verse aloud (Sabbath classes, 15 Min w/ Captains, Our Hidden History), every class note passage that holds it, every precept placed on it, and notes that mention it; each hit gives why it matched, the words said, a link to that second of the video, the teacher, the date and its notes link; with no written notes, the notes line links the video, since the transcript is the record. 25 classes a page; pass page to read on. CROSS-REFERENCES for a verse. The verse's own text comes from read_passage.",
    { reference, page: z.number().int().min(0).max(40).optional().describe("The next page of classes (0 is the first).") }, ({ reference, page }) => lookup(env, ctx, "verse_study", { reference, page: page ?? 0 }));
  tool("search_classes", "Search the classes' words", "Find where the classes said a word or phrase (keyword search of every transcript): each match gives the class, its date (or \"date unknown\"), the words spoken, a link to that moment of the video, and its notes link; with no written notes, the notes line links the video, since the transcript is the record. Use quotes for an exact phrase. For a question in plain words, find_teaching searches by meaning too. Feed narrows it to Sabbath classes, 15 Min w/ Captains or Our Hidden History.",
    {
      query: z.string().trim().min(2).max(200).describe("Words or a phrase spoken in class."),
      feed: z.enum(["classes", "captains", "history"]).optional().describe("Only one series."),
      page: z.number().int().min(0).max(20).optional().describe("The next page of matches."),
    }, ({ query, feed, page }) => searchClasses(env, query, feed ?? "", page ?? 0));
  tool("read_transcript", "Read what was said in a class", "A class's transcript (YouTube's captions), read as the class's own words. Give the video and either at (a second, read span seconds either side, default 180), or from and to (seconds), or neither to read from the start; long readings come in parts by time, and the answer says where to read on. format \"clean\" (the default) gives paragraphs, one per turn of speaker (marked »), with known mishearings corrected and listed (\"second edges\" is 2 Esdras), and cue tags, fillers and stutters removed; \"verbatim\" gives every caption as YouTube gave it, with its second. Quote from either; say which.",
    {
      video,
      at: z.number().min(0).max(86400).optional().describe("A moment, in seconds, from a search result."),
      span: z.number().int().min(30).max(900).optional().describe("Seconds either side of at (default 180)."),
      from: z.number().min(0).max(86400).optional().describe("Read from this second."),
      to: z.number().min(0).max(86400).optional().describe("Read to this second."),
      format: z.enum(["clean", "verbatim"]).optional(),
      max_chars: maxChars,
    }, ({ video, at, span, from, to, format, max_chars }) => readTranscriptRange(env, { video, at, span, from, to, format: format ?? "clean", maxChars: max_chars }, ctx));
  tool("lint_transcript", "Check a transcript's quality", "A report on how far a recording's captions can be trusted before quoting them: coverage and gaps, whether they carry punctuation (older auto-captions do not), turns of speaker, cue tags and fillers, the known mishearings with their corrections, and places where the word before \"chapter N\" is not a book of the 1611 Bible (likely mishearings to check against the video). Grade A reads cleanly; D means check every quote against the video.",
    { video }, ({ video }) => lintTranscriptReading(env, video, ctx));
  tool("commentary", "The classes' commentary on a verse", "The class breakdowns on one verse, each with its class, date, teacher and moment. format \"concise\" (the default) lists every breakdown with its first lines and links, so you can pick; \"detailed\" reads them in full, in parts. Give a single verse, like \"Deuteronomy 28:68\".",
    { reference, format: z.enum(["concise", "detailed"]).optional(), offset, max_chars: maxChars },
    ({ reference, format, offset, max_chars }) => readCommentaryMcp(env, reference, format ?? "concise", offset ?? 0, ctx, opts(max_chars)));
  tool("person", "A person in the Bible", "A person's entry in the app's People: who they were, their family, their tribe, where they first appear. Give a name or a People id; when several share a name, the answer lists them with their ids.",
    { name: z.string().trim().min(2).max(80) }, ({ name }) => lookup(env, ctx, "person", { name }));
  tool("timeline", "The Timeline", "Search the app's Timeline: the Bible's history and the captivities, through the Final Captivity to the twelve tribes today, each event with its dates, the classes' own words and their sources. Give a name, place, event or year (\"586 BC\").",
    { query: z.string().trim().min(1).max(120) }, ({ query }) => lookup(env, ctx, "timeline", { query }));
  tool("look_up_word", "Look up a word", "Easton's Bible Dictionary and Strong's (the Hebrew and Greek behind the KJV). Give an English word or name, or a Strong's number like H430 or G26.",
    { word: z.string().trim().min(1).max(60) }, ({ word }) => lookup(env, ctx, "look_up_word", { word }));
  tool("law", "The Law handbook", "The commandments, statutes and judgments by subject, each with its scriptures. Give a subject (\"sabbath\", \"clean meats\") or a section id like 9C.",
    { query: z.string().trim().min(1).max(120) }, ({ query }) => lookup(env, ctx, "law", { query }));
  tool("precepts", "Precepts on a subject", "The scriptures lined up precept upon precept on one subject, with their text. The answer says when the closest topic does not match every word, and names other topics that may fit.",
    { topic: z.string().trim().min(1).max(120) }, ({ topic }) => lookup(env, ctx, "precepts", { topic }));
  tool("search_library", "Search one part of the library", "Search one public resource of the app: transcripts (the teachers' recorded words with the moment), teachings (classes, captions, notes), people, encyclopedia, jewish-encyclopedia, study-notes, topics, law, precepts, cases, glossary, doctrines, timeline, strong, dictionary, nave, scripture, verse-study, commentary (one verse), class-notes (the class notes read in full), places, library (the books the classes read from) or cross-references (one verse).",
    { resource: z.enum(RESEARCH_RESOURCES), query: z.string().trim().min(2).max(120) }, ({ resource, query }) => searchLibrary(env, resource, query, ctx));
  tool("read_note", "Read a class or study note", "The whole note of a class, a study chapter or an episode, word for word, as Markdown: give its site path from an index or a link, like /classes/2026/<slug> or /study/genesis/2. Long notes come in parts: pass offset to read on.",
    { path: z.string().trim().regex(SITE_PATH).max(200), offset, max_chars: maxChars }, ({ path, offset, max_chars }) => readNote(env, path, offset ?? 0, ctx, opts(max_chars)));
  tool("read_data", "Read any public data file", "Read any file of the public data site as JSON: start at api/index.json (every file) or api/notes/index.json (every note). For example api/cases/index.json, api/cases/<slug>.json, api/doctrine/<slug>.json, api/places/<id>.json, api/history/<slug>.json, api/topics/<slug>.json, api/encyclopedia/index.json, api/library/index.json, api/concordance/<book>/<chapter>.json. Long files come in parts: pass offset to read on.",
    { path: z.string().trim().regex(DATA_PATH).max(200), offset, max_chars: maxChars }, ({ path, offset, max_chars }) => readData(env, path, offset ?? 0, ctx, opts(max_chars)));
  tool("read_resource", "Read the study resource feed", "Read the app's public study resource feed (the one its Bible Strong screens use) as JSON, by its path after /bs/: v1/commentaries/cyberjudah/en/verses/<book>-<chapter>-<verse>, v1/strong-lexicon/entries/H430, v1/strong-lexicon/entries?search=<word>, v1/dictionaries/directory?search=<word>, v1/naves/en/topics?search=<word>, v1/timelines/en/events, v1/cross-references/en/verses/<book>-<chapter>-<verse>. Book numbers run 1 (Genesis) to 81 in the 1611 order. The language is added when missing.",
    { path: z.string().trim().regex(RESOURCE_PATH).max(240), offset, max_chars: maxChars }, ({ path, offset, max_chars }) => readResource(env, path, offset ?? 0, opts(max_chars)));

  // Prompts: the research workflows, ready for a host's prompt menu.
  server.registerPrompt("study_verse", { title: "Study a verse", description: "Everything the classes taught on one scripture, cited.", argsSchema: z.object({ reference: z.string().describe("Like \"Deuteronomy 28:68\"") }) },
    ({ reference }) => ({ messages: [{ role: "user", content: { type: "text", text: `Study ${reference} with the CyberJudah tools. Read it with read_passage. Run verse_study and commentary, then read the two or three strongest moments in full with read_transcript or read_note. Answer with the scripture, what the Bishops and Deacons taught on it (their own words, quoted, with the class, date and link), the precepts placed on it and its cross-references.` } }] }));
  server.registerPrompt("research_question", { title: "Research a question", description: "Answer a question from the classes' own words, cited.", argsSchema: z.object({ question: z.string() }) },
    ({ question }) => ({ messages: [{ role: "user", content: { type: "text", text: `Research this with the CyberJudah tools: ${question}\nStart with find_teaching. Read the best transcripts and notes in full (read_transcript, read_note), check each scripture with read_passage and verse_study, and use person, timeline, law and precepts where they fit. Quote the classes' own words with the class, date, teacher and link. Say plainly where the classes have not taught on something.` } }] }));
  server.registerPrompt("check_transcript", { title: "Check a transcript", description: "How far a recording's captions can be trusted, and its clean text.", argsSchema: z.object({ video: z.string().describe("The YouTube video id") }) },
    ({ video }) => ({ messages: [{ role: "user", content: { type: "text", text: `Run lint_transcript on ${video}, then read its start with read_transcript (clean). List what to check against the video before quoting it.` } }] }));

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

/** Who is calling, for the rate limit: the owner, a signed-in token, or an address (hashed). */
async function callerKey(request: Request, given: string, owner: boolean): Promise<string> {
  if (owner) return "owner";
  const of = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (given) return `token:${await of(given)}`;
  return `ip:${await of(request.headers.get("cf-connecting-ip") ?? "unknown")}`;
}

/**
 * The /mcp route: off without MCP_KEY; then the owner's key, a signed-in token, or (only with
 * MCP_PUBLIC=1) no key at all; a rate limit per caller; and the stateless handler.
 */
export async function mcp(request: Request, env: Env, ctx?: Exec): Promise<Response> {
  if (!env.MCP_KEY) return plain("Not found", 404);
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  const origin = new URL(request.url).origin;
  const owner = !!given && (await keyMatches(given, env.MCP_KEY));
  const signedIn = !owner && !!given && (await accessTokenValid(env, given, origin));
  // A key that is given must be right, public or not: a wrong one is never read as anonymous.
  const allowed = owner || signedIn || (!given && env.MCP_PUBLIC === "1");
  if (!allowed) return plain("Unauthorized", 401, { "www-authenticate": challenge(origin) });
  if (env.MCP_LIMIT) {
    const { success } = await env.MCP_LIMIT.limit({ key: await callerKey(request, given, owner) });
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
