/** Quoted phrases retain all words; only unquoted terms drop common stop words. */
const STOP = new Set(["and", "or", "not", "the", "a", "of"]);
export const tokens = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).map((t) => t.replace(/^'+|'+$/g, "")).filter(Boolean);
export const quote = (t) => `"${t.replace(/"/g, '""')}"`;

/**
 * Words that mean the same thing in the library. A number is spoken as a word and written as a
 * figure ("twelve tribes", "12 tribes"), and the KJV spells a name one way in the Old Testament and
 * another in the New or the Apocrypha (Melchizedek, Melchisedec). Either finds both.
 */
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "hundred", "thousand"];
const NUMBER_FIGURES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "30", "40", "50", "100", "1000"];
const NAME_VARIANTS = [
  ["melchizedek", "melchisedec", "melchisedek"], ["elijah", "elias"], ["elisha", "eliseus"], ["noah", "noe"],
  ["isaiah", "esaias"], ["jeremiah", "jeremias", "jeremy"], ["hosea", "osee"], ["jonah", "jonas"], ["korah", "core"],
  ["uzziah", "ozias"], ["hezekiah", "ezekias"], ["zechariah", "zacharias"], ["rahab", "rachab"], ["boaz", "booz"],
  ["sarah", "sara"], ["canaan", "chanaan"], ["midian", "madian"], ["sidon", "zidon"], ["tyre", "tyrus"],
  ["ezra", "esdras"], ["tobit", "tobias"], ["sirach", "ecclesiasticus"], ["judah", "juda"], ["gomorrah", "gomorrha"],
  ["sodom", "sodoma"], ["jericho", "hiericho"], ["kish", "cis"], ["enoch", "henoch"], ["reuben", "ruben"],
];
const ALTERNATIVES = new Map();
NUMBER_WORDS.forEach((w, i) => { ALTERNATIVES.set(w, [w, NUMBER_FIGURES[i]]); ALTERNATIVES.set(NUMBER_FIGURES[i], [NUMBER_FIGURES[i], w]); });
for (const group of NAME_VARIANTS) for (const n of group) ALTERNATIVES.set(n, [n, ...group.filter((x) => x !== n)]);
/** A term and the words that mean the same in the library, the term first. */
export const alternatives = (t) => ALTERNATIVES.get(t) ?? [t];

export function parseQuery(q) {
  const phrases = [];
  const rest = q.replace(/"([^"]+)"/g, (_m, p) => {
    const words = tokens(p);
    if (words.length) phrases.push(words.join(" "));
    return " ";
  });
  return { phrases, terms: tokens(rest).filter((t) => !STOP.has(t)) };
}

