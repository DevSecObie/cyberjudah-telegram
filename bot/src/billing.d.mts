export type Catalog = { plan: { stars: number }; packs: { stars: number }[] };
export function payloadOf(kind: "plan" | "pack", uid: number, stars: number): string;
export function readPayload(s: string): { kind: "plan" | "pack"; uid: number; stars: number } | null;
export function validPayment(payload: string, currency: string, amount: number, catalog: Catalog): { kind: "plan" | "pack"; uid: number; stars: number } | null;
export const SUPPORT_STARS: number[];
export function readSupport(s: string): { uid: number; stars: number } | null;
