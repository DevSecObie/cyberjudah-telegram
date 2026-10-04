import { createHash } from "node:crypto";
import { references, searchWords } from "./references.mjs";

// Preserve this existing reader-visible attribution word for word.
export const STRONGS_ATTRIBUTION = "Strong's Exhaustive Concordance (1890) and Concise Dictionaries (1894), public domain; JSON by Open Scriptures (CC BY-SA).";
export const upstreamHeader = (text) => text.slice(0, text.indexOf("*/") + 2);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function convertStrongs(inputs, books, bible) {
  const dict = { ...inputs.get("data/strongs/hebrew.json"), ...inputs.get("data/strongs/greek.json") };
  // Compare the existing import to pinned upstream without correcting its fields.
  for (const language of ["hebrew", "greek"]) {
    const text = inputs.get(`upstream/${language}/strongs-${language}-dictionary.js`);
    const upstream = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const converted = Object.fromEntries(Object.entries(upstream).map(([key, e]) => [key, { lemma: e.lemma ?? "", xlit: e.xlit ?? "", pron: e.pron ?? "", derivation: e.derivation ?? "", def: e.strongs_def ?? "", kjv: e.kjv_def ?? "" }]));
    if (JSON.stringify(converted) !== JSON.stringify(inputs.get(`data/strongs/${language}.json`))) throw new Error(`Pinned ${language} import differs from upstream; review before conversion`);
  }
  const occurrences = new Map(), rendered = new Map();
  for (const b of books) {
    const tags = inputs.get(`data/strongs/tags/${b.slug}.json`);
    if (!tags) continue;
    for (const [ch, verses] of Object.entries(tags)) for (const [v, spans] of Object.entries(verses)) for (const [text, numbers] of spans) {
      const word = text.replace(/[^A-Za-z' -]/g, "").trim();
      for (const n of numbers) {
        if (!occurrences.has(n)) { occurrences.set(n, []); rendered.set(n, new Map()); }
        const list = occurrences.get(n), last = list.at(-1);
        if (last && last.slug === b.slug && last.chapter === Number(ch) && last.verse === Number(v)) last.words.push(word);
        else list.push({ slug: b.slug, book: b.book, chapter: Number(ch), verse: Number(v), words: [word] });
        const counts = rendered.get(n); counts.set(word.toLowerCase(), (counts.get(word.toLowerCase()) ?? 0) + 1);
      }
    }
  }
  const records = [], index = [], unclearReferences = [];
  let scriptureLinks = 0;
  for (const [n, entry] of Object.entries(dict)) {
    const list = occurrences.get(n) ?? [], count = list.reduce((sum, row) => sum + row.words.length, 0);
    const words = [...(rendered.get(n) ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));
    const complete = list.map((o) => ({ slug: o.slug, book: o.book, chapter: o.chapter, verse: o.verse, text: bible[o.slug]?.[String(o.chapter)]?.[o.verse - 1] ?? "", words: o.words }));
    const revision = digest(complete), pages = Math.max(1, Math.ceil(complete.length / 600));
    const data = { number: n, language: n[0] === "H" ? "Hebrew" : "Greek", ...entry, count, verses: list.length, words, occurrences: complete.slice(0, 600), occurrencePages: { revision, pageSize: 600, pages, nextPage: pages > 1 ? 1 : null }, source: STRONGS_ATTRIBUTION };
    const scripture = {};
    for (const field of ["def", "derivation", "kjv"]) {
      const refs = references(entry[field], books, bible);
      if (refs.links.length) scripture[field] = refs.links;
      scriptureLinks += refs.links.length;
      for (const candidate of refs.unclear) unclearReferences.push({ key: `entry/${n}`, field, ...candidate });
    }
    if (Object.keys(scripture).length) data.scripture = scripture;
    records.push({ key: `entry/${n}`, data });
    for (let page = 1; page < pages; page++) records.push({ key: `occurrences/${n}/${revision}/${page}`, data: { number: n, revision, page, total: complete.length, occurrences: complete.slice(page * 600, (page + 1) * 600), nextPage: page + 1 < pages ? page + 1 : null } });
    index.push({ n, lemma: entry.lemma, xlit: entry.xlit, def: (entry.def || entry.kjv || "").slice(0, 90), count });
  }
  records.push({ key: "index", data: index });
  return { records, report: { entries: index.length, occurrences: [...occurrences.values()].reduce((n, rows) => n + rows.length, 0), scriptureLinks, unclearReferenceCandidates: unclearReferences.length, unclearReferences, ocr: "No OCR performed: verified existing lexicon fields against the pinned upstream JSON conversion." } };
}

export function convertBook(id, inputs, books, bible) {
  const book = inputs.get(`data/library/${id}/book.json`), records = [], postings = new Map();
  const report = { pages: 0, scriptureLinks: 0, unclearReferenceCandidates: 0, unclearPages: [], emptyPages: [], volumes: {} };
  for (const [name, pages] of [...inputs].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    if (!/\/pages(?:-v\d+)?\.json$/.test(name)) continue;
    for (const p of pages) {
      const key = `page/${p.vol}/${p.img}`, scan = book.scan.replace("{id}", book.items[p.vol - 1].id).replace("{img}", String(p.img));
      const refs = references(p.text, books, bible);
      const data = { title: `${book.title} — ${book.volumes > 1 ? `vol. ${p.vol}, ` : ""}p. ${p.page}`, volume: p.vol, page: p.page, image: p.img, text: p.text, scan, links: refs.links, unclear: refs.unclear };
      records.push({ key, data });
      for (const word of searchWords(p.text)) {
        if (!postings.has(word)) postings.set(word, { keys: [], total: 0 });
        const posting = postings.get(word); posting.total++;
        if (posting.keys.length < 40) posting.keys.push(key);
      }
      report.pages++; report.volumes[p.vol] = (report.volumes[p.vol] ?? 0) + 1;
      report.scriptureLinks += refs.links.length; report.unclearReferenceCandidates += refs.unclear.length;
      if (refs.unclear.length) report.unclearPages.push({ key, scan, count: refs.unclear.length });
      if (!p.text.trim()) report.emptyPages.push({ key, scan });
    }
  }
  for (const [word, posting] of postings) records.push({ key: `search/${word}`, data: posting });
  records.push({ key: "book", data: book });
  records.push({ key: "pages", data: records.filter((r) => r.key.startsWith("page/")).map((r) => ({ key: r.key, volume: r.data.volume, page: r.data.page, image: r.data.image, title: r.data.title })) });
  return { records, report };
}
