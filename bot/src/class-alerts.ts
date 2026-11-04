import { importPKCS8, SignJWT } from "jose";
import type { Env } from "./env";
import { liveNow, recentVideos } from "./live";
import { fcmMessage, planClassAlerts } from "./class-alerts.mjs";

/**
 * New class alerts for the CyberJudah phone app (rules in class-alerts.mjs). Each run reads the
 * classroom channel's feed and /live page (both already cached at the edge, live.ts), and sends one
 * Firebase Cloud Messaging message per new class to the CLASS_ALERTS_TOPIC topic. Phones join or
 * leave the topic with Firebase themselves: this Worker never receives, stores or sees a phone's
 * token or anything about the reader. Free: FCM topic messages cost nothing.
 *
 * Off unless CLASS_ALERTS_TOPIC and the existing FIREBASE_SERVICE_ACCOUNT secret are both set.
 */
const PROJECT = "cyberjudah-app";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const SEND_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`;
const TOPIC = /^[a-zA-Z0-9-_.~%]{1,900}$/;
const seenKey = (topic: string) => `classalert:seen:${topic}`;

export type ClassAlertsRun = { sent: number; failed: number; seeded: boolean; skipped?: string };

/** A short-lived Google access token for FCM only, minted from the service account; never logged. */
async function messagingToken(env: Env): Promise<string> {
  let account: { type?: unknown; project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT ?? ""); } catch { throw new Error("Invalid signing configuration"); }
  if (account.type !== "service_account" || account.project_id !== PROJECT ||
    typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) ||
    typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
  const key = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email).setSubject(account.client_email).setAudience(TOKEN_URL)
    .setIssuedAt(now).setExpirationTime(now + 600).sign(key);
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`token ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function sendClassAlerts(env: Env, now = Date.now()): Promise<ClassAlertsRun> {
  const topic = env.CLASS_ALERTS_TOPIC;
  if (!topic || !TOPIC.test(topic)) return { sent: 0, failed: 0, seeded: false, skipped: "off" };
  if (!env.FIREBASE_SERVICE_ACCOUNT) return { sent: 0, failed: 0, seeded: false, skipped: "no_credentials" };
  const feed = await recentVideos(env);
  // Only the RSS feed is trusted for news: the channel-page fallback can bring back older uploads.
  if (!feed.ok) return { sent: 0, failed: 0, seeded: false, skipped: "feed_down" };
  const live = await liveNow(env).catch(() => null);
  const seen = await env.SUBS.get<string[]>(seenKey(topic), "json").catch(() => null);
  const plan = planClassAlerts({ videos: feed.videos, live, seen: Array.isArray(seen) ? seen : null, now });
  // Remembered before sending: at most once is better than twice when a run is cut short.
  await env.SUBS.put(seenKey(topic), JSON.stringify(plan.seen));
  if (!plan.alerts.length) return { sent: 0, failed: 0, seeded: !seen, skipped: undefined };
  const token = await messagingToken(env);
  let sent = 0;
  let failed = 0;
  for (const alert of plan.alerts) {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(fcmMessage(alert, topic)),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (response?.ok) sent++;
    else failed++;
  }
  return { sent, failed, seeded: false };
}
