/*
 * CyberJudah's service worker, for reading reminders only: it has no fetch handler and
 * caches nothing, so the app loads exactly as it does without it.
 *
 * A push carries no payload. On a push it asks the Worker what today's reminder is (by its
 * own subscription's endpoint) and shows it, with Done and Pause. Tapping the reminder opens
 * the app at the chapter.
 */
const ICON = "https://cyberjudah.io/assets/brand/cyber-lion.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
