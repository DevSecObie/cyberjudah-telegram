export type VitalName = "TTFB" | "FCP" | "LCP" | "INP" | "CLS";
export type VitalsReport = { area: string; platform: string; nav: string; conn?: string; metrics: Partial<Record<VitalName, number>> };
export type VitalsPoint = { indexes: [string]; blobs: string[]; doubles: [number] };
export const METRICS: Record<VitalName, number>;
export const PLATFORMS: string[];
export const NAVIGATIONS: string[];
export const CONNECTIONS: string[];
export function area(path: string): string;
export function vitalsPoints(body: unknown): VitalsPoint[] | null;
