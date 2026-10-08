export type Broadcast = { date: string; broadcastAt: string };
export function orderTeachings<T extends { date: string; video?: string; pending?: boolean; broadcastAt?: string }>(teachings: T[], broadcasts?: Record<string, Broadcast>): T[];
