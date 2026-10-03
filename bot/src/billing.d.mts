export type Catalog = { topups: { stars: number }[] };
export type Bought = { kind: "plan" | "pack"; uid: number; stars: number; tz?: string };
export function payloadOf(kind: "plan" | "pack", uid: number, stars: number, tz?: string): string;
export function readPayload(s: string): Bought | null;
export function validPayment(payload: string, currency: string, amount: number, catalog: Catalog): Bought | null;
export const SUPPORT_STARS: number[];
export function readSupport(s: string): { uid: number; stars: number } | null;
