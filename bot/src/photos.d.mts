export const SLOT: RegExp;
export const OBJECT_KEY: RegExp;
export const MAX_BYTES: number;
export function sniff(b: Uint8Array): { type: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" } | null;
export function objectKey(slot: string, ext: string, now?: number): string;
export type PhotoEntry = { key: string; at: string; by: string };
export function publicManifest(m: Record<string, PhotoEntry> | null | undefined): Record<string, string>;
