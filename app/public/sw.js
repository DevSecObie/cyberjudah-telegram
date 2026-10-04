/*
 * CyberJudah's offline shell and reading reminders. Personal API responses are never
 * cached here. Saved books remain in cj-offline-v1, independently of shell releases.
 *
 * A push carries no payload. On a push it asks the Worker what today's reminder is (by its
 * own subscription's endpoint) and shows it, with Done and Pause. Tapping the reminder opens
 * the app at the chapter.
 */
const ICON = "https://cyberjudah.io/assets/brand/cyber-lion.png";

const SHELL_REVISION = "__CJ_SHELL_REVISION__";
const shellName = `cj-shell-${SHELL_REVISION}`;
async function currentShell() {
  return shellName;
}
self.addEventListener("install", (e) => e.waitUntil((async () => {
  const response = await fetch(new URL("offline-shell.json", self.registration.scope), { cache: "no-store" });
  if (!response.ok) throw new Error("Offline shell manifest unavailable");
  const manifest = await response.json();
  if (manifest.revision !== SHELL_REVISION || !/^[a-f0-9]{64}$/.test(manifest.revision) || !Array.isArray(manifest.paths) || !manifest.paths.includes("index.html") || manifest.paths.some((p) => typeof p !== "string" || !/^(index\.html|assets\/[a-zA-Z0-9_.-]+\.(js|css))$/.test(p))) throw new Error("Invalid offline shell manifest");
  const name = `cj-shell-${manifest.revision}`;
  const cache = await caches.open(name);
  // addAll rejects partial responses; a failed update never changes the committed shell.
  await cache.addAll(manifest.paths.map((p) => new Request(new URL(p, self.registration.scope), { cache: "reload" })));
  // Telegram owns its SDK lifecycle. Offline reading uses the app's web fallback.
  // The cache name is embedded in this worker, including after it is stopped/restarted.
})()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url), scope = new URL(self.registration.scope);
  if (e.request.method !== "GET") return;
  const own = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  const path = own ? url.pathname.slice(scope.pathname.length) : "";
  const asset = own && /^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path);
  const page = own && e.request.mode === "navigate" && !/^(api|bs|strong)(\/|$)/.test(path);
  if (!asset && !page) return;
  e.respondWith((async () => {
    const name = await currentShell(), cache = name ? await caches.open(name) : null;
    if (asset) { const kept = await cache?.match(e.request); if (kept) return kept; return fetch(e.request); }
    try { const fresh = await fetch(e.request); if (fresh.ok) return fresh; } catch { /* saved shell below */ }
    const saved = await cache?.match(new URL("index.html", self.registration.scope).href);
    // Static hosts may redirect index.html to /. A navigation's redirect mode can
    // reject that cached redirected response; replay its verified cached body.
    return saved ? new Response(saved.body, { status: saved.status, headers: saved.headers }) : Response.error();
  })());
});

const endpoint = async () => (await self.registration.pushManager.getSubscription())?.endpoint ?? "";
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

self.addEventListener("push", (e) => e.waitUntil((async () => {
  const ep = await endpoint();
  let r = null;
  try { const res = await post("/api/push/today", { endpoint: ep }); if (res.ok) r = await res.json(); } catch { /* offline: the plain reminder below */ }
  // A push must always show a notification; if today's reading cannot be fetched, a plain one.
  if (!r) return self.registration.showNotification("CyberJudah", { body: "Open CyberJudah to keep reading.", tag: "cj-reminder", icon: ICON, data: { param: "" } });
  return self.registration.showNotification(r.title, {
    body: r.body, tag: "cj-reminder", icon: ICON, data: { param: r.param },
    actions: r.done ? [] : [{ action: "done", title: "Done" }, { action: "pause", title: "Pause for a week" }],
  });
})()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    if (e.action === "done" || e.action === "pause") { await post(`/api/push/${e.action}`, { endpoint: await endpoint() }).catch(() => undefined); return; }
    const param = e.notification.data?.param;
    const url = new URL(param ? `?tgWebAppStartParam=${encodeURIComponent(param)}` : "./", self.registration.scope).href;
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) if (c.url.startsWith(self.registration.scope) && "navigate" in c) { await c.focus(); return c.navigate(url); }
    return self.clients.openWindow(url);
  })());
});

// The browser replaced the subscription (it expired or was rotated): subscribe again with the
// same key and tell the Worker which old endpoint the new one takes over from. Not every
// browser fires this, so the app also sends its current subscription on each open.
self.addEventListener("pushsubscriptionchange", (e) => e.waitUntil((async () => {
  const old = e.oldSubscription?.endpoint;
  const sub = e.newSubscription ?? (e.oldSubscription?.options ? await self.registration.pushManager.subscribe(e.oldSubscription.options) : null);
  if (old && sub) await post("/api/push/renew", { old, sub: sub.toJSON() });
})().catch(() => undefined)));
