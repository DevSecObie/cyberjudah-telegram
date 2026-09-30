import { api } from "@/tg/sdk";
import { store } from "@/tg/store";

/**
 * Backup and restore (Bible Strong's Backup / ImportExport screens). Everything the reader
 * kept lives in Telegram CloudStorage under the app's keys; a backup is those keys as one JSON
 * file, sent to the reader's chat by the bot; a restore reads such a file back in.
 */
export type Backup = { app: "cyberjudah"; version: 1; date: string; keys: Record<string, string> };
const KEY = /^[A-Za-z0-9_-]{1,128}$/;

/** Every key and value kept, read from the store. */
export async function collect(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of await store.keys()) { if (!KEY.test(k)) continue; const v = await store.get(k); if (v !== null) out[k] = v; }
  return out;
}
/** Send the backup to the reader's chat as a file. */
export async function sendBackup(): Promise<{ ok: true; entries: number } | { ok: false; error: string }> {
  const keys = await collect();
  if (!Object.keys(keys).length) return { ok: false, error: "Nothing kept yet: no highlights, notes, bookmarks or plan to back up." };
  try { return await api<{ ok: true; entries: number } | { ok: false; error: string }>("/api/backup", { method: "POST", json: { keys } }); }
  catch { return { ok: false, error: "The backup could not be sent. Check your connection and try again." }; }
}
/** What a file holds, or why it is not a backup. */
export function parseBackup(text: string): Backup | string {
  let b: unknown;
  try { b = JSON.parse(text); } catch { return "This file is not a CyberJudah backup."; }
  const o = b as Partial<Backup>;
  if (!o || o.app !== "cyberjudah" || typeof o.keys !== "object" || !o.keys) return "This file is not a CyberJudah backup.";
  const keys = Object.fromEntries(Object.entries(o.keys).filter(([k, v]) => KEY.test(k) && typeof v === "string" && v.length <= 4096));
  if (!Object.keys(keys).length) return "This backup is empty.";
  return { app: "cyberjudah", version: 1, date: String(o.date ?? ""), keys };
}
/** Write a backup back into the store; what is in the file wins over what is kept now. */
export function restore(b: Backup): number {
  for (const [k, v] of Object.entries(b.keys)) store.set(k, v);
  return Object.keys(b.keys).length;
}
