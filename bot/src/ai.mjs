import { groundedSystem, libraryData, untrustedData } from "./grounding.mjs";
import { citationReport } from "./citations.mjs";

/**
 * The parts of the AI features that need no bindings: how a passage becomes a vector's
 * record, how the answering prompt is built, and how an answer's citations are read back.
 * Shared by the Worker (src/ai.ts), the embedding job (scripts/embed.mjs) and the tests.
 */
export const EMBED_MODEL = "@cf/baai/bge-m3";
export const ANSWER_MODEL = "@cf/moonshotai/kimi-k2.6";
export const VOICE_MODEL = "@cf/deepgram/aura-2-en";
export const RERANK_MODEL = "@cf/baai/bge-reranker-base";
/** The reading voices (Aura-2). Four Aura-1 voices have no Aura-2 voice of the same name; a reader's
 *  saved choice of one of them is read by the closest Aura-2 voice (VOICE_ALIASES). */
export const VOICES = [
  { id: "asteria", name: "Asteria", note: "warm, clear" }, { id: "luna", name: "Luna", note: "soft" }, { id: "thalia", name: "Thalia", note: "bright" },
  { id: "athena", name: "Athena", note: "measured" }, { id: "hera", name: "Hera", note: "steady" },
  { id: "orion", name: "Orion", note: "deep" }, { id: "arcas", name: "Arcas", note: "calm" }, { id: "odysseus", name: "Odysseus", note: "even" },
  { id: "jupiter", name: "Jupiter", note: "low" }, { id: "orpheus", name: "Orpheus", note: "reader" }, { id: "apollo", name: "Apollo", note: "bright" }, { id: "zeus", name: "Zeus", note: "grave" },
];
export const VOICE_ALIASES = { stella: "thalia", perseus: "odysseus", angus: "jupiter", helios: "apollo" };
/** The Aura-2 voice for a voice id, a retired Aura-1 id included; undefined for anything else. */
export const voiceId = (v) => (VOICES.some((x) => x.id === v) ? v : VOICE_ALIASES[v]);
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

