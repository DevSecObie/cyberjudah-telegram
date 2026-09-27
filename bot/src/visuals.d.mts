export type Visual = { t: number; said: number; text: string };
export function isCue(text: string): boolean;
export function findVisuals(segments: [number, string][], limit?: number): Visual[];
