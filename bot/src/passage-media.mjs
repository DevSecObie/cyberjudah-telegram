/**
 * The Bible Strong reader's inline videos, filled with CyberJudah classes: every moment a class
 * taught a verse becomes a thumbnail after that verse, opening the recording at that moment.
 * The shape is Bible Strong's passage-media catalog, one chapter at a time
 * (strong/apps/expo/src/features/bible/passageMedia.ts).
 */

// Book numbers as the Bible Strong feed numbers them: 1-66 in the usual order, then the
// Apocrypha in the order of the 1611 edition. The values are the data set's slugs.
export const SLUGS = [
  "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua", "judges", "ruth", "1-samuel", "2-samuel",
  "1-kings", "2-kings", "1-chronicles", "2-chronicles", "ezra", "nehemiah", "esther", "job", "psalms", "proverbs",
  "ecclesiastes", "song-of-solomon", "isaiah", "jeremiah", "lamentations", "ezekiel", "daniel", "hosea", "joel", "amos",
  "obadiah", "jonah", "micah", "nahum", "habakkuk", "zephaniah", "haggai", "zechariah", "malachi", "matthew",
  "mark", "luke", "john", "acts", "romans", "1-corinthians", "2-corinthians", "galatians", "ephesians", "philippians",
  "colossians", "1-thessalonians", "2-thessalonians", "1-timothy", "2-timothy", "titus", "philemon", "hebrews", "james", "1-peter",
  "2-peter", "1-john", "2-john", "3-john", "jude", "revelation",
  "1-esdras", "2-esdras", "tobit", "judith", "esther-greek", "wisdom-of-solomon", "sirach", "baruch",
  "epistle-of-jeremiah", "song-of-the-three-children", "susanna", "bel-and-the-dragon", "prayer-of-manasseh",
  "1-maccabees", "2-maccabees",
];

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The Bishops' and Deacons' teaching comes first, then everyone else; newest first within each.
const rank = (teacher = "") => (/^bishop\b/i.test(teacher) ? 0 : /^deacon\b/i.test(teacher) ? 1 : 2);
const day = (date = "") => {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};
/** "26-28" → [26, 28]; "3,5-7" → [3, 7]: the thumbnail goes after the last verse taught. */
const span = (verses = "") => {
  const nums = verses.match(/\d+/g)?.map(Number).filter((n) => n > 0);
  return nums?.length ? [Math.min(...nums), Math.max(...nums)] : null;
};

export const emptyCatalog = () => ({
  attribution: { label: "CyberJudah", url: "https://cyberjudah.io", termsUrl: "https://cyberjudah.io" },
  works: [],
  indexes: { chapters: {}, strongs: {}, library: [] },
});

/**
 * The catalog for one chapter, as the app has always shown its classes (app/src/lib/taught.ts):
 * after each verse, every class that taught it (Bishops, then Deacons, then others, newest
 * first), then every other class that read it aloud in a recording; and at the end of the
 * chapter, each recording once, those that taught it ("classroom") before those that read it
 * ("read-aloud").
 * @param {number} book @param {number} chapter
 * @param {{ verses?: string, label?: string, date?: string, teacher?: string, video?: string, t?: number, ts?: string }[]} list
 * @param {Record<string, { video?: string, t?: number, ts?: string, title?: string, date?: string, teacher?: string }[]>} [read]
 */
export function buildCatalog(book, chapter, list, read = {}) {
  const catalog = emptyCatalog();
  const ok = (m) => VIDEO.test(m.video ?? "") && Number.isInteger(m.t) && m.t >= 0;
  const order = (a, b) => rank(a.teacher) - rank(b.teacher) || (b.date ?? "").localeCompare(a.date ?? "") || a.t - b.t;
  const moments = (list ?? []).filter((m) => ok(m) && span(m.verses)).sort(order);
  const readings = Object.entries(read ?? {})
    .flatMap(([verse, rows]) => (/^\d+$/.test(verse) && Number(verse) > 0 ? (rows ?? []).map((r) => ({ ...r, label: r.title, verses: verse })) : []))
    .filter(ok)
    .sort(order);

  /** @type {Map<string, any>} */
  const works = new Map();
  const atVerse = new Set();
  const inChapter = new Set();
  const taught = new Set(moments.map((m) => m.video));
  const add = (m, category) => {
    const [start, end] = span(m.verses);
    // A recording once after each verse, at its best-ranked moment there.
    if (atVerse.has(`${end}:${m.video}`)) return;
    atVerse.add(`${end}:${m.video}`);
    const id = `cj-${m.video}-${m.t}`;
    let work = works.get(id);
    if (!work) {
      const subtitle = [m.teacher, day(m.date)].filter(Boolean).join(" · ");
      work = {
        id,
        categories: [category],
        editions: {
          en: {
            id: `${id}:en`, language: "en", provider: "youtube", providerId: m.video,
            sourceUrl: `https://www.youtube.com/watch?v=${m.video}&t=${m.t}s`,
            title: m.label || "Class", thumbnailUrl: `https://i.ytimg.com/vi/${m.video}/mqdefault.jpg`,
            blurHash: "", durationSeconds: 0, startSeconds: m.t, badge: m.ts || "", subtitle,
          },
        },
        anchors: [],
      };
      works.set(id, work);
    }
    work.anchors.push({ kind: "passage", book, chapterStart: chapter, chapterEnd: chapter, verseStart: start, verseEnd: end, placement: "after-range", relevance: "primary" });
    // Each recording once in the chapter's list.
    if (!inChapter.has(m.video)) {
      inChapter.add(m.video);
      work.anchors.push({ kind: "passage", book, chapterStart: chapter, chapterEnd: chapter, placement: "chapter-resources", relevance: "primary" });
    }
  };
  for (const m of moments) add(m, "classroom");
  for (const r of readings) add(r, taught.has(r.video) ? "classroom" : "read-aloud");
  catalog.works = [...works.values()];
  catalog.indexes.chapters[`${book}:${chapter}`] = catalog.works.map((w) => w.id);
  return catalog;
}
