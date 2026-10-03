import type { Env } from "./env";
import { isAdmin } from "./edit";
import { MAX_BYTES, OBJECT_KEY, objectKey, publicManifest, sniff, SLOT, type PhotoEntry } from "./photos.mjs";

/**
 * Photos an admin sets from the app: a leader's portrait, a Timeline period's cover, an event's
 * picture. The file goes to R2 (the AUDIO bucket, under photos/), and a small manifest in KV
 * names the photo each slot shows. Readers fetch the manifest and the files without signing in,
 * like any other picture in the app; only an admin (ADMIN_IDS) may set or remove one. The file's
 * type is read from its bytes, its size is bounded, and only keys this Worker wrote are served.
 */
const MANIFEST = "photos:manifest";

async function readManifest(env: Env): Promise<Record<string, PhotoEntry>> {
  return ((await env.SUBS.get(MANIFEST, "json")) as Record<string, PhotoEntry> | null) ?? {};
}

/** Slot → URL, for the app. */
export async function photoManifest(env: Env) {
  return publicManifest(await readManifest(env));
}

/** A photo file, cached for good (a new upload is a new key). */
export async function photoFile(env: Env, key: string): Promise<Response> {
  if (!OBJECT_KEY.test(key)) return new Response("not found", { status: 404 });
  const obj = await env.AUDIO.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}

type Result = { ok: true; url?: string } | { ok: false; status: 400 | 403 | 413 | 415; error: string };

/** An admin sets a slot's photo from the request body (the image itself). */
export async function setPhoto(env: Env, user: { id: number; username?: string; first_name?: string }, slot: string, body: ArrayBuffer): Promise<Result> {
  if (!isAdmin(env, user.id)) return { ok: false, status: 403, error: "Only an admin can change photos." };
  if (!SLOT.test(slot)) return { ok: false, status: 400, error: "That is not a photo the app shows." };
  if (body.byteLength > MAX_BYTES) return { ok: false, status: 413, error: "That photo is too large." };
  const bytes = new Uint8Array(body);
  const kind = sniff(bytes);
  if (!kind) return { ok: false, status: 415, error: "Choose a JPEG, PNG or WebP photo." };
  const key = objectKey(slot, kind.ext);
  await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  const m = await readManifest(env);
  const old = m[slot]?.key;
  m[slot] = { key, at: new Date().toISOString(), by: user.username ? `@${user.username}` : (user.first_name ?? String(user.id)) };
  await env.SUBS.put(MANIFEST, JSON.stringify(m));
  if (old && old !== key && OBJECT_KEY.test(old)) await env.AUDIO.delete(old).catch(() => null);
  return { ok: true, url: `/api/photos/file/${key}` };
}

/** An admin removes a slot's photo: the app shows its own again. */
export async function removePhoto(env: Env, user: { id: number }, slot: string): Promise<Result> {
  if (!isAdmin(env, user.id)) return { ok: false, status: 403, error: "Only an admin can change photos." };
  if (!SLOT.test(slot)) return { ok: false, status: 400, error: "That is not a photo the app shows." };
  const m = await readManifest(env);
  const old = m[slot]?.key;
  if (!old) return { ok: true };
  delete m[slot];
  await env.SUBS.put(MANIFEST, JSON.stringify(m));
  if (OBJECT_KEY.test(old)) await env.AUDIO.delete(old).catch(() => null);
  return { ok: true };
}
