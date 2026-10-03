import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  APOCRYPHA, flatChapters, CATCH_UP_HOURS, PUSH_DEVICES, PAUSE_FOREVER, addDays, addPush, applyContent, applySettings, blank, claim, countByChannel, dueChannels, localNow,
  markDone, markSent, mayBeDue, meta, pause, portion, pushOutcome, release, removePush, stop, telegramBack, telegramGone, ackPending, validTz,
} from "../src/reminders.mjs";

const BOOKS = [
  { book: "Genesis", slug: "genesis", chapters: 3, chapterIds: [1, 2, 3] },
  { book: "Exodus", slug: "exodus", chapters: 2, chapterIds: [1, 2] },
];
/** A reminder that is on: Telegram linked to chat 42, push subscribed, 7:00 in the given zone. */
const on = (tz = "America/Chicago", extra = {}) => ({
  ...blank(tz), on: true, hour: 7, chatId: 42, channels: { telegram: true, push: false },
  pushes: [{ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }], ...extra,
});

test("time zones: the reader's own hour and date, summer time followed", () => {
  // 12:00 UTC on 2026-07-01 is 07:00 in Chicago (CDT, -5) and 21:00 in Tokyo.
  assert.deepEqual(localNow("America/Chicago", new Date("2026-07-01T12:00:00Z")), { date: "2026-07-01", hour: 7, minute: 0 });
  assert.deepEqual(localNow("Asia/Tokyo", new Date("2026-07-01T12:00:00Z")), { date: "2026-07-01", hour: 21, minute: 0 });
  // In January Chicago is CST (-6): 07:00 local is 13:00 UTC.
  assert.deepEqual(localNow("America/Chicago", new Date("2026-01-15T13:00:00Z")), { date: "2026-01-15", hour: 7, minute: 0 });
  // Across midnight: 03:00 UTC is still the day before in Los Angeles.
  assert.equal(localNow("America/Los_Angeles", new Date("2026-07-02T03:00:00Z")).date, "2026-07-01");
  // Half- and three-quarter-hour zones: 01:30 UTC is 07:00 in Kolkata, 01:15 UTC is 07:00 in Kathmandu.
  assert.deepEqual(localNow("Asia/Kolkata", new Date("2026-07-01T01:30:00Z")), { date: "2026-07-01", hour: 7, minute: 0 });
  assert.deepEqual(localNow("Asia/Kathmandu", new Date("2026-07-01T01:15:00Z")), { date: "2026-07-01", hour: 7, minute: 0 });
  assert.equal(validTz("Europe/London"), true);
  assert.equal(validTz("Mars/Olympus"), false);
  assert.equal(validTz(""), false);
  // A bad zone falls back to UTC rather than throwing.
  assert.equal(localNow("Nope/Nowhere", new Date("2026-07-01T05:00:00Z")).hour, 5);
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("due at the reader's hour in their zone, and in no other zone", () => {
  const r = on("America/Chicago");
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T12:00:00Z")), ["telegram"]);
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T11:00:00Z")), [], "06:00 local is too early");
  assert.deepEqual(dueChannels(on("Europe/London"), new Date("2026-07-01T06:00:00Z")), ["telegram"], "07:00 BST");
  assert.deepEqual(dueChannels(on("Europe/London"), new Date("2026-07-01T12:00:00Z")), [], "13:00 BST is past the window");
});

test("opt-in: off by default, on only when asked, off again when asked", () => {
  const now = new Date("2026-07-01T10:00:00Z"); // 05:00 in Chicago
  const fresh = blank("America/Chicago");
  assert.equal(fresh.on, false);
  assert.deepEqual(fresh.channels, { telegram: false, push: false });
  assert.deepEqual(dueChannels({ ...fresh, chatId: 42 }, new Date("2026-07-01T12:00:00Z")), []);
  const turned = applySettings({ ...fresh, chatId: 42 }, { on: true, hour: 7, channels: { telegram: true } }, now);
  assert.equal(turned.on, true);
  assert.equal(turned.from, "2026-07-01", "before 7:00, today counts");
  assert.deepEqual(dueChannels(turned, new Date("2026-07-01T12:00:00Z")), ["telegram"]);
  const off = applySettings(turned, { on: false }, now);
  assert.deepEqual(dueChannels(off, new Date("2026-07-01T12:00:00Z")), []);
  // Switched on after today's hour: the first reminder is tomorrow, not a catch-up now.
  const late = applySettings({ ...fresh, chatId: 42 }, { on: true, hour: 7, channels: { telegram: true } }, new Date("2026-07-01T12:30:00Z"));
  assert.equal(late.from, "2026-07-02");
  assert.deepEqual(dueChannels(late, new Date("2026-07-01T13:00:00Z")), []);
  assert.deepEqual(dueChannels(late, new Date("2026-07-02T12:00:00Z")), ["telegram"]);
  // No channel chosen is the same as off.
  assert.equal(applySettings(turned, { channels: { telegram: false, push: false } }, now).on, false);
  // Bad input keeps what was there.
  const kept = applySettings(turned, { hour: 99, tz: "Mars/Olympus", on: "yes" }, now);
  assert.equal(kept.hour, 7); assert.equal(kept.tz, "America/Chicago"); assert.equal(kept.on, true);
});

test("a missed hour is caught up once, never twice", () => {
  let r = on("America/Chicago");
  // The 07:00 run did not happen; the 08:00 run catches it up.
  const eight = new Date("2026-07-01T13:00:00Z");
  assert.deepEqual(dueChannels(r, eight), ["telegram"]);
  r = markSent(r, "telegram", eight);
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T14:00:00Z")), [], "not again at 09:00");
  assert.deepEqual(dueChannels(r, eight), [], "not again in the same hour (a re-run)");
  // Past the catch-up window nothing is sent that day.
  assert.deepEqual(dueChannels(on(), new Date(Date.UTC(2026, 6, 1, 12 + CATCH_UP_HOURS))), []);
  // The next day it comes again.
  assert.deepEqual(dueChannels(r, new Date("2026-07-02T12:00:00Z")), ["telegram"]);
});

test("channel choice: Telegram, push, or both, each only where it can be delivered", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  assert.deepEqual(dueChannels(on("America/Chicago", { channels: { telegram: false, push: true } }), at), ["push"]);
  assert.deepEqual(dueChannels(on("America/Chicago", { channels: { telegram: true, push: true } }), at), ["telegram", "push"]);
  // Telegram chosen but no chat linked yet (a browser that has not started the bot): push only.
  const noChat = on("America/Chicago", { channels: { telegram: true, push: true } }); delete noChat.chatId;
  assert.deepEqual(dueChannels(noChat, at), ["push"]);
  // Push chosen but no subscription on file: nothing on push.
  const noSub = on("America/Chicago", { channels: { telegram: false, push: true }, pushes: [] });
  assert.deepEqual(dueChannels(noSub, at), []);
});

test("one per channel a day, and Done in either clears both", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  let r = on("America/Chicago", { channels: { telegram: true, push: true }, plan: { day: 0, perDay: 2 } });
  r = markSent(r, "telegram", at);
  assert.deepEqual(dueChannels(r, at), ["push"], "push still owed after Telegram was sent");
  r = markDone(r, BOOKS, at);
  assert.deepEqual(dueChannels(r, at), [], "Done on Telegram stops the push");
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T13:00:00Z")), [], "and the catch-up");
  assert.deepEqual(dueChannels(r, new Date("2026-07-02T12:00:00Z")), ["telegram", "push"], "tomorrow both again");
  // Done twice the same day does not skip a second plan day.
  const again = markDone(r, BOOKS, at);
  assert.equal(again.plan.day, 1);
  assert.equal(again.pending.length, 1);
});

