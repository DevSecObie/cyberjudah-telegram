/**
 * The app's pictures in R2 (the AUDIO bucket, under images/): People portraits and the Timeline's
 * period paintings and leader portraits. Only these shapes are served; nothing else in the bucket
 * can be read through /api/img/. bot/scripts/deploy-images.mjs uploads them from app/public/.
 */
export const IMAGE_PATH = /^(?:people\/[a-z0-9]+(?:-[a-z0-9]+)*-(?:128|256)|timeline\/periods\/[a-z0-9]+(?:-[a-z0-9]+)*|timeline\/leaders\/[a-z0-9]+(?:-[a-z0-9]+)*-(?:128|256|512))\.webp$/;

/** The R2 key for a picture path, or null when the path is not one the app serves. */
export function imageKey(path) {
  return typeof path === "string" && IMAGE_PATH.test(path) ? `images/${path}` : null;
}
