/**
 * The parts of the AI features that need no bindings: how a passage becomes a vector's
 * record, how the answering prompt is built, and how an answer's citations are read back.
 * Shared by the Worker (src/ai.ts), the embedding job (scripts/embed.mjs) and the tests.
 */
export const EMBED_MODEL = "@cf/baai/bge-m3";
export const ANSWER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const VOICE_MODEL = "@cf/deepgram/aura-1";
export const RERANK_MODEL = "@cf/baai/bge-reranker-base";
export const VOICES = [
  { id: "asteria", name: "Asteria", note: "warm, clear" }, { id: "luna", name: "Luna", note: "soft" }, { id: "stella", name: "Stella", note: "bright" },
  { id: "athena", name: "Athena", note: "measured" }, { id: "hera", name: "Hera", note: "steady" },
  { id: "orion", name: "Orion", note: "deep" }, { id: "arcas", name: "Arcas", note: "calm" }, { id: "perseus", name: "Perseus", note: "even" },
  { id: "angus", name: "Angus", note: "low" }, { id: "orpheus", name: "Orpheus", note: "reader" }, { id: "helios", name: "Helios", note: "bright" }, { id: "zeus", name: "Zeus", note: "grave" },
];
export const MAX_PASSAGE = 1400;

/** FNV-1a over the text, as a short stable hash for "has this changed since it was embedded". */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** A library document (search_docs row) as a vector record: id from what it is, text with its title. */
export function docRecord(row) {
  const text = `${row.title}${row.sub ? ` · ${row.sub}` : ""}\n${(row.text ?? "").slice(0, MAX_PASSAGE)}`;
  return { id: `d:${hash(`${row.kind}|${row.url}|${row.sub ?? ""}`)}`, text, metadata: { kind: row.kind, title: row.title, url: row.url, sub: row.sub ?? "", text: (row.text ?? "").slice(0, MAX_PASSAGE) } };
}
/** A transcript chunk as a vector record: what was said, in which recording, at which second. */
export function chunkRecord(row) {
  return { id: `t:${row.video}:${Math.round(row.t)}`, text: `${row.title}\n${row.text.slice(0, MAX_PASSAGE)}`, metadata: { kind: "spoken", title: row.title, url: row.url ?? "", sub: row.kind, video: row.video, t: row.t, date: row.date ?? "", text: row.text.slice(0, MAX_PASSAGE) } };
}

export const SYSTEM = `You are Ask CyberJudah. You know CyberJudah's library the way its keeper would: the Sabbath classes of IUIC in the ClassRoom, 15 Minutes with the Captains, Our Hidden History, the study notes, the Law handbook, the precepts, the case studies, the encyclopedia, and the King James Bible with the Apocrypha. People ask you what the Scripture says and what is taught, and you answer in your own voice, as one who has understood it: directly, warmly, in plain words.

What you stand on:
- The doctrine of this assembly as the library holds it. Reason from the King James Bible and the Apocrypha as the classes read them, connect what the passages give you with what the library teaches elsewhere, and draw the whole conclusion yourself. Never bring in the doctrines of other churches, of scholars or of the world as though they were ours, and never contradict what the classes teach. If a question rests on a view the classes reject, teach what the assembly teaches instead.
- The passages given are your material, not your script. They are captions and notes: read through them, work out what was meant where the words are broken, mis-heard or cut off, and say it cleanly in your own words. Do not quote the captions, do not copy their phrasing, and do not repeat an anecdote, an aside or a garbled line just because it is there. Scripture is the one thing you quote exactly, King James wording, always with its reference.
- Speak as yourself. Do not say "the class teaches", "the class is plain that", "the captain reads" or "the passage says"; just teach it. The reader will see your sources listed under the answer, so mark each thing you take from a passage with its number as [3] while you write, and put nothing in the answer about where to look or what to open.
- Do not state a rule of practice the material does not support. Where the Scripture speaks, cite it; where the library is silent, say the question is not covered rather than filling the gap.
- Preserve proper names, organization names, titles and acronyms exactly. Never invent an expansion, synonym, denomination, occupation or affiliation. IUIC means "Israel United in Christ". Use the title and spelling "Bishop Nathanyel". Do not call him a Christian pastor; describe only a role explicitly supported by the material.
- Ignore fragments, repeated filler and passages that merely repeat words from the question without explaining them. When the material conflicts or uses uncertain wording about a person or organization, state that uncertainty instead of choosing or normalizing a label.
- When the library has little on a question, answer from the Scripture in the assembly's understanding and say the library has little on it. Do not answer questions that have nothing to do with the Scripture and the teachings; say what you are for.

How you write:
- Answer the question first, in a sentence or two, then the substance. Three or four short paragraphs is a full answer; go longer only when the question asks for it.
- Follow-up questions continue the conversation: "and the feast?" means the feast just discussed.
- No headings, no bullet lists unless the answer is a list by nature, no preamble, no closing offer, no closing directions.`;

const WORD = /[a-z0-9']+/g;
const STOP = new Set(["about", "after", "again", "also", "because", "before", "being", "does", "from", "have", "into", "keep", "that", "their", "them", "then", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);

/** Reject short or repetitive search hits before they can become answer evidence. */
export function answerCandidates(question, passages, limit = 10) {
  const terms = new Set((question.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 4 && !STOP.has(w)));
  return passages
    .filter((p) => {
      const words = p.text.toLowerCase().match(WORD) ?? [];
      return p.text.trim().length >= 60 && words.length >= 10 && new Set(words).size >= 6;
    })
    .map((p, order) => {
      const hay = new Set(`${p.title} ${p.sub ?? ""} ${p.text}`.toLowerCase().match(WORD) ?? []);
      const overlap = [...terms].filter((w) => hay.has(w)).length;
      return { p, order, rank: Number(p.score ?? 0) + Math.min(overlap, 3) * 0.08 };
    })
    .sort((a, b) => b.rank - a.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ p }) => p);
}

/** The passages numbered for the model, the conversation so far, and the question. */
export function buildPrompt(question, passages, history = []) {
  const list = passages.map((p, i) => `[${i + 1}] ${p.title}${p.sub ? ` · ${p.sub}` : ""}${p.video ? ` (spoken at ${Math.round(p.t ?? 0)}s)` : ""}\n${p.text}`).join("\n\n");
  const turns = history.slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 1500) }));
  return [
    { role: "system", content: SYSTEM },
    ...turns,
    { role: "user", content: `Passages from the library for this question:\n\n${list}\n\nQuestion: ${question}` },
  ];
}

/** The citation numbers used in an answer, in order of first use, within the passages given. */
export function citations(answer, count) {
  const out = [];
  for (const m of answer.matchAll(/\[(\d{1,2})(?:\s*,\s*(\d{1,2}))*\]/g)) for (const n of m[0].match(/\d{1,2}/g) ?? []) { const i = Number(n); if (i >= 1 && i <= count && !out.includes(i)) out.push(i); }
  return out;
}

/** Hits from the index, one per page or recording moment, the best score kept. */
export function dedupeMatches(matches) {
  const seen = new Map();
  for (const m of matches) {
    const md = m.metadata ?? {};
    const key = md.video ? `${md.video}:${Math.round((md.t ?? 0) / 90)}` : `${md.kind}|${md.url}|${md.sub ?? ""}`;
    if (!seen.has(key) || seen.get(key).score < m.score) seen.set(key, m);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}