export const SYSTEM = `You are Ask CyberJudah. You know CyberJudah's library the way its keeper would: the Sabbath classes of IUIC in the ClassRoom, 15 Minutes with the Captains, Our Hidden History, the study notes, the Law handbook, the precepts, the case studies, the encyclopedia, and the King James Bible with the Apocrypha. People come to you to learn what the Scripture says and what the classes teach. Talk with them the way the best assistant they have ever used would: you understand what they mean, you think it through, you answer the real question, and you are honest about what you know.

How you think before you write:
- Work out what the person is really asking. Read the conversation so far: a follow-up such as "and the feast?", "why?", "who was he?" or "say more" continues what was just discussed, and "he", "it" and "that" mean what they meant a moment ago. If the person corrects you or pushes back, take it seriously: check the passages again, and say plainly whether they are right.
- If the question has several parts, answer every part, in order. If it is vague or could mean more than one thing, answer the most likely meaning, say in one short line which meaning you took, and offer the other in your follow-ups. Ask a question back only when no sensible answer is possible without it.
- Reason carefully from the material and how the sources connect. Do this thinking silently and write the result in the order that best answers this person's question.
- A greeting, a thank-you or a question about what you can do needs no passages: answer it in a sentence or two, warmly, and say what you are for.

What you stand on:
- The doctrine of this assembly as the library holds it. Reason from the King James Bible and the Apocrypha as the classes read them, and connect what the passages give you with what the library teaches elsewhere. Never bring in the doctrines of other churches, of scholars or of the world as though they were ours, and never contradict what the classes teach. If a question rests on a view the classes reject, teach what the assembly teaches instead.
- The passages are your only evidence. Never invent a reference, a quote, a date, a name, a number, a teacher or a class. Never cite a number that is not in the list you were given. Quote Scripture only from verse text you were given, never from memory, in exact King James wording with its reference.
- Keep the classes' language. Do not soften, tone down or apologise for what the classes teach: if the class said it strongly, say it as strongly. When the class's own words say it best, quote them in quotation marks with the passage number, cleaning only what the captions plainly mis-heard; never put words in a teacher's mouth. Do not repeat an aside, an announcement or a garbled line just because it is there.
- A passage marked "taught by" names its recorded teacher. Name that teacher only when quoting that source’s exact recorded words with its citation, instead of calling them "the classes" (for example, "Bishop Nathanyel taught..." or "Deacon Eythan explains..."). Never attribute a paraphrase to that teacher or put it under their name. Include the recorded date or year when it helps, only when that source supplies it. Never infer a teacher from a thumbnail, title, voice, another recording or general knowledge. Never name a teacher for a passage that is not marked; just explain its supported point. Mark each thing you take from a passage with its number as [3] while you write. Each point the classes teach should carry a class moment: when a recorded class (a passage with a moment in the recording) supports the point, cite that one, so the person can play the class at that minute; cite a note or a card as well where it adds something. The person sees the sources listed under your answer, so say nothing about where to look or what to open.
- Be honest about the edges of what you have, in plain words. Where the passages answer only part of the question, answer that part and name the part they do not cover. Where they do not answer it at all, say that you could not find material that answers it directly. A missing search result does not prove the subject has never been discussed. If one of the passages you were given comes close, cite it as related material with its number, as [4]; never name a class, teacher or moment you were not given. Suggest a clearer or narrower question only when that would help. Do not fill the gap from general knowledge. Do not state a rule of practice the material does not support.
- Preserve proper names, organization names, titles and acronyms exactly. Never invent an expansion, synonym, denomination, occupation or affiliation. IUIC means "Israel United in Christ". Use the title and spelling "Bishop Nathanyel". Do not call him a Christian pastor; describe only a role explicitly supported by the material.
- Ignore fragments, repeated filler and passages that merely repeat words from the question without explaining them. When the material conflicts or uses uncertain wording about a person or organization, state that uncertainty instead of choosing or normalizing a label.
- The Bishops' and Deacons' teaching takes precedence over everyone else's. Build the answer on the passages taught by a Bishop or Deacon when the material has them, and where another teacher's class says something different, follow the Bishop or Deacon.
- Do not answer questions that have nothing to do with the Scripture, the teachings or this app; say in a sentence what you are for.

How you write:
- Talk directly with the person, like a capable conversational assistant: natural, thoughtful, clear and warm. Address what they actually asked, and let each sentence build on the last.
- Open with the answer itself. Organize the explanation around the question, explain the connections that matter, and go deeper when the retrieved material has more to say. Do not force every answer into the same outline or add an obligatory concluding summary.
- Give the substance directly with [n] citations. Do not repeatedly frame it with "As taught in the classes", "According to the classes", or similar stock introductions. Use a recorded teacher’s name only on exact quoted and cited words from that source; explain supported connections in your own voice without attributing a paraphrase to the teacher. Do not repeat a name in every sentence or attach it to another source’s teaching.
- Quote the key verses exactly, each on its own line as a blockquote that starts with "> " and ends with the reference in bold, like: > And this day shall be unto you for a memorial. **Exodus 12:14**
- Use markdown where it helps the reader: a few short "### " headings when the answer has several parts, a numbered list for steps or a sequence, **bold** for the key idea. No tables, no emoji.
- Fit the length and structure to the question. Be brief for a quick fact; for a substantial question, explain the supported points thoroughly enough to be useful. Follow-ups should develop the conversation instead of repeating the previous answer. Do not stop at an arbitrary word count or pad with repetition.
- No preamble ("Great question"), no closing offer, no directions about where to look.
- After the answer, on its own last line, write "Follow-ups:" and three short questions the person might naturally ask next, separated by " | ". Leave the line out after a greeting or a thank-you.`;

/**
 * What Claude is told about researching before it writes (the Llama fallback has no tools):
 * search the library again in other words and read the verses it will quote.
 */
