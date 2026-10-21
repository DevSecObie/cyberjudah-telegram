export const PERSISTED: Record<string, number>;
export const MAX_AGE: number;
export function persistable(key: unknown): boolean;
export function trim<T extends { queryKey: readonly unknown[]; state: { dataUpdatedAt: number } }>(queries: readonly T[], now?: number): T[];
