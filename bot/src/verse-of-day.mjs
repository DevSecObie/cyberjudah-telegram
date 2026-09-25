/**
 * The verse of the day: one of these, chosen by the UTC date, so the cron, the bot and the
 * app all agree without storing anything. The list is the school's own emphasis: the law,
 * the precepts, study, the Sabbath and the promises.
 */
export const VERSES = [
  ["psalms", 119, 105], ["proverbs", 4, 7], ["isaiah", 28, 10], ["jeremiah", 6, 16], ["2-timothy", 2, 15],
  ["micah", 6, 8], ["deuteronomy", 7, 6], ["hosea", 4, 6], ["psalms", 19, 7], ["psalms", 1, 2],
  ["joshua", 1, 8], ["isaiah", 1, 18], ["ecclesiastes", 12, 13], ["matthew", 5, 17], ["john", 14, 15],
  ["revelation", 14, 12], ["deuteronomy", 28, 1], ["psalms", 23, 1], ["isaiah", 58, 13], ["proverbs", 3, 5],
  ["daniel", 12, 3], ["amos", 3, 3], ["malachi", 3, 6], ["genesis", 1, 1], ["exodus", 20, 8],
  ["leviticus", 19, 18], ["psalms", 91, 1], ["isaiah", 40, 31], ["james", 1, 22], ["hebrews", 4, 12],
  ["john", 8, 32], ["psalms", 119, 11],
];

/** "2-timothy" -> "2 Timothy"; "song-of-solomon" -> "Song of Solomon". */
export function bookLabel(slug) {
  return String(slug).split("-").map((w, i) => (i && (w === "of" || w === "the" || w === "and") ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

/** The reference for a UTC date (any Date, or a "YYYY-MM-DD" string), the same all day everywhere. */
export function verseOfDay(date = new Date()) {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const day = Math.floor(d.getTime() / 86400000);
  const [slug, chapter, verse] = VERSES[((day % VERSES.length) + VERSES.length) % VERSES.length];
  return { ref: `${bookLabel(slug)} ${chapter}:${verse}`, slug, chapter, verse };
}