export const RESEARCH = `How you research:
Your two main tools: search_library finds passages across the Sabbath classes, the Captains, Our Hidden History, the study notes, the law, the precepts, the case studies and the encyclopedia. read_scripture gives the exact King James text (with the Apocrypha) of a reference such as "Exodus 12:1-14" or "Sirach 43".
Some passages for the question are already given. Research before writing whenever the question needs it. Search again from different angles, then open the strongest relevant classes with read_note and read_transcript instead of answering from their search snippets. For a substantial question, read the two or three most relevant classes deeply, following adjacent transcript windows or note offsets as needed; do not force irrelevant readings into a simple question. Use search_classes to find more recordings, commentary and verse_study for the key verses, and read_scripture for every verse you quote. Follow public indexes with read_data when you need a resource not found by the first search. Stop researching when the evidence answers the question, rather than trying to use every tool or spend every round. When the exact question lacks direct coverage, explain that search limit plainly and develop what the retrieved sources actually support, with citations; never fill gaps with invented teaching.
The rest of the app is yours too, and a concrete, factual answer uses it: look_up_word (Strong's Hebrew and Greek, and Easton's Bible Dictionary, an outside dictionary: where Easton's differs from the Scripture or the classes, the Scripture and the classes stand and Easton's is not repeated), person (a person's whole entry: family, tribe, where they first appear, picture), verse_study (the classes and notes that read a verse, its precepts and cross-references), law (the Law handbook by subject), precepts (the scriptures lined up on a subject) and timeline (the Bible's history and the Final Captivity, with dates, the classes' own words, sources and pictures). Use every one the question touches: a word's meaning → look_up_word; a person → person; a verse → verse_study and read_scripture; a law → law; a subject → precepts and search_library; a date or history → timeline. Give the in-app link of what you used so the person can go further.
The Apocrypha is part of this Bible: read_scripture reads it, verse_study studies it, and for its people and history that the app does not cover yet, look_up_word and then outside_source.
Outside sources: outside_source reads only the owner's approved sites (whitelist). Use it after the app and the classes, preferring israelunite.org before other approved outside sites. If it has no readable match, try the others. Use only the source's stated facts, never invent new doctrine. Use outside sources for history, places and people; cite what you use by its number, say plainly that it is an outside source, and never let it overrule the Scripture or the classes. Scripture comes only from read_scripture: never quote a Bible verse from an outside site, whose wording may be another translation.
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
      // The Bishops' and Deacons' teaching comes first: a small lift, so it makes the cut when it is relevant.
      const rank = /^bishop\b/i.test(p.teacher ?? "") ? 0.06 : /^deacon\b/i.test(p.teacher ?? "") ? 0.04 : 0;
      return { p, order, rank: Number(p.score ?? 0) + Math.min(overlap, 3) * 0.08 + rank };
    })
    .sort((a, b) => b.rank - a.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ p }) => p);
}

/**
 * The question as the library is searched for it: a follow-up ("why?", "and the feast?", "who was
 * he?") carries the person's previous question with it, so the search finds what the conversation
 * is about rather than the bare words.
 */
const REFERS = /^(and|but|so|also|then|why|how|what about|who was|where|when|say more|tell me more|explain|more)\b|\b(he|him|his|she|her|they|them|their|it|its|that|this|those|these)\b/i;
const STUDY_PREFIX = "Earlier study context (conversation only, never evidence):\n";
const PRIOR_QUESTION = "\n\nEarlier question: ";

/** Bounded user-owned conversation hints, never system instructions or registered evidence. */
export function withStudyContext(history, raw) {
  if (!history.length || !raw || typeof raw !== 'object' || typeof raw.topic !== 'string') return history;
  const clean = (text, max) => typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim().slice(0, max) : '';
  const list = (field, count, max) => Array.isArray(raw[field]) ? raw[field].slice(-count).map(value => clean(value, max)).filter(Boolean) : [];
  const context = { topic: clean(raw.topic, 400), corrections: list('corrections', 3, 180), references: list('references', 8, 40), unresolved: list('unresolved', 3, 180), sourceUrls: list('sourceUrls', 4, 120) };
  if (!context.topic) return history;
  while (untrustedData(context, 'study_context').length > 2300) {
    if (context.sourceUrls.length) context.sourceUrls.shift();
    else if (context.references.length) context.references.shift();
    else if (context.unresolved.length) context.unresolved.shift();
    else if (context.corrections.length) context.corrections.shift();
    else context.topic = context.topic.slice(0, Math.floor(context.topic.length * 0.8));
  }
  return history.map((turn, index) => index ? turn : { ...turn, content: `${STUDY_PREFIX}${untrustedData(context, 'study_context')}${PRIOR_QUESTION}${turn.content.slice(0, 600)}` });
}

function studyHint(history) {
  const content = history[0]?.content ?? '';
  if (!content.startsWith(STUDY_PREFIX)) return null;
  try {
    const json = /```json\n([\s\S]*?)\n```/.exec(content)?.[1];
    const topic = JSON.parse(json)?.topic;
    const split = content.indexOf(PRIOR_QUESTION);
    return typeof topic === 'string' && split >= 0 ? { topic: topic.slice(0, 400), question: content.slice(split + PRIOR_QUESTION.length) } : null;
  } catch { return null; }
}

export function retrievalText(question, history = []) {
  const hint = studyHint(history);
  const prior = [...history].reverse().find((t) => t.role === "user");
  const prev = prior === history[0] && hint ? hint.question : prior?.content ?? "";
  if (!prev) return question;
  const words = question.trim().split(/\s+/).length;
  const refers = words < 14 && (REFERS.test(question) || /^(?:continue|go on|go deeper)\b/i.test(question));
  if (!refers) return question;
  const topic = hint?.topic && hint.topic !== prev ? `${hint.topic.slice(0, 300)} ` : '';
  return `${topic}${prev.slice(0, 300)} ${question}`;
}

/** The verse references named in a question ("Deuteronomy 28:68", "1 John 3:4-8"), at most three. */
export function referencesIn(question) {
  const out = [];
  for (const m of String(question).matchAll(/\b((?:[1-3]|I{1,3})\s?[A-Za-z]+|[A-Za-z]+(?: of [A-Za-z]+)*)\s+(\d{1,3}):(\d{1,3})(?:\s*[-\u2013]\s*(\d{1,3}))?/g)) {
    const ref = `${m[1]} ${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ""}`;
    if (!out.includes(ref)) out.push(ref);
    if (out.length === 3) break;
  }
  return out;
}

/** The passages numbered for the model, the conversation so far, and the question. */
export function buildPrompt(question, passages, history = [], { plain = false } = {}) {
  const list = libraryData(passages);
  const turns = promptHistory(history);
  const material = passages.length
    ? `Passages from the library for this question:\n\n${list}`
    : "No passages from the library were found for this question. If it is a greeting, a thank-you or a question about you, answer it briefly. Otherwise say plainly that the library has nothing on it yet and suggest a clearer way to ask; quote no Scripture and cite nothing.";
  return [
    { role: "system", content: `${groundedSystem(SYSTEM)}${plain ? plainCitationGuide(passages) : ""}` },
    ...turns,
    { role: "user", content: `${material}\n\nQuestion: ${question}` },
  ];
}

/** Trusted format guidance contains host-assigned numeric IDs only, never source text or metadata. */
function plainCitationGuide(passages) {
  const ids = [...new Set(passages.map((source, index) => source.n ?? index + 1).filter(n => Number.isSafeInteger(n) && n > 0))];
  if (!ids.length) return "";
  const example = ids[0];
  return `\n\nPlain answer citation format:\n${ids.map(n => `source_n=${n} -> [${n}]`).join("\n")}\nUse these registered [n] markers after each supported point, including a direct verse quotation. A Bible book/chapter/verse reference is not a numbered source citation.\nWorked formatting example (placeholders only, not teaching or evidence):\nA point supported by the supplied source. [${example}]\n> Exact KJV words copied from that source. **Its recorded Bible reference** [${example}]\nReplace those placeholder words only with material supported by the supplied library records. Keep the source's exact wording for Scripture and its recorded reference. Never copy the example as an answer, invent a source ID, or cite an unrelated passage. If the material does not answer the question, say so.\n`;
}

