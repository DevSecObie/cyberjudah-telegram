import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Env, Exec } from "./env";
import { RESEARCH_RESOURCES } from "./app-study-research";
import { accessTokenValid, challenge } from "./mcp-oauth";
import { readPassage, searchClasses, lookup, searchLibrary, readNote, readTranscript, readResource, readCommentary, readData, SITE_PATH, DATA_PATH, RESOURCE_PATH } from "./public-reading";

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
 *   Worker secret the owner sets), or a token from the owner's sign-in (mcp-oauth.ts). Without
 *   that secret it answers nothing at all.
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
const failure = (text: string): Answer => ({ isError: true, content: [{ type: "text", text }] });

/** A reading that fails tells the model something it can act on, never a trace. */
const guarded = (name: string, read: () => Promise<Answer>) => read().catch((cause: unknown) => {
  console.error(JSON.stringify({ message: "mcp tool failure", tool: name, error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause) }));
  return failure("CyberJudah could not answer this just now. Try again in a moment.");
});


export function createCyberJudahServer(env: Env, ctx?: Exec): McpServer {
  const server = new McpServer({ name: "cyberjudah", title: "CyberJudah", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, input: S, read: (args: z.infer<z.ZodObject<S>>) => Promise<Answer>) =>
    server.registerTool(name, { title, description, inputSchema: z.object(input), annotations: READ_ONLY }, (args: z.infer<z.ZodObject<S>>) => guarded(name, async () => { const r = await read(args); return { content: r.content, ...(r.isError ? { isError: true as const } : {}) }; }));

  const reference = z.string().trim().min(2).max(80).describe("Book and chapter, with an optional verse or range, like \"Deuteronomy 28:68\".");

  tool("read_passage", "Read a passage", "The exact King James text (1611, with the Apocrypha) of a chapter, a verse or a range. Quote Scripture only from what this returns.",
    { reference }, ({ reference }) => readPassage(env, reference, ctx));
  tool("verse_study", "What the classes taught on a verse", "Everything the app has on a verse or chapter, in three parts. STUDY NOTE: the 4 Chapters a Day note's points on the verse, each with its source (the class, date, teacher and moment it was found in) or marked unsourced, and the precepts the note places on it. CLASSES: every recording found reading the verse aloud (Sabbath classes, 15 Min w/ Captains, Our Hidden History), every class note passage that holds it, every precept placed on it or citation of it as a precept, and notes that mention it; each hit gives why it matched, the words said there, a link to that second of the video, the teacher (or \"teacher unknown\"), the date (or \"date unknown\") and its notes link (or \"Notes: none yet\"). Readings of the verse come first, then Bishops, Deacons and Captains. CROSS-REFERENCES for a verse. The verse's own text comes from read_passage.",
    { reference }, ({ reference }) => lookup(env, ctx, "verse_study", { reference }));
  tool("search_classes", "Search the classes", "Find where the classes said something: each match gives the class, its date (or \"date unknown\"), the words spoken, a link to that moment of the video, and its notes link (or \"Notes: none yet\"). Feed narrows it to Sabbath classes, 15 Min with Captains or Our Hidden History.",
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
  tool("read_transcript", "Read what was said in a class", "The verbatim transcript (YouTube's captions) of a class or episode around a moment: give the YouTube video id and the second (from search_classes, verse_study or a note). Span is how many seconds either side, up to 600. Where the captions mishear a book or feast word (\"second edges\" for 2 Esdras, \"11 bread\" for unleavened bread), the correction is listed after the captions, which are left as given.",
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

/** The /mcp route: off without MCP_KEY, then the key or a signed-in token, a rate limit, and the stateless handler. */
export async function mcp(request: Request, env: Env, ctx?: Exec): Promise<Response> {
  if (!env.MCP_KEY) return plain("Not found", 404);
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  const origin = new URL(request.url).origin;
  const allowed = !!given && ((await keyMatches(given, env.MCP_KEY)) || (await accessTokenValid(env, given, origin)));
  if (!allowed) return plain("Unauthorized", 401, { "www-authenticate": challenge(origin) });
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
