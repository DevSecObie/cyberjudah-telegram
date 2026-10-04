import { APPROVED_RESOURCE_IDS, type ResourcePins } from "../../shared/resources";
import { pinnedRecord, resourceLink, resourcePages, approvedEditionUrl } from "./resource-tools";
import type Anthropic from "@anthropic-ai/sdk";

import type { Env, Exec } from "./env";
import type { Passage } from "./ai.mjs";
import { dataJson } from "./data";
import { lookup as eastonLookup } from "./dictionary";
import easton from "../data/easton.json";
import timeline from "../../app/src/data/timeline.json";
import finalCaptivity from "../../app/src/data/final-captivity.json";

/**
 * The rest of the app, for Ask: the dictionaries (Easton's and Strong's), a person's whole entry,
 * a verse's study (the classes that read it, its precepts and cross-references), the law
 * handbook, the precept topics and the Timeline, each with its in-app link and, where the app has
 * one, its picture. Every answer can then rest on the same data the reader sees in the app.
 */
export const MORE_TOOLS: Anthropic.Tool[] = [
  {
    name: "look_up_word",
    description: "Look a word up in the app's dictionaries: Easton's Bible Dictionary (names, places, things, doctrines) and Strong's (the Hebrew and Greek behind the King James words, with the meaning and how the KJV renders it). Give an English word or name, or a Strong's number like H430 or G26. Call it whenever a word's meaning, origin or the original language matters.",
    input_schema: { type: "object", properties: { word: { type: "string", description: "An English word or name, or a Strong's number (H… or G…)." } }, required: ["word"] },
  },
  {
    name: "person",
    description: "A person's whole entry in the app's People: who they were, their family (father, mother, brothers and sisters, husbands and wives, children), their tribe, where they first appear, and their picture if the app has one. Give a name, or an id from find_in_app. Call it for any question about who someone was or how people are related.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "The person's name, or their People id." } }, required: ["name"] },
  },
  {
    name: "verse_study",
    description: "Everything the app has on a verse or chapter: the classes and notes that read it (with the moment), the precepts placed on it, and its cross-references. Give a reference like \"Isaiah 61:1\" or \"Deuteronomy 28\". Call it when a question is about what a particular scripture means or how it was taught.",
    input_schema: { type: "object", properties: { reference: { type: "string", description: "Book and chapter, with an optional verse." } }, required: ["reference"] },
  },
  {
    name: "law",
    description: "The app's Law handbook: the commandments, statutes and judgments arranged by subject, each law with its scriptures. Give a subject (\"sabbath\", \"marriage\", \"clean meats\", \"tithes\") or a section id like 2A. Call it for any question about what the law says or how to keep it.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A subject, or a section id." } }, required: ["query"] },
  },
  {
    name: "precepts",
    description: "The app's precept topics: the scriptures lined up precept upon precept on one subject (for example abomination, adultery, the Sabbath), with their text. Give the subject. Call it to build an answer line upon line from the scriptures the library already gathered.",
    input_schema: { type: "object", properties: { topic: { type: "string", description: "The subject." } }, required: ["topic"] },
  },
  {
    name: "outside_source",
    description: "To read the approved Josephus (Whiston 1905), Jewish Encyclopedia (1901–1906) or Smith’s (1889), give resource and query (or a page key returned by this tool). The server selects the same release as the reader. Otherwise read an approved outside source: only the sites on the owner's whitelist (such as israelunite.org, Wikipedia, archive.org, Project Gutenberg, the Library of Congress). Give a query to search Wikipedia, or the address of a page on an approved site. Use it only after the app's own data and the classes, for history, places and people the app does not cover yet (the Apocrypha's people among them). Outside sources inform the history; they never overrule the Scripture or the classes. Cite what you use by its number.",
    input_schema: { type: "object", properties: { resource: { type: "string", enum: [...APPROVED_RESOURCE_IDS], description: "Approved bundled edition; never supply a release." }, key: { type: "string", description: "Optional page/volume/image key from an earlier result." }, query: { type: "string", description: "What to look up in the selected edition, or on Wikipedia without resource." }, url: { type: "string", description: "Optional: the https address of a page on an approved site." } }, required: [] },
  },
  {
    name: "timeline",
    description: "Search the app's Timeline: the Bible's history from creation through the kings, the captivities and the early church, and the Final Captivity (from the ships of 1441 to the twelve tribes today), each event with its dates, what happened, the classes' own words and their sources, and its picture where there is one. Give a name, a place, an event or a year. Call it for any question about when something happened or the history of the people.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A name, place, event or year." } }, required: ["query"] },
  },
];

