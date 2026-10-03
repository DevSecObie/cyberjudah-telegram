/**
 * Which AI providers the reader has agreed may receive their questions (docs/PRIVACY.md). Asked
 * for in Ask before the first question to a provider, sent with every question (the server
 * refuses a provider not on the list), and withdrawn in Settings → Privacy. Kept on this device.
 */
const KEY = "cj:ai-consent";
export function consented(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
export function agree(provider: string): void {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...consented(), provider])])); } catch { /* private mode: asked again next time */ }
}
export function withdraw(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
}
