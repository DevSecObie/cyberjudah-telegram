import { test } from "node:test";
import assert from "node:assert/strict";
import { describeReminder, findCases, findChats, findPeople, proposeReminder } from "../src/assistant.mjs";
import { applySettings, blank } from "../src/reminders.mjs";
import { clearPending, getPending, markPending, saveExchange, getChat, setActionState } from "../src/chats.ts";

const kv = () => {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, m };
};

test("a reminder change is only proposed: checked, said plainly, and saved later by the app with the reader's authority", () => {
  const on = proposeReminder({ on: true, hour: 6, minute: 30 });
  assert.equal(on.summary, "Turn reading reminders on, by Telegram at 6:30.");
  assert.deepEqual(on.settings, { on: true, channels: { telegram: true }, hour: 6, minute: 30 });
  // What the app would save is exactly what the Worker's own rules accept.
  const rec = applySettings(blank("UTC"), on.settings, new Date("2026-10-02T05:00:00Z"));
  assert.equal(rec.on, true); assert.equal(rec.hour, 6); assert.equal(rec.minute, 30); assert.equal(rec.channels.telegram, true);
  assert.equal(proposeReminder({ on: false }).summary, "Turn reading reminders off.");
  assert.equal(proposeReminder({ hour: 21 }).summary, "Move reading reminders to 21:00.");
  assert.equal(proposeReminder({ pause: "7" }).summary, "Pause reading reminders for a week.");
  assert.equal(proposeReminder({ pause: "forever" }).settings.pauseUntil, "forever");
  assert.equal(proposeReminder({ pause: "2026-12-01" }, { today: "2026-10-02" }).settings.pauseUntil, "2026-12-01");
  assert.equal(proposeReminder({ resume: true }).summary, "Resume reading reminders.");
});

test("what the assistant may not propose is refused with the reason", () => {
  assert.match(proposeReminder({ channel: "push" }).error, /only be turned on in a browser, by the reader/);
  assert.match(proposeReminder({ hour: 25 }).error, /0 to 23/);
  assert.match(proposeReminder({ hour: 7, minute: 10 }).error, /:00, :15, :30 or :45/);
  assert.match(proposeReminder({ pause: "2020-01-01" }, { today: "2026-10-02" }).error, /date after today/);
  assert.match(proposeReminder({}).error, /Say what to change/);
  assert.match(proposeReminder(null).error, /Say what to change/);
});

test("the reader's reminder is described from the Worker's view, without inventing a plan or a chapter", () => {
  assert.equal(describeReminder(null), "No reading reminder has been set up.");
  const v = { on: true, hour: 7, minute: 0, tz: "America/Chicago", channels: { telegram: true, push: false }, pausedUntil: null, plan: null, last: null };
  assert.equal(describeReminder(v), "Reading reminders are on, every day at 7:00 (America/Chicago), by Telegram. Nothing has been read yet and no plan is started, so a reminder has nothing to point to and is not sent.");
  assert.match(describeReminder({ ...v, on: false, pausedUntil: "9999-12-31", plan: { day: 12, perDay: 4 } }), /off.*paused until resumed.*day 13/);
});

test("saved chats, people and case studies are found by their own words", () => {
  const chats = [{ id: "a", title: "Why keep the Passover?" }, { id: "b", title: "Who was Melchizedek?" }, { id: "c", title: "The twelve tribes today" }];
  assert.deepEqual(findChats(chats, "passover").map((c) => c.id), ["a"]);
  assert.deepEqual(findChats(chats, "melchizedek priest").map((c) => c.id), ["b"]);
  assert.deepEqual(findChats(chats, "").map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(findChats(chats, "baptism"), []);
  const people = [{ id: "aaron", name: "Aaron", names: ["Aaron"] }, { id: "ahab-1", name: "Ahab", names: ["Ahab"] }, { id: "esau", name: "Esau", names: ["Esau", "Edom"] }];
  assert.deepEqual(findPeople(people, "Edom").map((p) => p.id), ["esau"]);
  const cases = [{ slug: "korah", name: "Korah's Rebellion", charge: "rebellion against Moses", themes: ["rebellion"] }, { slug: "achan", name: "Achan", charge: "took the accursed thing" }];
  assert.deepEqual(findCases(cases, "rebellion").map((c) => c.slug), ["korah"]);
});

test("a question being answered is marked for a day's worth of minutes, and an applied proposal is remembered", async () => {
  const env = { SUBS: kv() };
  await markPending(env, 7, "chat00009", "When is Passover?");
  assert.equal((await getPending(env, 7, "chat00009")).q, "When is Passover?");
  assert.equal(await getPending(env, 8, "chat00009"), null, "only the asker's");
  await clearPending(env, 7, "chat00009");
  assert.equal(await getPending(env, 7, "chat00009"), null);
  await saveExchange(env, 7, "chat00009", "Remind me at 6", { content: "I can set that up once you confirm.", actions: [{ id: "act1", kind: "reminder", summary: "Turn reading reminders on, by Telegram at 6:00.", settings: { on: true } }] });
  assert.equal(await setActionState(env, 7, "chat00009", "act1", "applied"), true);
  assert.equal((await getChat(env, 7, "chat00009")).turns[1].actions[0].state, "applied");
  assert.equal(await setActionState(env, 7, "chat00009", "nope", "applied"), false);
  assert.equal(await setActionState(env, 8, "chat00009", "act1", "applied"), false, "another reader cannot");
});
