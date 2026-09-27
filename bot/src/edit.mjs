// The pure part of editing a note from the app, testable without a Worker: which files
// count as notes, who is an admin, and how an edit lands in the markdown.
export const NOTE_FILE = /^(blog|captains)\/\d{4}\/[A-Za-z0-9._-]+\.md$/;

/** True when `userId` is one of the ids in ADMIN_IDS (comma or space separated). */
export const isAdminId = (list, userId) => String(list ?? "").split(/[,\s]+/).filter(Boolean).map(Number).includes(Number(userId));

const yaml = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Applies an edit to a note's text: `teacher` and `title` set front-matter fields, `replace`
 * pairs swap every occurrence in the whole file, `body` replaces the file. Returns the new
 * text and a line per change; throws when an edit would change nothing it should.
 */
export function applyEdit(text, edit) {
  const summary = [];
  if (edit.body !== undefined) {
    if (!/^---\n[\s\S]*?\n---\n/.test(edit.body)) throw new Error("The note must keep its front matter");
    return { text: edit.body.endsWith("\n") ? edit.body : edit.body + "\n", summary: ["the text"] };
  }
  let out = text;
  const setField = (key, value) => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(out);
    if (!m) throw new Error("The note has no front matter");
    const line = `${key}: ${yaml(value.trim())}`;
    const fm = m[1].split("\n");
    const i = fm.findIndex((l) => l.startsWith(`${key}:`));
    if (i >= 0) fm[i] = line; else fm.push(line);
    out = `---\n${fm.join("\n")}\n---\n` + out.slice(m[0].length);
  };
  if (edit.teacher !== undefined) { setField("teacher", String(edit.teacher)); summary.push(`teacher: ${String(edit.teacher).trim() || "(none)"}`); }
  if (edit.title !== undefined && String(edit.title).trim()) { setField("title", String(edit.title)); summary.push(`title: ${String(edit.title).trim()}`); }
  for (const r of edit.replace ?? []) {
    const from = String(r?.from ?? ""), to = String(r?.to ?? "");
    if (!from.trim() || from === to) continue;
    const n = out.split(from).length - 1;
    if (!n) throw new Error(`"${from}" is not in this note`);
    out = out.split(from).join(to);
    summary.push(`"${from}" → "${to}" (${n})`);
  }
  if (!summary.length) throw new Error("Nothing to change");
  return { text: out, summary };
}
