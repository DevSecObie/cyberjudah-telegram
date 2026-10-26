export type Note = { id: string; title: string; description: string; date: number; tags?: Record<string, true>; verses?: number[] };

/** Older notes keep their verse-range keys; new notes carry their passage separately from their ID. */
export const noteVerses = (key: string, note: Pick<Note, "verses">) => note.verses ?? key.split("/").map(Number);