type Line = (name: string, what: string, path: string) => string;
/** Numbers a source for citation, as the library's passages are; null when the list is full. */
export type AddSource = (p: Passage) => { n: number; fresh: boolean } | null;
type Tool = (env: Env, input: Record<string, unknown>, ctx: Exec | undefined, emit: (e: { status: string }) => void, line: Line, add: AddSource, resources?: ResourcePins) => Promise<{ content: string; error?: boolean }>;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (q: string) => norm(q).split(" ").filter((w) => w.length > 1);
/** How well a text matches the words asked: all of them, in the title first. */
const score = (q: string[], title: string, body = "") => {
  const t = norm(title), b = norm(body);
  let s = 0;
  for (const w of q) s += t.includes(w) ? 3 : b.includes(w) ? 1 : 0;
  return q.every((w) => t.includes(w) || b.includes(w)) ? s + 2 : s;
};
const year = (y: number) => (y < 0 ? `${-y} BC` : `AD ${y}`);
const yearSpan = (a: number, b?: number) => (b != null && b !== a ? `${year(a)} to ${year(b)}` : year(a));

/** A picture the app serves, only if it is there. */
async function picture(env: Env, path: string): Promise<string | null> {
  try {
    const r = await (env as unknown as { ASSETS?: { fetch: (r: Request) => Promise<Response> } }).ASSETS?.fetch(new Request(`https://assets.local/app/${path}`, { method: "HEAD" }));
    return r?.ok ? `/${path}` : null;
  } catch { return null; }
}

type EastonEntry = { slug: string; term: string; definitions: string[] };
type StrongsDefinition = { number: string; language: string; lemma: string; xlit: string; pron?: string; derivation?: string; def: string; kjv?: string };
type StrongsRow = { n: string; lemma: string; xlit: string; def: string; count: number };

const lookUpWord: Tool = async (env, input, ctx, emit, line, add, resources = {}) => {
  const word = str(input.word, 60);
  if (!word) return { content: "Give a word, a name or a Strong's number.", error: true };
  emit({ status: `Looking up “${word}”` });
  const out: string[] = [];
  const num = /^[HG]\d{1,5}$/i.test(word) ? word.toUpperCase() : null;
  if (num) {
    const s = resources.strongs ? await pinnedRecord<StrongsDefinition>(env, resources, "strongs", `entry/${num}`) : await dataJson<{ number: string; language: string; lemma: string; xlit: string; pron?: string; derivation?: string; def: string; kjv?: string }>(env, `/api/strongs/${num}.json`, ctx).catch(() => null);
    if (s) out.push(line(`Strong's ${s.number} (${s.language}) ${s.lemma} · ${s.xlit}${s.pron ? ` (${s.pron})` : ""}`, `${s.def}${s.derivation ? ` Derivation: ${s.derivation}` : ""}${s.kjv ? ` In the KJV: ${s.kjv}` : ""}`, resources.strongs ? resourceLink("strongs", resources.strongs, `entry/${num}`) : `/strongs/${num}`));
  } else {
    const e = eastonLookup(word) ?? (easton as EastonEntry[]).find((x) => norm(x.term) === norm(word)) ?? null;
    if (e) out.push(line(`Easton's Bible Dictionary: ${e.term}`, e.definitions.join(" ").slice(0, 2400), `/dictionary/${e.slug}`));
    const idx = resources.strongs ? await pinnedRecord<StrongsRow[]>(env, resources, "strongs", "index") : await dataJson<StrongsRow[]>(env, "/api/strongs/index.json", ctx).catch(() => null);
    const w = norm(word);
    const hits = (idx ?? []).filter((r) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "")}\\b`).test(norm(r.def)) || norm(r.xlit) === w).sort((a, b) => b.count - a.count).slice(0, 5);
    for (const r of hits) out.push(line(`Strong's ${r.n} ${r.lemma} · ${r.xlit}`, `${r.def} (${r.count} times in the KJV)`, resources.strongs ? resourceLink("strongs", resources.strongs, `entry/${r.n}`) : `/strongs/${r.n}`));
  }
  return { content: out.length ? out.join("\n") : `Nothing in Easton's or Strong's for “${word}”.` };
};

