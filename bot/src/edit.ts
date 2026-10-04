import type { Env } from './env';
import { applyEdit, isAdminId, NOTE_FILE, type NoteEdit } from './edit.mjs';
import { NoteSave } from '../../shared/cms';
import { CONTENT_REPO, Github, CmsError, createChange, type CmsActor } from './cms-github';
export type { NoteEdit };
export const isAdmin = (env: Env, userId: number) => isAdminId(env.ADMIN_IDS, userId);
export const canEdit = (env: Env) => Boolean(env.CYBERJUDAH_TOKEN);

/** Read the exact source version; every save must name this SHA, including quick fixes. */
export async function readSource(env: Env, file: string): Promise<{ ok: true; text: string; sha: string } | { ok: false; error: string }> {
  if (!NOTE_FILE.test(file)) return { ok: false, error: 'Not a note file.' };
  try {
    const git = new Github(env, CONTENT_REPO), main = await git.main(), source = await git.file(file, main.commit.sha);
    return { ok: true, text: source.text, sha: source.sha };
  } catch (e) { return { ok: false, error: e instanceof CmsError ? e.message : 'The source could not be loaded.' }; }
}
/** Compatibility endpoint: the existing editor now creates a review, never a main commit. */
export async function commitEdit(env: Env, edit: NoteEdit, by: CmsActor) {
  const parsed = NoteSave.safeParse(edit);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n') };
  if (!NOTE_FILE.test(parsed.data.file)) return { ok: false as const, error: 'Not a note file.' };
  const git = new Github(env, CONTENT_REPO), main = await git.main(), source = await git.file(edit.file, main.commit.sha);
  if (source.sha !== parsed.data.sha) throw new CmsError('The note changed since you opened it. Reload it and apply your correction to the new version.', 409);
  let applied: ReturnType<typeof applyEdit>;
  try { applied = applyEdit(source.text, parsed.data); }
  catch (e) { throw new CmsError(e instanceof Error ? e.message : "The note edit is invalid."); }
  if (applied.text === source.text) throw new CmsError('There is no content change to save.');
  const title = /^title:\s*"?(.*?)"?\s*$/m.exec(applied.text)?.[1] ?? edit.file;
  const change = await createChange(env, { repo: CONTENT_REPO, kind: 'note', subject: edit.file, title: `Edit note: ${title}`, reason: parsed.data.reason, base: main.commit.sha, files: [{ ...source, text: applied.text }] }, by);
  return { ok: true as const, commit: change.url!, changed: applied.summary, change };
}
