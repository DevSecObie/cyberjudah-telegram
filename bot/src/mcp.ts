import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Env, Exec } from "./env";
import { MORE_RUN } from "./ask-tools";
import { books, chapter } from "./data";
import { parseReference } from "./refs.mjs";
import { searchTeachings } from "./teachings";
import { FEED_LABEL } from "./teachings.mjs";

/**
 * CyberJudah for AI assistants: an MCP server at /mcp, laid out after Bible Strong's
 * (packages/mcp-service in smontlouis/bible-strong, ADR-0085) and Cloudflare's stateless
 * remote MCP guide. One server is built for each request; nothing is kept between requests.
 *
 * - Every tool only reads, and only what the app already shows a reader. Nothing about a
 *   person (accounts, studies, chats, credits) and no outside web.
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
  "first. Give each link a tool returns with what it supports; never build one yourself.";

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
