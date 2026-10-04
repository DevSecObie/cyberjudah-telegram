import { findBook, parseReference } from "../bot/src/refs.mjs";

const roman = (value) => {
  const digits = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let result = 0, previous = 0;
  for (const letter of [...value.toUpperCase()].reverse()) {
    const n = digits[letter]; if (!n) return null;
    result += n < previous ? -n : n; previous = n;
  }
  let rest = result, roundtrip = "";
  for (const [n, letters] of [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (rest >= n) { roundtrip += letters; rest -= n; }
  return roundtrip === value.toUpperCase() ? result : null;
};
/** Source text is never rewritten. Offsets annotate only references with valid KJV bounds. */
export function references(text, books, chapters) {
  const links = [], unclear = [];
  const pattern = /(?<![A-Za-z])((?:[1-3I]{1,3}[ .]+)?[A-Z][a-z]{1,20}(?:\s+(?:of|of the)\s+[A-Z][a-z]+)?\.?)\s+(\d{1,3}|[ivxlc]{1,8})[.:,]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/g;
  for (const match of text.matchAll(pattern)) {
    const chapter = /^\d+$/.test(match[2]) ? Number(match[2]) : roman(match[2]);
    const candidate = `${match[1]} ${chapter}:${match[3]}${match[4] ? `-${match[4]}` : ""}`;
    const ref = chapter ? parseReference(candidate, books) : null;
    // Prefix fallback is useful for typing, but is insufficient evidence in OCR.
    const name = match[1].replace(/\.$/, ""), book = findBook(name, books);
    const normalized = name.toLowerCase().replace(/^iii[ .]+/, "3").replace(/^ii[ .]+/, "2").replace(/^i[ .]+/, "1").replace(/[^a-z0-9]/g, "");
    const bookNames = books.map((b) => b.book.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const ambiguous = !bookNames.includes(normalized) && bookNames.filter((n) => n.startsWith(normalized)).length > 1;
    const count = ref && chapters[ref.slug]?.[String(ref.chapter)]?.length;
    const reversed = match[4] && Number(match[4]) < Number(match[3]);
    const crossChapter = /^\s*:\s*\d/.test(text.slice(match.index + match[0].length));
    if (!ref || !book || ambiguous || crossChapter || !count || !ref.verse || (ref.verseEnd ?? ref.verse) > count || reversed) {
      unclear.push({ start: match.index, end: match.index + match[0].length, text: match[0] }); continue;
    }
    links.push({ start: match.index, end: match.index + match[0].length, label: ref.label, slug: ref.slug, chapter: ref.chapter, verse: ref.verse, ...(ref.verseEnd ? { verseEnd: ref.verseEnd } : {}) });
  }
  return { links, unclear };
}

export function searchWords(text) {
  return [...new Set(text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]{3,40}/g) ?? [])];
}