test("what is reminded: today's plan portion, else the last chapter, never verse text", () => {
  const plan = portion(on("UTC", { plan: { day: 1, perDay: 2 } }), BOOKS);
  assert.equal(plan.kind, "plan");
  assert.equal(plan.label, "Genesis 3 – Exodus 1");
  assert.equal(plan.param, "bible_genesis_3");
  assert.deepEqual(plan.chapters, [{ slug: "genesis", chapter: 3 }, { slug: "exodus", chapter: 1 }]);
  assert.equal(portion(on("UTC", { plan: { day: 0, perDay: 2 } }), BOOKS).label, "Genesis 1–2");
  const last = portion(on("UTC", { last: { slug: "exodus", chapter: 2 } }), BOOKS);
  assert.deepEqual([last.kind, last.label, last.param], ["last", "Exodus 2", "bible_exodus_2"]);
  assert.equal(portion(on("UTC"), BOOKS), null, "nothing read yet: nothing invented");
  assert.equal(portion(on("UTC", { plan: { day: 9, perDay: 2 } }), BOOKS), null, "a finished plan with no last chapter");
  assert.ok(!JSON.stringify(plan).includes("In the beginning"));
});

test("Done moves the reader on and queues the chapters for the app to mark read", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const p = markDone(on("America/Chicago", { plan: { day: 0, perDay: 2 } }), BOOKS, at);
  assert.equal(p.plan.day, 1);
  assert.deepEqual(p.pending, [{ day: 0, chapters: [{ slug: "genesis", chapter: 1 }, { slug: "genesis", chapter: 2 }], date: "2026-07-01" }]);
  const l = markDone(on("America/Chicago", { last: { slug: "genesis", chapter: 3 } }), BOOKS, at);
  assert.deepEqual(l.last, { slug: "exodus", chapter: 1 }, "continues into the next book");
  assert.deepEqual(ackPending(p, ["2026-07-01"]).pending, []);
});