type PersonRef = { id: string; name: string };
type PersonFull = { id: string; name: string; names?: string[]; description?: string; type?: string; tribe?: string; first?: string; verses?: number; father?: PersonRef[]; mother?: PersonRef[]; siblings?: PersonRef[]; partners?: PersonRef[]; children?: PersonRef[]; summary?: string; classes?: unknown[] };

const person: Tool = async (env, input, ctx, emit, line) => {
  const name = str(input.name, 80);
  if (name.length < 2) return { content: "Give a name.", error: true };
  emit({ status: `Looking up ${name}` });
  let id = /^[a-z0-9-]+-\w+-\d+-\d+$|^[a-z0-9-]+$/.test(name) && name.includes("-") ? name : "";
  if (!id) {
    const idx = await dataJson<{ id: string; name: string; names?: string[]; verses?: number }[]>(env, "/api/people/index.json", ctx).catch(() => null);
    const n = norm(name);
    const best = (idx ?? []).filter((p) => norm(p.name) === n || (p.names ?? []).some((x) => norm(x) === n)).sort((a, b) => (b.verses ?? 0) - (a.verses ?? 0));
    if (best.length > 1) {
      return { content: `More than one person is named ${name}:\n${best.slice(0, 8).map((p) => line(p.name, `${p.verses ?? 0} verses.`, `/person/${encodeURIComponent(p.id)}`) + ` (id ${p.id})`).join("\n")}\nCall person again with the id of the one meant, or describe each.` };
    }
    id = best[0]?.id ?? "";
  }
  if (!id) {
    // The Apocrypha's people (and some others) are not in People yet: the dictionary may know them.
    const e = eastonLookup(name);
    return { content: e ? `${name} is not in the app's People yet. ${line(`Easton's Bible Dictionary: ${e.term}`, e.definitions.join(" ").slice(0, 2000), `/dictionary/${e.slug}`)} If more is needed, use outside_source.` : `No one named ${name} in the app's People or the dictionary. Try search_library, then outside_source.` };
  }
  const p = await dataJson<PersonFull>(env, `/api/people/${id}.json`, ctx).catch(() => null);
  if (!p) return { content: `${name}'s entry could not be read just now.`, error: true };
  const fam = (label: string, list?: PersonRef[]) => (list?.length ? `${label}: ${list.map((x) => x.name).join(", ")}.` : "");
  const pic = await picture(env, `people/${p.id}-256.webp`);
  const text = [p.description ? `${p.description}.` : "", p.names && p.names.length > 1 ? `Also called: ${p.names.join(", ")}.` : "", p.tribe ? `Tribe or people: ${p.tribe}.` : "", fam("Father", p.father), fam("Mother", p.mother), fam("Brothers and sisters", p.siblings), fam("Husbands and wives", p.partners), fam("Children", p.children), p.first ? `First named at ${p.first.replace(/\//g, " ")}.` : "", p.verses ? `Named in ${p.verses} verses.` : "", p.summary ?? "", pic ? `Picture: ${pic}` : ""].filter(Boolean).join(" ");
  return { content: line(p.name, text, `/person/${encodeURIComponent(p.id)}`) };
};

type CitedBy = { kind: string; label: string; url: string; verses: string; t?: number; video?: string };

const verseStudy: Tool = async (env, input, ctx, emit, line) => {
  const reference = str(input.reference, 60);
  const m = /^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(reference);
  if (!m) return { content: `"${reference}" is not a reference. Use the book and chapter, like "Isaiah 61:1".`, error: true };
  const books = await dataJson<{ book: string; slug: string }[]>(env, "/api/kjv/books.json", ctx).catch(() => null);
  const b = books?.find((x) => norm(x.book) === norm(m[1])) ?? books?.find((x) => norm(x.book).startsWith(norm(m[1])));
  if (!b) return { content: `No book called ${m[1]}.`, error: true };
  const ch = +m[2], v = m[3] ? +m[3] : null, to = m[4] ? +m[4] : v;
  emit({ status: `Studying ${b.book} ${ch}${v ? `:${v}` : ""}` });
  const [conc, xref] = await Promise.all([
    dataJson<{ cited_by: CitedBy[] }>(env, `/api/concordance/${b.slug}/${ch}.json`, ctx).catch(() => null),
    dataJson<Record<string, unknown>>(env, `/api/xref/${b.slug}/${ch}.json`, ctx).catch(() => null),
  ]);
  const covers = (vs: string) => {
    if (v == null || !vs) return true;
    const [a, z] = vs.split("-").map(Number);
    return (z ?? a) >= v && a <= (to ?? v);
  };
  const cited = (conc?.cited_by ?? []).filter((c) => covers(c.verses));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of cited) {
    const k = `${c.kind}|${c.url}`;
    if (seen.has(k)) continue; seen.add(k);
    lines.push(line(`${c.kind === "note" ? "Study note" : c.kind === "class" ? "Class" : c.kind[0].toUpperCase() + c.kind.slice(1)}: ${c.label}`, c.verses ? `Verses ${c.verses}.` : "", c.url));
    if (lines.length >= 14) break;
  }
  const refsOf = (o: unknown): string[] => {
    if (!o || typeof o !== "object") return [];
    const at = v != null ? (o as Record<string, unknown>)[String(v)] : null;
    const list = Array.isArray(at) ? at : [];
    return list.map((r) => (typeof r === "string" ? r : (r as { label?: string; ref?: string }).label ?? (r as { ref?: string }).ref ?? "")).filter(Boolean).slice(0, 12);
  };
  const xr = refsOf((xref as { verses?: unknown })?.verses ?? xref);
  if (xr.length) lines.push(`Cross-references: ${xr.join("; ")}.`);
  return { content: lines.length ? lines.join("\n") : `The app has no classes, notes or precepts placed on ${b.book} ${ch}${v ? `:${v}` : ""} yet.` };
};

type LawIndex = { n: number; title: string; url: string; sections: { id: string; title: string; laws: number; url: string }[] }[];
type LawSection = { id: string; title: string; url: string; entries: { id: string; text: string; refs?: { book: string; chapter: number; verses?: string }[] }[] };

const law: Tool = async (env, input, ctx, emit, line) => {
  const query = str(input.query, 80);
  if (!query) return { content: "Give a subject or a section id.", error: true };
  emit({ status: `Reading the law on “${query}”` });
  const idx = await dataJson<LawIndex>(env, "/api/laws/index.json", ctx).catch(() => null);
  if (!idx) return { content: "The law handbook could not be read just now.", error: true };
  const sections = idx.flatMap((p) => p.sections.map((s) => ({ ...s, part: p.title })));
  const q = words(query);
  const pick = /^\d+[A-Z]$/i.test(query) ? sections.filter((s) => s.id.toUpperCase() === query.toUpperCase()) : sections.map((s) => ({ s, k: score(q, s.title, s.part) })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k).slice(0, 2).map((x) => x.s);
  if (!pick.length) return { content: `No section of the law handbook on “${query}”. Search the library instead.` };
  const out: string[] = [];
  for (const s of pick) {
    const full = await dataJson<LawSection>(env, `/api/laws/${s.id.toUpperCase()}.json`, ctx).catch(() => null);
    const laws = (full?.entries ?? []).slice(0, 18).map((e) => `${e.id} ${e.text}${e.refs?.length ? ` (${e.refs.map((r) => `${r.book} ${r.chapter}${r.verses ? `:${r.verses}` : ""}`).join("; ")})` : ""}`);
    out.push(`${line(`The Law, ${s.part}: ${s.title} (${s.id})`, `${laws.length} laws.`, s.url)}\n${laws.join("\n")}`);
  }
  return { content: out.join("\n\n") };
};

type PreceptTopic = { title: string; slug: string; refs: { label: string; url: string; text?: { verse: number; text: string }[] }[] };

const precepts: Tool = async (env, input, ctx, emit, line) => {
  const topic = str(input.topic, 60);
  if (!topic) return { content: "Give a subject.", error: true };
  emit({ status: `Gathering the precepts on “${topic}”` });
  const idx = await dataJson<{ slug: string; title: string; url: string }[]>(env, "/api/precepts/index.json", ctx).catch(() => null);
  const q = words(topic);
  const best = (idx ?? []).map((t) => ({ t, k: score(q, t.title, t.slug) })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k)[0]?.t;
  if (!best) return { content: `No precept topic on “${topic}”. The topics include: ${(idx ?? []).slice(0, 40).map((t) => t.title).join(", ")}.` };
  const full = await dataJson<PreceptTopic>(env, `/api/precepts/${best.slug}.json`, ctx).catch(() => null);
  const refs = (full?.refs ?? []).slice(0, 14).map((r) => `${r.label}: ${(r.text ?? []).map((t) => t.text).join(" ")}`);
  return { content: `${line(`Precepts: ${best.title}`, `${refs.length} scriptures.`, best.url)}\n${refs.join("\n")}` };
};

type TlEvent = { slug: string; title: string; start: number; end?: number; portrait?: string; leader?: string; cases?: { slug: string; name: string }[]; fc?: boolean };
type FcDetail = { title: string; summary: string; date?: { text: string }; place?: string; tribes?: string[]; account?: string[]; teaching?: { quote?: string; points?: string[]; teacher?: string; source: { title: string; url: string; ts?: string } }[]; sources?: { title: string; url?: string }[]; image?: { src: string; caption: string } };

const TL: (TlEvent & { section: string })[] = (timeline as { sections: { title: string; events: TlEvent[] }[] }).sections.flatMap((s) => s.events.map((e) => ({ ...e, section: s.title })));
const FC = finalCaptivity as Record<string, FcDetail>;

const timelineTool: Tool = async (env, input, _ctx, emit, line) => {
  const query = str(input.query, 80);
  if (!query) return { content: "Give a name, place, event or year.", error: true };
  emit({ status: `Searching the Timeline for “${query}”` });
  const yr = /^(\d{1,4})\s*(bc|ad)?$/i.exec(query);
  const q = words(query);
  const hits = TL.map((e) => {
    const d = FC[e.slug];
    let k = yr ? (Math.abs((/bc/i.test(yr[2] ?? "") ? -1 : 1) * +yr[1] - e.start) <= 2 ? 5 : 0) : score(q, e.title, `${e.section} ${(e.cases ?? []).map((c) => c.name).join(" ")} ${d ? `${d.summary} ${d.place ?? ""} ${(d.tribes ?? []).join(" ")}` : ""}`);
    if (d && k) k += 1;
    return { e, d, k };
  }).filter((x) => x.k > 0).sort((a, b) => b.k - a.k).slice(0, 6);
  if (!hits.length) return { content: `Nothing on the Timeline for “${query}”.` };
  const out: string[] = [];
  for (const { e, d } of hits) {
    const pic = e.portrait ? await picture(env, `people/${e.portrait}-256.webp`) : e.leader ? await picture(env, `timeline/leaders/${e.leader}-256.webp`) : null;
    if (d) {
      const teach = (d.teaching ?? []).filter((t) => t.quote).slice(0, 2).map((t) => `“${t.quote}” (${t.teacher ? `${t.teacher}, ` : ""}${t.source.title}${t.source.ts ? ` at ${t.source.ts}` : ""}, ${t.source.url})`).join(" ");
      out.push(line(`Timeline (${e.section}): ${d.title}`, `${d.date?.text ?? yearSpan(e.start, e.end)}${d.place ? `, ${d.place}` : ""}. ${d.tribes?.length ? `Tribes: ${d.tribes.join(", ")}. ` : ""}${d.summary} ${(d.account ?? []).join(" ").slice(0, 900)}${teach ? ` From the classes: ${teach}` : ""}${d.sources?.length ? ` Sources: ${d.sources.slice(0, 3).map((s) => s.title).join("; ")}.` : ""}${d.image ? ` Picture: ${d.image.src} (${d.image.caption})` : pic ? ` Picture: ${pic}` : ""}`, `/timeline/event/${e.slug}`));
    } else {
      out.push(line(`Timeline (${e.section}): ${e.title}`, `${yearSpan(e.start, e.end)}.${e.cases?.length ? ` Case studies: ${e.cases.map((c) => `${c.name} (/cases/${c.slug})`).join(", ")}.` : ""}${pic ? ` Picture: ${pic}` : ""}`, `/timeline/event/${e.slug}`));
    }
  }
  return { content: out.join("\n") };
};

export const MORE_RUN: Record<string, Tool> = { look_up_word: lookUpWord, person, verse_study: verseStudy, law, precepts, timeline: timelineTool };

/**
 * The outside sources Ask may read: the owner's whitelist (KV "ask:sources", set by an admin with
 * PUT /api/admin/ask-sources), or this starting list. A site is allowed with its subdomains; only
 * https, only GET, and the page is read as text, never run.
 */
export const DEFAULT_SOURCES = ["israelunite.org", "wikipedia.org", "archive.org", "gutenberg.org", "loc.gov", "archives.gov", "nps.gov", "si.edu", "blackpast.org", "slavevoyages.org", "jewishencyclopedia.com", "sacred-texts.com", "ccel.org"];
export const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export async function approvedSources(env: Env): Promise<string[]> {
  const kv = await env.SUBS.get("ask:sources", "json").catch(() => null);
  return Array.isArray(kv) && kv.every((h) => typeof h === "string" && HOST.test(h)) ? (kv as string[]) : DEFAULT_SOURCES;
}
export const isApproved = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const textOf = (html: string) => html.replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
/** The paragraphs that answer the words asked, in page order, up to max characters. */
function excerpt(text: string, query: string, max: number) {
  const q = words(query);
  const paras = text.split(/\n{1,2}/).map((p) => p.trim()).filter((p) => p.length > 60);
  const picked = q.length ? paras.filter((p) => q.some((w) => norm(p).includes(w))) : paras;
  let out = "";
  for (const p of (picked.length ? picked : paras)) { if (out.length + p.length > max) break; out += (out ? "\n" : "") + p; }
  return out || text.slice(0, max);
}

const outsideSource: Tool = async (env, input, _ctx, emit, _line, add, resources = {}) => {
  const edition = approvedEditionUrl(str(input.url, 400));
  const requested = str(input.resource, 80) || (edition && resources[edition.id] ? edition.id : "");
  if (requested) {
    if (!(APPROVED_RESOURCE_IDS as readonly string[]).includes(requested)) return { content: "That resource is not approved.", error: true };
    const id = requested as keyof ResourcePins, release = resources[id];
    if (!release) return { content: "This resource has not been selected or published for this reader. Existing outside-source URLs remain available.", error: true };
    if (id === "strongs") return lookUpWord(env, { word: input.query }, _ctx, emit, _line, add, resources);
    emit({ status: `Reading ${requested.replaceAll("-", " ")}` });
    try {
      const rows = await resourcePages(env, resources, id, str(input.query, 120), str(input.key, 100) || edition?.key);
      const lines = rows.map(({ key, data }) => {
        const text = excerpt(data.text, str(input.query, 120), 2600), url = resourceLink(id, release, key);
        const citation = add({ kind: "book", title: data.title, url, sub: `Original edition · OCR · ${release}`, text: text.slice(0, 1400) });
        return `${citation ? `[${citation.n}] ` : ""}${data.title} (${url})\n${text}`;
      });
      return { content: lines.length ? `${lines.join("\n\n")}\nOriginal-edition OCR may contain errors. Search is limited to candidate pages; use a returned page key for a specific page. Check the scan before relying on dates, names or verse numbers. These sources never overrule Scripture or the classes.` : "No candidate pages found in this selected edition. This bounded search is not an exhaustive finding." };
    } catch { return { content: "The selected resource release could not be read. No other edition was substituted.", error: true }; }
  }
  const list = await approvedSources(env);
  const query = str(input.query, 120), url = str(input.url, 400);
  const lines: string[] = [];
  const cite = (title: string, href: string, host: string, text: string) => {
    const a = add({ kind: "web", title, url: href, sub: host, text: text.slice(0, 1400) });
    lines.push(`${a ? `[${a.n}] ` : ""}${title} (${host}, ${href})\n${text}`);
  };
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch { return { content: "That is not a web address.", error: true }; }
    if (u.protocol !== "https:" || !isApproved(u.hostname, list)) return { content: `${u.hostname} is not an approved source. Approved: ${list.join(", ")}.`, error: true };
    emit({ status: `Reading ${u.hostname}` });
    const r = await fetch(u.toString(), { headers: { "user-agent": "CyberJudah/1.0 (+https://cyberjudah.io)", accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(8000) }).catch(() => null);
    const final = r ? new URL(r.url || u.toString()) : null;
    if (!r?.ok || !final || !isApproved(final.hostname, list)) return { content: `${u.hostname} could not be read just now.`, error: true };
    const body = (await r.text()).slice(0, 1_500_000);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim() ?? final.hostname;
    cite(textOf(title), final.toString(), final.hostname, excerpt(textOf(body), query, 2600));
  } else {
    if (!query) return { content: "Give a query or an address.", error: true };
    if (!isApproved("en.wikipedia.org", list)) return { content: `Wikipedia is not on the approved list. Give the address of a page on: ${list.join(", ")}.`, error: true };
    emit({ status: `Looking up “${query}” in approved sources` });
    const api = (p: string) => fetch(`https://en.wikipedia.org/w/api.php?format=json&formatversion=2&${p}`, { headers: { "user-agent": "CyberJudah/1.0 (+https://cyberjudah.io)" }, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<Record<string, any> | null>;
    const found = await api(`action=query&list=search&srlimit=2&srsearch=${encodeURIComponent(query)}`);
    const titles: string[] = (found?.query?.search ?? []).map((x: { title: string }) => x.title);
    if (!titles.length) return { content: `Nothing on Wikipedia for “${query}”.` };
    const pages = await api(`action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(titles.join("|"))}`);
    for (const p of pages?.query?.pages ?? []) {
      if (!p.extract) continue;
      cite(`${p.title} (Wikipedia)`, `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, "_"))}`, "en.wikipedia.org", excerpt(p.extract, query, 2400));
    }
  }
  return { content: lines.length ? `${lines.join("\n\n")}\n\nThese are outside sources: use them for history and facts, cite them by number, and never set them above the Scripture or the classes.` : "Nothing found in the approved sources." };
};
MORE_RUN.outside_source = outsideSource;
