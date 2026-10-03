import type { Env } from "./env";
import type { moveLegacy } from "./chats";
import { pid, seal } from "./privacy.mjs";

/**
 * One-time move of every record still filed under a Telegram ID to the person's pseudonymous ID
 * (privacy.mjs), so that nothing stays behind for people who do not come back: Ask accounts,
 * payments and who-asked rows in D1; saved conversations (sealed as they move), daily-verse
 * subscriptions and class requests in KV. Run by the hourly cron, a bounded amount at a time,
 * until a pass finds nothing left; then it marks itself done.
 */
const DONE = "privacy:migrated:v1";
const NUMERIC = /^\d{1,20}$/;
const BUDGET = 400;

/** `move` is chats.ts moveLegacy (passed in, so this module has no runtime dependency on the chat store). */
export async function migratePrivacy(env: Env, move: typeof moveLegacy): Promise<{ moved: number; done: boolean }> {
  if (await env.SUBS.get(DONE)) return { moved: 0, done: true };
  let moved = 0;

  // D1: rows keyed by a Telegram ID.
  for (const table of ["accounts", "payments", "usage_people"]) {
    const rows = await env.DB.prepare(`SELECT DISTINCT user_id FROM ${table} WHERE user_id GLOB '[0-9]*' LIMIT ?`).bind(BUDGET).all<{ user_id: string }>().catch(() => ({ results: [] as { user_id: string }[] }));
    for (const r of rows.results ?? []) {
      if (!NUMERIC.test(r.user_id)) continue;
      const id = await pid(env, r.user_id);
      // A person who has a row under both (they came back meanwhile) keeps the new one.
      await env.DB.prepare(`UPDATE OR IGNORE ${table} SET user_id = ? WHERE user_id = ?`).bind(id, r.user_id).run();
      await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(r.user_id).run();
      moved++;
    }
  }

  // KV: conversations, daily-verse subscriptions and class requests.
  for (const prefix of ["chats:", "sub:", "notereq:"]) {
    let cursor: string | undefined;
    do {
      const page = await env.SUBS.list({ prefix, cursor });
      for (const k of page.keys) {
        if (moved >= BUDGET) return { moved, done: false };
        const rest = k.name.slice(prefix.length);
        if (prefix === "chats:" && NUMERIC.test(rest)) { const uid = Number(rest); await move(env, uid, await pid(env, uid)); moved++; }
        else if (prefix === "sub:" && NUMERIC.test(rest)) {
          const v = await env.SUBS.get(k.name);
          const to = `sub:${await pid(env, rest)}`;
          if (v) await env.SUBS.put(to, await seal(env, to, JSON.parse(v)));
          await env.SUBS.delete(k.name); moved++;
        } else if (prefix === "notereq:") {
          const got = await env.SUBS.getWithMetadata(k.name);
          const r = got.value ? (JSON.parse(got.value) as { users?: (string | number)[] }) : null;
          if (r?.users?.some((u) => typeof u === "number")) {
            r.users = await Promise.all(r.users.map((u) => (typeof u === "number" ? pid(env, u) : u)));
            await env.SUBS.put(k.name, JSON.stringify(r), got.metadata ? { metadata: got.metadata } : undefined);
            moved++;
          }
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  if (moved === 0) await env.SUBS.put(DONE, new Date().toISOString());
  return { moved, done: moved === 0 };
}