test("pause and stop, from the app or the reminder", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const paused = pause(on(), at);
  assert.equal(paused.pausedUntil, "2026-07-08", "a week when no length is given");
  assert.equal(pause(on(), at, 1).pausedUntil, "2026-07-02", "until tomorrow");
  assert.equal(pause(on(), at, "2026-08-15").pausedUntil, "2026-08-15", "until a chosen date");
  assert.equal(pause(on(), at, "2028-01-01").pausedUntil, "2026-07-08", "more than a year ahead is refused");
  assert.equal(pause(on(), at, "2026-06-01").pausedUntil, "2026-07-08", "a past date is refused");
  assert.equal(pause(on(), at, "forever").pausedUntil, PAUSE_FOREVER, "until resumed");
  assert.deepEqual(dueChannels(pause(on(), at, "forever"), new Date("2030-07-01T12:00:00Z")), []);
  assert.equal(applySettings(on(), { paused: true, pauseUntil: "2026-07-20" }, at).pausedUntil, "2026-07-20");
  assert.deepEqual(dueChannels(paused, new Date("2026-07-05T12:00:00Z")), []);
  assert.deepEqual(dueChannels(paused, new Date("2026-07-08T12:00:00Z")), ["telegram"], "resumes by itself");
  assert.equal(applySettings(paused, { paused: false }, at).pausedUntil, undefined);
  assert.deepEqual(dueChannels(stop(on()), at), []);
  assert.equal(mayBeDue(meta(paused), new Date("2026-07-05T12:00:00Z")), false);
});

test("an expired push (404/410) falls back to Telegram, with a notice", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const ep = "https://push.example/abc";
  const pushOnly = on("America/Chicago", { channels: { telegram: false, push: true } });
  const gone = pushOutcome(pushOnly, [{ endpoint: ep, status: 410 }], at);
  assert.deepEqual(gone.gone, [ep]);
  assert.equal(gone.sendTelegram, true);
  assert.equal(gone.rec.channels.push, false);
  assert.equal(gone.rec.channels.telegram, true);
  assert.deepEqual(gone.rec.pushes, [], "the dead subscription is forgotten");
  assert.equal(gone.rec.notice, "push-fallback");
  assert.equal(pushOutcome(pushOnly, [{ endpoint: ep, status: 404 }], at).gone.length, 1);
  // Telegram already had today's: the notice, but no second message.
  assert.equal(pushOutcome(markSent({ ...pushOnly, channels: { telegram: true, push: true } }, "telegram", at), [{ endpoint: ep, status: 404 }], at).sendTelegram, false);
  // No Telegram to fall back to: push turns off, and so does the reminder.
  const alone = { ...pushOnly }; delete alone.chatId;
  const r = pushOutcome(alone, [{ endpoint: ep, status: 410 }], at);
  assert.equal(r.sendTelegram, false); assert.equal(r.rec.on, false); assert.equal(r.rec.notice, undefined);
  // A blocked bot switches Telegram off and keeps push; starting the bot again brings it back.
  const blocked = telegramGone(on("UTC", { channels: { telegram: true, push: true } }));
  assert.deepEqual(blocked.channels, { telegram: false, push: true });
  assert.deepEqual(telegramBack(blocked).channels, { telegram: true, push: true });
  const tgOnly = telegramGone(on("UTC"));
  assert.equal(tgOnly.on, false);
  assert.equal(telegramBack(tgOnly).on, true, "a reminder that was on is on again");
  assert.equal(telegramBack(on("UTC")).tgBlocked, undefined, "nothing to restore when it was never blocked");
});

