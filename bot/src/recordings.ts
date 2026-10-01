import { Hono } from "hono";
import type { Env } from "./env";

export type RecordingChapter = { readerId: string; reader: string; slug: string; chapter: number; index: string; audio: string; source: string; license: string; sha256: string; bytes: number };
type Catalog = { schemaVersion: number; chapters: RecordingChapter[] };
export const recordings = new Hono<{ Bindings: Env }>();

async function catalog(env: Env): Promise<Catalog> {
  const object = await env.AUDIO.get("recordings/catalog.json");
  return object ? object.json<Catalog>() : { schemaVersion: 1, chapters: [] };
}
recordings.get("/catalog", async (c) => c.json(await catalog(c.env), 200, { "cache-control": "public, max-age=300" }));
recordings.get("/:slug/:chapter", async (c) => {
  const slug = c.req.param("slug"), chapter = Number(c.req.param("chapter"));
  if (!/^[a-z0-9-]{2,40}$/.test(slug) || !Number.isInteger(chapter) || chapter < 1 || chapter > 200) return c.json({ error: "bad-reference" }, 400);
  const choices = (await catalog(c.env)).chapters.filter((r) => r.slug === slug && r.chapter === chapter);
  const narrators = await Promise.all(choices.map(async (r) => {
    const index = await c.env.AUDIO.get(`recordings/index/${r.index}`);
    if (!index) return null;
    const body = await index.json<{ verses: [number, number, number][] }>();
    return { id: r.readerId, reader: r.reader, audio: `/api/audio/${r.audio}?v=${r.sha256}`, verses: body.verses, source: r.source, license: r.license };
  }));
  return c.json({ narrators: narrators.filter(Boolean) }, 200, { "cache-control": "public, max-age=300" });
});

/** R2 stays private. Only approved recording keys are readable; AI caches are excluded. */
export async function recordingAudio(request: Request, env: Pick<Env, "AUDIO">): Promise<Response> {
  const key = new URL(request.url).pathname.slice("/api/audio/".length);
  if (!/^recordings\/[a-z0-9-]+\/[a-z0-9-]+\/[1-9][0-9]{0,2}\.m4a$/.test(key)) return new Response(null, { status: 404 });
  const meta = await env.AUDIO.head(key);
  if (!meta) return new Response(null, { status: 404 });
  const headers = new Headers({ "content-type": "audio/mp4", "accept-ranges": "bytes", "etag": meta.httpEtag,
    "cache-control": "public, max-age=31536000", "x-content-type-options": "nosniff", "content-length": String(meta.size) });
  if (request.headers.get("if-none-match") === meta.httpEtag) return new Response(null, { status: 304, headers });
  let offset = 0, length = meta.size, status = 200;
  const range = request.headers.get("range");
  if (range && (!request.headers.has("if-range") || request.headers.get("if-range") === meta.httpEtag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "content-range": `bytes */${meta.size}` } });
    if (match[1]) {
      offset = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), meta.size - 1) : meta.size - 1;
      length = end - offset + 1;
    } else {
      length = Math.min(Number(match[2]), meta.size); offset = meta.size - length;
    }
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset >= meta.size || length <= 0) return new Response(null, { status: 416, headers: { "content-range": `bytes */${meta.size}` } });
    status = 206; headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${meta.size}`); headers.set("content-length", String(length));
  }
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const object = await env.AUDIO.get(key, status === 206 ? { range: { offset, length } } : undefined);
  return object ? new Response(object.body, { status, headers }) : new Response(null, { status: 404 });
}
