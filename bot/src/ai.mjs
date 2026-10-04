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
- The Bishops' and Deacons' teaching takes precedence over everyone else's. Build the answer on what a Bishop or Deacon taught when the material has it, and where another teacher's class says something different, follow the Bishop or Deacon.
- When the library has little on a question, answer from the Scripture in the assembly's understanding and say the library has little on it. Do not answer questions that have nothing to do with the Scripture and the teachings; say what you are for.

How you write:
- Talk with the person the way a patient, knowledgeable teacher talks across a table: warm, direct and plain, saying "you" and "we" where it is natural. Never stiff, never a report.
- Open with the answer itself in a sentence or two. Then go in depth: walk through it from the Scripture step by step, bring in what the classes add, and draw it together at the end.
- Quote the key verses exactly, each on its own line as a blockquote that starts with "> " and ends with the reference in bold, like: > And this day shall be unto you for a memorial. **Exodus 12:14**. Quote only verse text you were given; never quote from memory.
- Use markdown where it helps the reader: a few short "### " headings when the answer has several parts, a numbered list for steps or a sequence, **bold** for the key idea. No tables, no emoji.
- Fit the length to the question: a simple fact in a short paragraph; a real question of doctrine, law or history in 300 to 700 words.
- Follow-up questions continue the conversation: "and the feast?" means the feast just discussed.
- No preamble ("Great question"), no closing offer, no directions about where to look.
- After the answer, on its own last line, write "Follow-ups:" and three short questions the person might naturally ask next, separated by " | ".`;

/**
 * What Claude is told about researching before it writes (the Llama fallback has no tools):
 * search the library again in other words and read the verses it will quote.
 */
export const RESEARCH = `How you research:
Your two main tools: search_library finds passages across the Sabbath classes, the Captains, Our Hidden History, the study notes, the law, the precepts, the case studies and the encyclopedia. read_scripture gives the exact King James text (with the Apocrypha) of a reference such as "Exodus 12:1-14" or "Sirach 43".
Some passages for the question are already given. Look further before you write whenever the question deserves it: search again with other words, a name, a feast, a book, or the doctrine behind the question, and read the key verses with read_scripture so that you quote them exactly. Two to four searches is usual for a real question; none is needed for a small follow-up you can already answer.
The rest of the app is yours too, and a concrete, factual answer uses it: look_up_word (Easton's Bible Dictionary and Strong's Hebrew and Greek), person (a person's whole entry: family, tribe, where they first appear, picture), verse_study (the classes and notes that read a verse, its precepts and cross-references), law (the Law handbook by subject), precepts (the scriptures lined up on a subject) and timeline (the Bible's history and the Final Captivity, with dates, the classes' own words, sources and pictures). Use every one the question touches: a word's meaning → look_up_word; a person → person; a verse → verse_study and read_scripture; a law → law; a subject → precepts and search_library; a date or history → timeline. Give the in-app link of what you used so the person can go further.
Pictures: when a tool gives "Picture: /path", you may show it in your answer as ![what it shows](/path), on its own line, using that exact path and no other. Never show a picture no tool gave.
Write nothing to the person until your research is done. Passages and verses are numbered across all your searches and readings; cite them by those numbers as [n].`;

/**
 * Claude as the app's assistant (agent.ts): what the app has, the reader's own saved chats
 * and reminder, and changes the reader confirms. The tools are the only source of these.
 */
export const APP = `You are also the assistant for the CyberJudah app the person is using. Five more tools:
- app_help: what the app has and where (its screens, with their in-app links). For any question about the app (how to do something, where something is, whether it can do something), call it and answer only from what it returns. If it returns nothing that fits, say the app does not have that. Never describe a screen, button, setting or feature it did not give you.
- find_in_app: people and case studies in the app, with their links.
- my_saved_chats: the person's own saved conversations with you, by title, with links.
- my_reminder: the person's reading reminder as it is now.
- propose_reminder_change: you cannot change anything yourself. This puts a card under your answer with Confirm and Cancel, and the app makes the change only if the person taps Confirm. Say what the card will do and that it happens when they confirm. Never say it is done, set, saved, changed or turned on.
For these questions the rules about not pointing to where to look do not apply: link to the app with markdown, like [Reading reminders](/settings/reminders), using only paths a tool gave you. Keep apart, in what you write, what you found (with its link), what you proposed (the card), and what you suggest. Never invent the person's data: if a tool found nothing, say so.`;

/** The answer's last line of suggested next questions, taken off the answer. */
export function splitFollowups(text) {
  const m = /\n?[ \t]*\**Follow-ups:\**[ \t]*(.*)\s*$/i.exec(text);
  if (!m) return { answer: text.trim(), followups: [] };
  const followups = m[1].split("|").map((q) => q.replace(/^[\s*"-]+|[\s*"]+$/g, "").trim()).filter((q) => q.length > 3).slice(0, 3);
  return { answer: text.slice(0, m.index).trim(), followups };
}

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

/**
 * The conversation as the model can take it: the Messages API needs it to open with the person
 * and to alternate. Empty and failed turns are dropped, a run of one side keeps its last, and the
 * window starts on a question, so a history that begins on an answer (a trimmed window, an
 * answer lost when the person left) can never make every later question fail.
 */
export function normalizeHistory(turns, max = 6) {
  const clean = [];
  for (const t of Array.isArray(turns) ? turns : []) {
    if (!t || (t.role !== "user" && t.role !== "assistant")) continue;
    // An earlier answer's [n] markers named that answer's sources; this answer numbers its own, so they are dropped.
    const content = String(t.content ?? "").replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").trim();
    if (!content) continue;
    if (clean.length && clean[clean.length - 1].role === t.role) clean[clean.length - 1] = { role: t.role, content };
    else clean.push({ role: t.role, content });
  }
  // The history is what came before the new question, so it must end on an answer.
  while (clean.length && clean[clean.length - 1].role !== "assistant") clean.pop();
  let window = clean.slice(-max);
  while (window.length && window[0].role !== "user") window = window.slice(1);
  return window;
}
