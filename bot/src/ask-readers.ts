import type Anthropic from "@anthropic-ai/sdk";
import type { Env, Exec } from "./env";
import { readNote, readTranscript, searchClasses, readCommentary, readData, type Reading } from "./public-reading";

export const DEEP_TOOLS: Anthropic.Tool[] = [
  { name: "search_classes", description: "Find the actual class recordings that discuss a subject, with their dates, verbatim excerpts, video moments and note paths. Open the relevant results with read_note and read_transcript; page through more results when needed.", input_schema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 200 }, feed: { type: "string", enum: ["classes", "captains", "history"] }, page: { type: "integer", minimum: 0, maximum: 20 } }, required: ["query"] } },
  { name: "read_note", description: "Read a whole published class or study note word for word from its site path, including the recorded teacher, date and video. Long notes come in 40,000-character parts; continue at the returned offset until you have read what the question needs.", input_schema: { type: "object", properties: { path: { type: "string", pattern: "^/[a-zA-Z0-9][a-zA-Z0-9/_-]*$", maxLength: 200 }, offset: { type: "integer", minimum: 0 } }, required: ["path"] } },
  { name: "read_transcript", description: "Read the verbatim class captions around a video moment found by a tool. Span gives seconds on either side, up to 600. Read adjacent windows to follow the complete class, rather than relying on a search snippet. Recorded caption corrections are listed separately, without rewriting the captions.", input_schema: { type: "object", properties: { video: { type: "string", pattern: "^[A-Za-z0-9_-]{11}$" }, at: { type: "number", minimum: 0, maximum: 86400 }, span: { type: "integer", minimum: 30, maximum: 600 } }, required: ["video", "at"] } },
  { name: "commentary", description: "Read the published class commentary for one Bible verse, with its existing breakdowns, teachers and moments. Read the exact verse separately with read_scripture.", input_schema: { type: "object", properties: { reference: { type: "string", minLength: 2, maxLength: 80 } }, required: ["reference"] } },
  { name: "read_data", description: "Read a public CyberJudah JSON data file, including indexes that lead to every note, book, person, place, timeline entry, case and encyclopedia article. Start at api/index.json or api/notes/index.json. Continue long files with the returned offset; only public api/ or search/ JSON paths are accepted.", input_schema: { type: "object", properties: { path: { type: "string", pattern: "^(api|search)/[a-zA-Z0-9][a-zA-Z0-9/_.-]*\\.json$", maxLength: 200 }, offset: { type: "integer", minimum: 0 } }, required: ["path"] } },
];

export async function readForAsk(name: string, input: Record<string, unknown>, env: Env, ctx?: Exec): Promise<Reading | null> {
  switch (name) {
    case "search_classes": return searchClasses(env, String(input.query ?? "").trim(), String(input.feed ?? ""), Number(input.page ?? 0));
    case "read_note": return readNote(env, String(input.path ?? ""), Number(input.offset ?? 0), ctx);
    case "read_transcript": return readTranscript(env, String(input.video ?? ""), Number(input.at), Number(input.span ?? 180), ctx);
    case "commentary": return readCommentary(env, String(input.reference ?? ""), ctx);
    case "read_data": return readData(env, String(input.path ?? ""), Number(input.offset ?? 0), ctx);
    default: return null;
  }
}