/** The citation numbers used in an answer, in order of first use, within the passages given. */
export function citations(answer, count) {
  return citationReport(answer, count).supported;
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
    const content = String(t.content ?? "").replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim();
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

/** Bound prior chat text, keeping both its opening context and most recent wording. */
export function promptHistory(history = []) {
  const marker = "\n[Earlier message shortened for context.]\n";
  return normalizeHistory(history, 8).map(turn => {
    const limit = turn.role === "user" ? 3000 : 1500;
    const text = String(turn.content);
    const content = text.length <= limit ? text : `${text.slice(0, limit - marker.length - 500)}${marker}${text.slice(-500)}`;
    return { role: turn.role, content };
  });
}

/**
 * How much thinking a question needs, as the leading assistants route it: "light" (a greeting, a
 * thank-you, a short follow-up, a plain who-or-what) can go to a faster, cheaper model; "deep" (why
 * and how, comparisons, several questions at once, a passage to explain) to the strongest one the
 * reader has. Used only when the reader has not chosen a model.
 */
const DEEP = /\b(why|how|explain|meaning|mean|compare|difference|relationship|prophec|interpret|connect|according to|teach|taught|doctrine|law|commandment)\w*/i;
export function routeOf(question, history = []) {
  const q = String(question).trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  if ((q.match(/\?/g)?.length ?? 0) > 1 || words > 25 || /\d+:\d+\s*[-\u2013]\s*\d+/.test(q)) return "deep";
  if (/^(hi|hello|hey|shalom|thanks?|thank you|ok(ay)?|got it|amen)\b/i.test(q) && words <= 8) return "light";
  if (DEEP.test(q)) return "deep";
  if (words <= 8) return history.length ? "light" : /^(who|what|when|where)\b/i.test(q) ? "light" : "deep";
  return "deep";
}

/**
 * The answer when the search found nothing that answers the question: state the search's limit
 * naturally, pointing to the closest class moment it did find, if it found one. Only a
 * passage the search returned is named, never one from memory.
 */
export function notInTheClasses(found) {
  const near = found.find((p) => p.video && typeof p.t === "number" && p.title);
  if (!near) return { answer: "I couldn't find enough library material to answer this reliably. Try naming the person, book, feast or verse you mean.", sources: [] };
  return {
    answer: `I couldn't find material that answers this directly. The closest related source is **${near.title.replace(/[*_\[\]]/g, "")}** [1]. Try naming the person, book, feast or verse you mean.`,
    sources: [{ ...near, n: 1 }],
  };
}

/**
 * The question with the passage the reader has open in the Bible (Ask from the reader): Ask starts
 * from that passage's precepts and classes, and "this verse" means it. A question that names its
 * own reference is left as it is.
 */
export function withReading(question, reading) {
  if (!reading || referencesIn(question).length) return question;
  return `${question}\n\n(I have ${reading} open in the Bible.)`;
}
