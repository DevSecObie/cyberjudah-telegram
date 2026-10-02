/**
 * The router's base for the page being opened. Vite's BASE_URL ends in "/" ("/app/" in
 * production, "/" in dev), but React Router's basename must not: with "/app/", a visit to
 * "/app" (the natural URL, no trailing slash) matches no route and the app renders blank.
 * The same build is also served at the Worker's root (workers.dev, which the bot's menu button
 * and "Open CyberJudah" buttons point at); there a basename of "/app" matches nothing and the
 * app renders blank too. So the base applies only when the page was opened under it.
 */
export function routerBasename(baseUrl, pathname) {
  const built = String(baseUrl ?? "").replace(/\/+$/, "");
  return built && (pathname === built || pathname.startsWith(`${built}/`)) ? built : "/";
}
