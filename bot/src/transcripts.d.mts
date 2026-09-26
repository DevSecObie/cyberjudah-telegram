export type Chunk = { t: number; text: string };
export const CHUNK_SECONDS: number;
export const CHUNK_WORDS: number;
export const OVERLAP_SEGMENTS: number;
export const MIN_WORDS: number;
export function chunkSegments(segments: [number, string][]): Chunk[];
export function videoOfThumb(thumb: string | null | undefined): string | null;
