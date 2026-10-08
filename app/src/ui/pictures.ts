import { apiURL } from "@/native/platform";
import type { SyntheticEvent } from "react";

/**
 * The app's pictures (People portraits, Timeline paintings) are served from R2 through the Worker
 * (/api/img/<path>, bot/src/images.ts). Until a picture is in the bucket, or where no Worker runs
 * (local preview), the copy bundled with the app at the same path is used instead.
 */
const R2 = "/api/img/";

/** The R2 address of a picture, by its path under app/public (e.g. "people/moses-exo-2-10-128.webp"). */
export const pictureSrc = (path: string) => apiURL(`${R2}${path}`);

/** The bundled copy of the same picture. */
export const bundledSrc = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** On an <img> from pictureSrc: if R2 can't give it, try the bundled copy once. */
export function onPictureError(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget, at = img.src.indexOf(R2);
  if (at < 0 || img.dataset.bundled) return;
  img.dataset.bundled = "1";
  img.src = bundledSrc(img.src.slice(at + R2.length));
}
