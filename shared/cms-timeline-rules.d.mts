export const GROUPS: string[];
export const PEOPLES: string[];
export const TRIBES: Record<string, string>;
export const BOOKS: string[];
export function parseRef(value: string): { book: string; chapter: number; from: number | null; to: number | null } | null;
export function seconds(value: string): number | null;
export function words(value: string): string;
export function checkEvent(event: unknown, periods: unknown[], options?: { draft?: boolean; leaders?: unknown[] | null; corpus?: unknown }): string[];
