import { z } from 'zod';
import bible from './cms-bible.mjs';
import { checkEvent, GROUPS, PEOPLES, TRIBES } from './cms-timeline-rules.mjs';

export { GROUPS, PEOPLES, TRIBES };
export const CmsKind = z.enum(['timeline', 'note', 'sources', 'class', 'person', 'precept']);
export type CmsKind = z.infer<typeof CmsKind>;
export const CmsId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(v => !v.includes('..'), 'Invalid content id');
export const FileSha = z.string().regex(/^[a-f0-9]{40}$/);
export const Reason = z.string().trim().min(3, 'Explain why this change is needed').max(2000);
const text = z.string().max(100_000);
const nonempty = text.trim().min(1);
const web = z.string().url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), 'Use an http(s) source URL');
export const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, 'Use a real calendar date');
const aliases: Record<string, string> = {
  "ecclesiasticus": "sirach",
  "sirach": "sirach",
  "wisdom of sirach": "sirach",
  "rest of esther": "esther-greek",
  "the rest of esther": "esther-greek",
  "additions to esther": "esther-greek",
  "esther (greek)": "esther-greek",
  "wisdom": "wisdom-of-solomon",
  "the wisdom of solomon": "wisdom-of-solomon",
  "song of the three holy children": "song-of-the-three-children",
  "the song of the three holy children": "song-of-the-three-children",
  "history of susanna": "susanna",
  "the history of susanna": "susanna",
  "prayer of manasses": "prayer-of-manasseh",
  "the prayer of manasses": "prayer-of-manasseh",
  "epistle of jeremy": "epistle-of-jeremiah",
  "the epistle of jeremiah": "epistle-of-jeremiah",
  "psalm": "psalms",
  "song of songs": "song-of-solomon",
  "canticles": "song-of-solomon",
  "revelations": "revelation",
  "the revelation": "revelation",
  "i esdras": "1-esdras",
  "ii esdras": "2-esdras",
  "i maccabees": "1-maccabees",
  "ii maccabees": "2-maccabees"
};
/** Only pinned KJV chapter lengths are included, not additional Bible text. */
export function resolveScripture(value: string) {
  const m = /^\s*(.+?)\s+(\d+)(?::\s*([\d,\s–-]+))?\s*$/.exec(value);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').replace(/^(first|1st) /, '1 ').replace(/^(second|2nd) /, '2 ').replace(/^(third|3rd) /, '3 ');
  const book = bible.books.find(b => b.book.toLowerCase() === name || b.slug === name.replaceAll(' ', '-') || b.slug === aliases[name]);
  const count = book && (book.chapters as Record<string, number>)[String(+m[2])];
  if (!book || !count) return null;
  const verses: number[] = [];
  if (m[3]) for (const part of m[3].trim().split(',')) {
    const range = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
    if (!range) return null;
    const from = +range[1], to = +(range[2] ?? range[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let n = from; n <= to; n++) verses.push(n);
  } else for (let n = 1; n <= count; n++) verses.push(n);
  return { slug: book.slug, chapter: +m[2], verses };
}
const scripture = z.strictObject({ ref: nonempty.refine(v => !!resolveScripture(v), 'Reference must resolve to KJV verses'), why: text.optional() });
const source = z.strictObject({ title: nonempty, url: web, author: text.optional(), publisher: text.optional(), supports: text.optional(), via: text.optional(), year: z.union([z.string(), z.number()]).optional(), accessed: z.string().optional() });
const teaching = z.strictObject({
  points: z.array(text).max(100).optional(), quote: text.optional(), teacher: text.optional(),
  source: z.strictObject({ kind: z.enum(['class', 'history', 'site', 'note']), title: nonempty, url: web, id: text.optional(), ts: text.optional(), date: z.union([CalendarDate, z.literal('')]).optional() }),
});
export const TimelineShape = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120), title: nonempty,
  start: z.int().nullable().optional(), end: z.int().nullable().optional(),
  date: z.strictObject({
    text: nonempty, precision: z.enum(['day', 'month', 'year', 'circa', 'range', 'decade', 'unknown']),
    // A source-calendar date ("15 Casleu, year 145") that is not converted to a BCE/CE year: say
    // which calendar and where it is stated, but never invent the conversion (CYB-146).
    calendar: text.optional(), sourceRef: text.optional(),
  }).optional(),
  period: nonempty, group: z.string().refine(v => GROUPS.includes(v), 'Choose a listed group').optional(),
  tribes: z.array(z.string().refine(v => Object.hasOwn(TRIBES, v), 'Choose one of the twelve tribes')).max(12).optional(),
  peoples: z.array(z.string().refine(v => PEOPLES.includes(v), 'Choose a listed people')).max(3).optional(),
  people: z.array(text).max(100).optional(), place: text.optional(), region: text.optional(), summary: text.optional(),
  account: z.array(text).max(1000).optional(), sources: z.array(source).max(200).optional(), scriptures: z.array(scripture).max(200).optional(), answer: z.array(scripture).max(200).optional(),
  teaching: z.array(teaching).max(200).optional(), uncertainty: text.optional(), needs: text.optional(), leader: text.optional(),
  disagreements: z.array(z.strictObject({ point: nonempty, views: z.array(nonempty).min(2).max(20) })).max(100).optional(),
  image: z.strictObject({ kind: z.enum(['archival', 'generated']), src: nonempty.refine(v => /^https?:\/\//.test(v) || /^\/?[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(v) && !v.includes('..'), 'Use a web image or app image path'), caption: nonempty, credit: text.optional(), license: text.optional(), sourceUrl: web.optional() }).optional(),
  status: z.enum(['published', 'draft']).optional(),
});
export type TimelineEntry = z.infer<typeof TimelineShape>;
export type CmsPeriod = { id: string; title: string; startYear: number; endYear: number };
export function timelineSchema(periods: CmsPeriod[], leaders: { id: string }[], draft: boolean) {
  return TimelineShape.superRefine((e, ctx) => {
    for (const message of checkEvent(e, periods, { draft, leaders })) ctx.addIssue({ code: 'custom', message });
    if ((e.start == null) !== (e.end == null)) ctx.addIssue({ code: 'custom', message: 'Supply both start and end years, or leave both blank in a draft' });
  });
}
export const SourceHost = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
export const SourceList = z.array(SourceHost).max(100).refine(v => new Set(v).size === v.length, 'A site is listed twice');
export const TimelineSave = z.strictObject({
  id: CmsId, action: z.enum(['add', 'edit', 'publish', 'unpublish']), draft: z.boolean(),
  shas: z.strictObject({ events: FileSha, drafts: FileSha }), event: TimelineShape, reason: Reason,
});
export const NoteSave = z.strictObject({ file: z.string().max(240), sha: FileSha, reason: Reason, body: text.optional(), teacher: z.string().max(200).optional(), title: z.string().max(500).optional(), replace: z.array(z.strictObject({ from: text, to: text })).max(30).optional() });
export type CmsState = 'Checking' | 'Passed' | 'Failed' | 'Published' | 'Live' | 'Closed';
export type CmsChange = {
  id: string; kind: CmsKind | 'resources'; subject: string; title: string; reason: string; repo: string; branch: string;
  by: { id: number; name: string }; at: string; head: string; files: { path: string; sha: string }[];
  pr?: number; url?: string; state: CmsState; message: string; canPublish?: boolean;
};
