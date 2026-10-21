type Saved = { queryKey: readonly unknown[]; queryHash: string; state: { dataUpdatedAt: number } };
export const PERSISTED: Record<string, number>;
export const MAX_AGE: number;
export function persistable(key: unknown): boolean;
export function trim<T extends { queryKey: readonly unknown[]; state: { dataUpdatedAt: number } }>(queries: readonly T[], now?: number): T[];
export function settle<T extends { state: object; promise?: unknown }>(query: T): Omit<T, "promise">;
export function merge<T extends Saved>(saved: readonly T[], fresh: readonly T[]): T[];