test("our own key errors (401/403) and passing failures never drop a subscription", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const ep = "https://push.example/abc";
  const r = on("America/Chicago", { channels: { telegram: false, push: true } });
  for (const status of [400, 401, 403, 413, 429, 500, 503, 0]) {
    const f = pushOutcome(r, [{ endpoint: ep, status }], at);
    assert.equal(f.rec.pushes.length, 1, `kept on ${status}`);
    assert.equal(f.rec.channels.push, true);
    assert.equal(f.sent, false);
    assert.equal(f.sendTelegram, false);
    assert.equal(f.misconfigured, status === 401 || status === 403, `misconfigured on ${status}`);
  }
});

test("several browsers: one delivery counts for the day, a gone one is dropped, the rest kept", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  let r = on("America/Chicago", { channels: { telegram: false, push: true }, pushes: [] });
  for (let i = 0; i < PUSH_DEVICES + 2; i++) {
    const out = addPush(r, { endpoint: `https://push.example/${i}`, keys: { p256dh: "k", auth: "a" } }, at);
    r = out.rec;
    if (i >= PUSH_DEVICES) assert.equal(out.dropped.length, 1, "past the limit one is let go");
  }
  assert.equal(r.pushes.length, PUSH_DEVICES);
  assert.equal(r.pushes[0].endpoint, "https://push.example/2", "the oldest went first");
  // The same browser again does not take a second place.
  assert.equal(addPush(r, { endpoint: "https://push.example/5", keys: { p256dh: "k", auth: "a" } }, at).rec.pushes.length, PUSH_DEVICES);
  const results = r.pushes.map((p, i) => ({ endpoint: p.endpoint, status: i === 0 ? 410 : i === 1 ? 201 : 503 }));
  const f = pushOutcome(r, results, at);
  assert.equal(f.sent, true);
  assert.equal(f.rec.pushes.length, PUSH_DEVICES - 1);
  assert.equal(f.rec.sent.push, "2026-07-01");
  assert.deepEqual(removePush(f.rec, f.rec.pushes[0].endpoint).pushes.length, PUSH_DEVICES - 2);
});

test("at most once: the day is claimed before sending, and given back only to retry", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const r = on("America/Chicago", { channels: { telegram: true, push: true } });
  const claimed = claim(r, ["telegram", "push"], at);
  assert.deepEqual(dueChannels(claimed, at), [], "a second run in the meantime sends nothing");
  const back = release(claimed, "push", r);
  assert.deepEqual(dueChannels(back, at), ["push"], "a failed push is tried again");
  assert.equal(back.sent.telegram, "2026-07-01");
});

test("summer time: a skipped time is sent at the next valid moment, a repeated one once", () => {
  // 2026-03-08 in Chicago: 02:00 jumps to 03:00. A 2:30 reminder goes at 03:00.
  const spring = on("America/Chicago", { hour: 2, minute: 30 });
  assert.deepEqual(dueChannels(spring, new Date("2026-03-08T08:00:00Z")), ["telegram"], "03:00 CDT");
  // 2026-11-01: 01:00-02:00 happens twice. A 1:30 reminder goes the first time only.
  let fall = on("America/Chicago", { hour: 1, minute: 30 });
  const first = new Date("2026-11-01T06:30:00Z"); // 01:30 CDT
  assert.deepEqual(dueChannels(fall, first), ["telegram"]);
  fall = markSent(fall, "telegram", first);
  assert.deepEqual(dueChannels(fall, new Date("2026-11-01T07:30:00Z")), [], "01:30 CST, the second time");
});

