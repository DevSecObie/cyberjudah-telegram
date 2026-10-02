/**
 * The model this reader chose for Ask's in-depth answers (the list is the server's,
 * shared/ask-models.mjs). Kept on this device; the server checks it against its list and uses
 * the setup's own model for anything else, so a stale or unknown choice is harmless.
 */
const KEY = "cj:ask-model";
export function chosenModel(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
export function chooseModel(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* private mode: the choice lasts this session only */ }
}
