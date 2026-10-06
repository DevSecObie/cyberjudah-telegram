export type AudioChapter = { slug: string; chapter: number };
export function adjacentChapter(books: { slug: string; chapterIds: number[] }[], where: AudioChapter | null, direction: number): AudioChapter | null;
export function bindMediaSession(session: MediaSession | undefined, actions: Partial<Record<MediaSessionAction, () => void>>): () => void;
