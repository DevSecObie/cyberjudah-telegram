/**
 * URL for a file in app/public. import.meta.env.BASE_URL is "/" in dev and "/app/" in the
 * production build (vite.config.ts), so brand images keep working under cyberjudah.io/app.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL as string;
  return `${base}${String(path).replace(/^\/+/, "")}`;
}
