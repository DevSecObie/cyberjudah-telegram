export type Chunk = { t: number; text: string };
export const CHUNK_SECONDS: number;
export const CHUNK_WORDS: number;
export const OVERLAP_SEGMENTS: number;
export const MIN_WORDS: number;
export function embedTailMode(value: string | undefined): "whole" | "legacy";
export function chunkSegments(segments: [number, string][], options?: { tail?: "whole" | "legacy" }): Chunk[];
export function videoOfThumb(thumb: string | null | undefined): string | null;
