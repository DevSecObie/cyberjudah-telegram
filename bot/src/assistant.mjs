/**
 * Ask CyberJudah as the app's assistant: the rules behind its tools, kept pure so they are
 * tested on their own (agent.ts runs them). The assistant reads the reader's own data only
 * through these, and never changes anything itself: a change is a proposal the reader
 * confirms in the app, which then makes it with the reader's own authority.
 */
import { MINUTES, PAUSE_FOREVER } from "./reminders.mjs";

/** Words that say nothing about what is wanted ("how do I", "where is the"). */
const STOP = new Set(["a", "an", "and", "are", "can", "do", "does", "for", "from", "get", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "the", "to", "what", "where", "which", "with", "you", "your", "app", "want", "would", "like", "find", "see", "show", "open", "go"]);
const words = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9']+/).map((w) => w.replace(/'s?$/, "")).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * How well a text matches a query: the share of the query's words it has (a word inside
 * another counts half), with the whole phrase as a bonus. 0 is no match.
 */
export function score(text, query) {
  const t = String(text ?? "").toLowerCase();
  const q = String(query ?? "").toLowerCase().trim();
  const ws = words(q);
  if (!ws.length) return 0;
  const tw = new Set(words(t));
  let hit = 0;
  for (const w of ws) if (tw.has(w)) hit += 1; else if (w.length >= 4 && t.includes(w)) hit += 0.5;
  return hit / ws.length + (hit && t.includes(q) ? 0.5 : 0);
}
/** The best matches of a list by its fields (the first, its name, alone, or all of them together), best first: at least half the query's words. */
export function best(list, query, fields, n = 8) {
  return list
    .map((x) => ({ x, s: Math.max(score(fields(x)[0], query), score(fields(x).filter(Boolean).join(" · "), query)) }))
    .filter((r) => r.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((r) => r.x);
}

/** The reader's saved conversations whose title matches, newest first among equals. */
export function findChats(index, query, n = 8) {
  if (!String(query ?? "").trim()) return (index ?? []).slice(0, n);
  return best(index ?? [], query, (c) => [c.title], n);
}

/** People in the app's index, by any of their names. */
export const findPeople = (rows, query, n = 6) => best(rows ?? [], query, (p) => [p.name, ...(p.names ?? [])], n);
/** Case studies, by name, charge and themes. */
export const findCases = (rows, query, n = 6) => best(rows ?? [], query, (c) => [c.name, c.charge, (c.themes ?? []).join(" "), (c.topics ?? []).join(" ")], n);

/** App features (shared/app-features.mjs), by name, what they do and the words people use for them. */
export const findFeatures = (features, query, n = 6) => best(features ?? [], query, (f) => [f.name, f.what, (f.words ?? []).join(" ")], n);

/** "7:00", "18:45". */
export const timeLabel = (h, m = 0) => `${h}:${String(m).padStart(2, "0")}`;

/** The reader's reminder, said plainly, from the Worker's own view of it (reminders.mjs publicView). */
export function describeReminder(view) {
  if (!view) return "No reading reminder has been set up.";
  const ch = view.channels?.telegram && view.channels?.push ? "by Telegram and by push notification" : view.channels?.push ? "by push notification" : view.channels?.telegram ? "by Telegram" : "with no place chosen";
  const parts = [view.on ? `Reading reminders are on, every day at ${timeLabel(view.hour, view.minute)} (${view.tz}), ${ch}.` : `Reading reminders are off. The time kept is ${timeLabel(view.hour, view.minute)} (${view.tz}).`];
  if (view.pausedUntil) parts.push(view.pausedUntil === PAUSE_FOREVER ? "They are paused until resumed." : `They are paused until ${view.pausedUntil}.`);
  if (view.plan) parts.push(`The reminder follows the reading plan, day ${view.plan.day + 1}.`);
  else if (view.last) parts.push("The reminder goes back to the last chapter read.");
  else parts.push("Nothing has been read yet and no plan is started, so a reminder has nothing to point to and is not sent.");
  return parts.join(" ");
}

/**
 * A change to the reminder, proposed by the assistant: checked here, carried out only when the
 * reader confirms it in the app. Inside Telegram only Telegram reminders can be proposed: push
 * needs the browser's own permission, which only the reader can give, in the browser.
 * Returns the settings the app will save and a sentence for the confirm card, or why not.
 */
export function proposeReminder(input, { inTelegram = true, today = new Date().toISOString().slice(0, 10) } = {}) {
  const i = input && typeof input === "object" ? input : {};
  const settings = {};
  const said = [];
  if (i.on === false) { settings.on = false; said.push("Turn reading reminders off"); }
  if (i.resume === true) { settings.paused = false; said.push("Resume reading reminders"); }
  if (i.on === true) {
    settings.on = true;
    settings.channels = { telegram: true };
    said.push("Turn reading reminders on, by Telegram");
  }
  if (i.channel !== undefined) {
    if (i.channel === "push" || i.channel === "both") return { error: inTelegram ? "Push notifications can only be turned on in a browser, by the reader, because the browser must ask their permission. Point them to Settings → Reading reminders at cyberjudah.io/app." : "Push notifications are turned on from Settings → Reading reminders, where the browser asks permission." };
    if (i.channel !== "telegram") return { error: "The channel is telegram." };
    settings.channels = { telegram: true };
    if (!said.length) said.push("Send reading reminders by Telegram");
  }
  if (i.hour !== undefined || i.minute !== undefined) {
    const hour = Number(i.hour), minute = i.minute === undefined ? 0 : Number(i.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: "The hour is a whole number from 0 to 23, in the reader's own time." };
    if (!MINUTES.includes(minute)) return { error: "Reminders come at :00, :15, :30 or :45." };
    settings.hour = hour; settings.minute = minute;
    said.push(`${said.length ? "at" : "Move reading reminders to"} ${timeLabel(hour, minute)}`);
  }
  if (i.pause !== undefined) {
    const p = String(i.pause);
    if (p === "1" || p === "7") { settings.paused = true; settings.pauseDays = Number(p); said.push(p === "1" ? "Pause reading reminders until tomorrow" : "Pause reading reminders for a week"); }
    else if (p === "forever") { settings.paused = true; settings.pauseUntil = "forever"; said.push("Pause reading reminders until resumed"); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p) && p > today) { settings.paused = true; settings.pauseUntil = p; said.push(`Pause reading reminders until ${p}`); }
    else return { error: "A pause is 1 (until tomorrow), 7 (a week), forever, or a date after today as YYYY-MM-DD." };
  }
  if (!said.length) return { error: "Say what to change: on, off, the time, a pause, or resume." };
  return { settings, summary: `${said.join(" ")}.`.replace(/ \./, ".") };
}

/**
 * A tool input checked against the tool's own JSON schema (the parts the tools use: an object,
 * its required properties, and each property's type and enum). Returns why it is not valid,
 * or "" when it is. Streamed tool inputs are not checked by the API, so they are checked here.
 */
export function checkInput(schema, input) {
  if (!schema) return "No such tool.";
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The input must be an object.";
  for (const k of schema.required ?? []) if (input[k] === undefined) return `"${k}" is required.`;
  for (const [k, v] of Object.entries(input)) {
    const p = schema.properties?.[k];
    if (!p) return `"${k}" is not a field of this tool.`;
    if (v === null) return `"${k}" cannot be null.`;
    const t = p.type;
    if (t === "string" && typeof v !== "string") return `"${k}" must be text.`;
    if (t === "boolean" && typeof v !== "boolean") return `"${k}" must be true or false.`;
    if (t === "integer" && !Number.isInteger(v)) return `"${k}" must be a whole number.`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of ${p.enum.join(", ")}.`;
  }
  return "";
}
