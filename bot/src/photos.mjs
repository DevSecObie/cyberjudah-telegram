/**
 * The photos an admin sets from the app (bot/src/photos.ts): what a slot may be, what an
 * uploaded file may be, and where it is kept. Pure, so the bot's tests check it directly.
 *
 *   leader:<id>   an Israel United in Christ leader's portrait (square)
 *   period:<id>   a Timeline period's cover (4:5)
 *   event:<slug>  one Timeline event's picture (square)
 */
export const SLOT = /^(leader|period|event):[a-z0-9][a-z0-9-]{0,79}$/;
/** An object the Worker wrote: photos/<kind>/<id>/<time>.<ext>. Nothing else is served. */
export const OBJECT_KEY = /^photos\/(leader|period|event)\/[a-z0-9][a-z0-9-]{0,79}\/\d{13}\.(jpg|png|webp)$/;
/** Large enough for a 1280px photo at good quality; the app sends 512px or 640×800. */
export const MAX_BYTES = 2_500_000;

/** The file's type from its first bytes, never from what the request claims. */
export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { type: "image/png", ext: "png" };
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

/** Where a slot's photo is kept, uploaded at `now`. */
export const objectKey = (slot, ext, now = Date.now()) => `photos/${slot.replace(":", "/")}/${String(now).padStart(13, "0")}.${ext}`;

/** The manifest the app reads: slot → the URL its photo is served from. */
export const publicManifest = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([slot, e]) => SLOT.test(slot) && OBJECT_KEY.test(e?.key ?? "")).map(([slot, e]) => [slot, `/api/photos/file/${e.key}`]));
