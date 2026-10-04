/**
 * A scripture reference as a person types it to the bot: "john 3:16", "1 kings 8:22-27",
 * "ps 23", "song of solomon 2", "2 tim 2:15". Book names come from the data set's books.json
 * (name and slug); the aliases cover the usual abbreviations and, failing those, the first
 * book in canonical order whose name starts with what was typed ("gen", "matt", "rev").
 */

const ALIASES = {
  gn: "genesis", ex: "exodus", exo: "exodus", lv: "leviticus", nm: "numbers", nu: "numbers", dt: "deuteronomy", jos: "joshua",
  jdg: "judges", jgs: "judges", ru: "ruth", sa: "1-samuel", sam: "1-samuel", kg: "1-kings", kgs: "1-kings", ki: "1-kings",
  ch: "1-chronicles", chr: "1-chronicles", chron: "1-chronicles", ne: "nehemiah", es: "esther", est: "esther", jb: "job",
  ps: "psalms", psa: "psalms", psalm: "psalms", pr: "proverbs", prv: "proverbs", ec: "ecclesiastes", ecc: "ecclesiastes", eccl: "ecclesiastes",
  qoh: "ecclesiastes", song: "song-of-solomon", songs: "song-of-solomon", sos: "song-of-solomon", canticles: "song-of-solomon",
  songofsongs: "song-of-solomon", is: "isaiah", isa: "isaiah", je: "jeremiah", jer: "jeremiah", la: "lamentations", lam: "lamentations",
  eze: "ezekiel", ezk: "ezekiel", dn: "daniel", da: "daniel", ho: "hosea", jl: "joel", am: "amos", ob: "obadiah", obad: "obadiah",
  jon: "jonah", mi: "micah", mic: "micah", na: "nahum", hab: "habakkuk", zep: "zephaniah", zph: "zephaniah", hg: "haggai",
  zec: "zechariah", zch: "zechariah", ml: "malachi", mt: "matthew", mat: "matthew", mk: "mark", mr: "mark", lk: "luke", jn: "john",
  jhn: "john", joh: "john", ac: "acts", ro: "romans", rm: "romans", co: "1-corinthians", cor: "1-corinthians", ga: "galatians",
  ep: "ephesians", php: "philippians", phil: "philippians", pp: "philippians", col: "colossians", th: "1-thessalonians",
  thes: "1-thessalonians", thess: "1-thessalonians", ti: "1-timothy", tim: "1-timothy", tm: "1-timothy", tit: "titus",
  phm: "philemon", phlm: "philemon", philem: "philemon", he: "hebrews", heb: "hebrews", ja: "james", jas: "james", jam: "james",
  pe: "1-peter", pet: "1-peter", pt: "1-peter", jud: "jude", re: "revelation", rev: "revelation", rv: "revelation",
  apocalypse: "revelation", esd: "1-esdras", tob: "tobit", tb: "tobit", jdt: "judith", jth: "judith", wis: "wisdom-of-solomon",
  wisdom: "wisdom-of-solomon", sir: "sirach", ecclesiasticus: "sirach", ecclus: "sirach", bar: "baruch", sus: "susanna",
  bel: "bel-and-the-dragon", mac: "1-maccabees", macc: "1-maccabees", ma: "1-maccabees",
};

const ORDINAL = { 1: "1", 2: "2", 3: "3", i: "1", ii: "2", iii: "3", first: "1", second: "2", third: "3" };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The books.json row for a name as typed, or null. `books` is `${DATA_ORIGIN}/api/kjv/books.json`. */
export function findBook(name, books) {
  // Full names such as Isaiah must not lose their initial I as a Roman ordinal.
  const full = books.find((b) => norm(b.book) === norm(String(name)));
  if (full) return full;
  const m = String(name).trim().toLowerCase().match(/^(?:(1|2|3|i{1,3}|first|second|third)[\s.]*)?([a-z][a-z .'-]*)$/);
  if (!m) return null;
  const num = m[1] ? ORDINAL[m[1]] : "";
  const word = norm(m[2]);
  if (!word) return null;
  const bySlug = (slug) => books.find((b) => b.slug === slug) ?? null;
  const plain = (b) => !/^\d/.test(b.slug);
  // The full name, then an alias (renumbered: "2 tim" -> 2-timothy), then a prefix of a name.
  const exact = books.find((b) => norm(b.book) === num + word);
  if (exact) return exact;
  const alias = ALIASES[word];
  if (alias) return bySlug(num ? `${num}-${alias.replace(/^\d-/, "")}` : alias);
  if (num) return books.find((b) => b.slug.startsWith(`${num}-`) && norm(b.book).slice(1).startsWith(word)) ?? null;
  return books.find((b) => plain(b) && norm(b.book).startsWith(word)) ?? books.find((b) => b.slug.startsWith("1-") && norm(b.book).slice(1).startsWith(word)) ?? null;
}

/**
 * `{ book, slug, chapter, verse?, verseEnd?, label }` for a typed reference within the book's
 * chapter count, or null when the text is not a reference (then it is a search).
 */
export function parseReference(query, books) {
  const m = String(query).trim().match(/^([1-3iI]{0,3}[\s.]*[A-Za-z][A-Za-z .'-]*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?\s*$/);
  if (!m) return null;
  const book = findBook(m[1], books);
  if (!book) return null;
  const chapter = Number(m[2]);
  if (chapter < 1 || chapter > book.chapters) return null;
  const out = { book: book.book, slug: book.slug, chapter, label: `${book.book} ${chapter}` };
  if (m[3]) {
    out.verse = Number(m[3]);
    if (out.verse < 1) return null;
    out.label += `:${out.verse}`;
    if (m[4]) {
      const end = Number(m[4]);
      if (end > out.verse) { out.verseEnd = end; out.label += `-${end}`; }
    }
  }
  return out;
}
