import type { Env } from "./env";
import { imageKey } from "./images.mjs";

/**
 * A picture of the app's from R2 (bot/src/images.mjs names the ones served). Public like the
 * app's own files; cached for a week, revalidated by ETag, since a corrected portrait keeps its key.
 */
export async function imageFile(env: Env, path: string, ifNoneMatch?: string): Promise<Response> {
  const key = imageKey(path);
  if (!key) return new Response("not found", { status: 404 });
  const obj = await env.AUDIO.get(key, ifNoneMatch ? { onlyIf: { etagDoesNotMatch: ifNoneMatch.replace(/^W\//, "").replace(/"/g, "") } } : undefined);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = { etag: obj.httpEtag, "cache-control": "public, max-age=604800, stale-while-revalidate=86400", "x-content-type-options": "nosniff" };
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers: { ...headers, "content-type": "image/webp" } });
}