test("quarter hours: 7:15 is due at 7:15, and the :30 and :45 zones are reached by the quarter-hour cron", () => {
  const r = on("America/Chicago", { minute: 15 });
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T12:00:00Z")), [], "07:00 is before 07:15");
  assert.deepEqual(dueChannels(r, new Date("2026-07-01T12:15:00Z")), ["telegram"]);
  assert.equal(applySettings(r, { minute: 20 }).minute, 15, "only quarter hours");
  assert.equal(applySettings(r, { minute: 45 }).minute, 45);
  // 7:00 in Kolkata (UTC+5:30) is 01:30 UTC, and in Kathmandu (UTC+5:45) 01:15 UTC: both quarter-hour runs.
  assert.deepEqual(dueChannels(on("Asia/Kolkata"), new Date("2026-07-01T01:30:00Z")), ["telegram"]);
  assert.deepEqual(dueChannels(on("Asia/Kathmandu"), new Date("2026-07-01T01:15:00Z")), ["telegram"]);
  assert.equal(mayBeDue(meta(on("Asia/Kathmandu")), new Date("2026-07-01T01:15:00Z")), true);
  assert.equal(mayBeDue(meta(on("Asia/Kathmandu")), new Date("2026-07-01T01:00:00Z")), false);
});

test("the cron's metadata filter and the admin counts agree with the records", () => {
  const at = new Date("2026-07-01T12:00:00Z");
  const r = on("America/Chicago", { channels: { telegram: true, push: true } });
  assert.equal(mayBeDue(meta(r), at), true);
  assert.equal(mayBeDue(meta(r), new Date("2026-07-01T20:00:00Z")), false);
  assert.equal(mayBeDue(meta(stop(r)), at), false);
  const counts = countByChannel([meta(r), meta(on()), meta(on("UTC", { channels: { telegram: false, push: true } })), meta(stop(r)), null]);
  assert.deepEqual(counts, { telegram: 1, push: 1, both: 1, paused: 0, off: 2 });
});

test("the app's place is taken only when well formed", () => {
  const r = applyContent(blank(), { plan: { day: 3, perDay: 4 }, last: { slug: "john", chapter: 3 } });
  assert.deepEqual([r.plan, r.last], [{ day: 3, perDay: 4 }, { slug: "john", chapter: 3 }]);
  const bad = applyContent(r, { plan: { day: -1, perDay: 4 }, last: { slug: "<script>", chapter: 3 } });
  assert.deepEqual([bad.plan, bad.last], [{ day: 3, perDay: 4 }, { slug: "john", chapter: 3 }]);
  assert.equal(applyContent(r, { plan: null }).plan, null);
});

test("plan days are counted in the app's book order, the Apocrypha as the app names it", () => {
  const src = fs.readFileSync(new URL("../../app/src/api/data.ts", import.meta.url), "utf8");
  const block = /export const APOCRYPHA[^=]*=\s*\[([\s\S]*?)\];/.exec(src)[1];
  const app = [...block.matchAll(/\["([^"]+)", "([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(APOCRYPHA, app);
  const books = [
    { book: "Malachi", slug: "malachi", chapters: 1, testament: "Old Testament", chapterIds: [1] },
    { book: "Matthew", slug: "matthew", chapters: 1, testament: "New Testament", chapterIds: [1] },
    { book: "Sirach", slug: "sirach", chapters: 1, testament: "Apocrypha", chapterIds: [1] },
    { book: "Tobit", slug: "tobit", chapters: 1, testament: "Apocrypha", chapterIds: [1] },
  ];
  assert.deepEqual(flatChapters(books).map((c) => c.book), ["Malachi", "Matthew", "Tobit", "Ecclesiasticus"]);
});
