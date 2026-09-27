import type { Env } from "./env";

/**
 * Editing a note from the app: a small change (the teacher's name, the title, a spelling)
 * becomes a commit to the cyberjudah repository through GitHub's contents API, and the site
 * rebuilds on its own. Only the admins named in ADMIN_IDS may edit, and only with the
 * CYBERJUDAH_TOKEN secret on the Worker (a fine-grained token with contents write on the
 * repository). Nothing is trusted from the request but the file path, checked to be a note.
 */
import { applyEdit, isAdminId, NOTE_FILE, type NoteEdit } from "./edit.mjs";
export type { NoteEdit };

const API = "https://api.github.com";
export const isAdmin = (env: Env, userId: number) => isAdminId(env.ADMIN_IDS, userId);
export const canEdit = (env: Env) => Boolean(env.CYBERJUDAH_TOKEN);

const gh = (env: Env, path: string, init?: RequestInit) => fetch(`${API}${path}`, {
  ...init,
  headers: { authorization: `Bearer ${env.CYBERJUDAH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "cyberjudah-telegram", "x-github-api-version": "2022-11-28", ...(init?.headers ?? {}) },
});

const b64 = { enc: (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))), dec: (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0))) };

/** Reads the note, applies the edit and commits it. Returns the commit URL and what changed. */
export async function commitEdit(env: Env, edit: NoteEdit, by: string): Promise<{ ok: true; commit: string; changed: string[] } | { ok: false; error: string }> {
  if (!canEdit(env)) return { ok: false, error: "Editing is not set up: the Worker has no CYBERJUDAH_TOKEN." };
  if (!NOTE_FILE.test(edit.file ?? "")) return { ok: false, error: "Not a note file." };
  const repo = env.TRANSCRIPTS_REPO || "DevSecObie/cyberjudah";
  const url = `/repos/${repo}/contents/${edit.file}`;
  const cur = await gh(env, url);
  if (!cur.ok) return { ok: false, error: cur.status === 404 ? "This note is not in the repository." : `GitHub ${cur.status} reading the note.` };
  const { sha, content } = (await cur.json()) as { sha: string; content: string };
  let applied: { text: string; summary: string[] };
  try { applied = applyEdit(b64.dec(content), edit); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const title = /^title:\s*"?(.*?)"?\s*$/m.exec(applied.text)?.[1] ?? edit.file;
  const message = `notes: ${title} (edited in the app)\n\n${applied.summary.map((s) => `- ${s}`).join("\n")}\n\nEdited by ${by} from the Telegram app.`;
  const put = await gh(env, url, { method: "PUT", body: JSON.stringify({ message, content: b64.enc(applied.text), sha }) });
  if (!put.ok) return { ok: false, error: put.status === 409 ? "The note changed meanwhile. Try again." : `GitHub ${put.status} writing the note.` };
  const res = (await put.json()) as { commit: { html_url: string } };
  return { ok: true, commit: res.commit.html_url, changed: applied.summary };
}
