/**
 * "Report this answer" on an Ask answer or the search screen's AI answer: what reaches the
 * admins. Only which answer (Ask's chat id and the answer's place in it; for search, the model
 * that wrote it) and the reason: never the question, the answer's text, or who reported it.
 * The chat itself stays sealed for its owner (privacy.mjs), so the admins see that an answer
 * was reported, not what it said.
 */
export const REPORT_REASONS = { wrong: "wrong or misquoted", harmful: "harmful or offensive" };
const CHAT_ID = /^[a-z0-9]{8,40}$/;
const MODEL_ID = /^[@A-Za-z0-9._/-]{1,80}$/;

/** The admins' message for a report, or null when the report is not one the app sends. */
export function reportMessage(body) {
  if (!body || typeof body !== "object") return null;
  if (typeof body.reason !== "string" || !Object.hasOwn(REPORT_REASONS, body.reason)) return null;
  const reason = REPORT_REASONS[body.reason];
  const model = typeof body.model === "string" && MODEL_ID.test(body.model) ? body.model : "";
  if (body.kind === "ask") {
    if (typeof body.chat !== "string" || !CHAT_ID.test(body.chat) || !Number.isInteger(body.turn) || body.turn < 0 || body.turn > 1000) return null;
    return `An Ask answer was reported as ${reason}: chat ${body.chat}, message ${body.turn}${model ? `, model ${model}` : ""}.`;
  }
  if (body.kind === "search") return `A search AI answer was reported as ${reason}${model ? `: model ${model}` : ""}.`;
  return null;
}
