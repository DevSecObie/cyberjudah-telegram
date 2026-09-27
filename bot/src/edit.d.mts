export type NoteEdit = { file: string; teacher?: string; title?: string; replace?: { from: string; to: string }[]; body?: string };
export const NOTE_FILE: RegExp;
export function isAdminId(list: string | undefined, userId: number): boolean;
export function applyEdit(text: string, edit: NoteEdit): { text: string; summary: string[] };
