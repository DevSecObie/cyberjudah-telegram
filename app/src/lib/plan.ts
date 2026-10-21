import type { Book } from "@/api/data";
import { dayKey, expand, type Plan, type Progress } from "./marks";

/**
 * The reading plan: the whole library in order at a set number of chapters a day (four, as
 * the class reads it: 4 Chapters a Day). Day N is chapters N*perDay .. N*perDay+perDay-1 of
 * the flat list of every chapter in every book. A day is done when its chapters are marked
 * read; the streak counts consecutive days with a day completed.
 */
export type PlanDay = { day: number; chapters: { slug: string; book: string; chapter: number; read: boolean }[]; done: boolean; total: number; pct: number; readCount: number; label: string };

export function flatChapters(books: Book[]) {
  const out: { slug: string; book: string; chapter: number }[] = [];
  for (const b of books) for (const c of b.chapterIds) out.push({ slug: b.slug, book: b.book, chapter: c });
  return out;
}

export function planDay(plan: NonNullable<Plan>, books: Book[], progress: Progress, day = plan.day): PlanDay {
  const all = flatChapters(plan.books ? books.filter(b => plan.books!.includes(b.slug)) : books);
  const per = Math.max(1, Math.floor(plan.perDay) || 4);
  const slice = all.slice(day * per, day * per + per).map((c) => ({ ...c, read: expand(progress[c.slug]).has(c.chapter) }));
  const total = Math.ceil(all.length / per);
  const readByBook = new Map(books.map(b => [b.slug, expand(progress[b.slug])]));
  const readCount = all.filter(c => readByBook.get(c.slug)?.has(c.chapter)).length;
  const first = slice[0], last = slice[slice.length - 1];
  const label = !first ? "Finished" : first.slug === last.slug ? `${first.book} ${first.chapter}${last.chapter > first.chapter ? `–${last.chapter}` : ""}` : `${first.book} ${first.chapter} – ${last.book} ${last.chapter}`;
  return { day, chapters: slice, done: slice.length > 0 && slice.every((c) => c.read), total, pct: all.length ? Math.round(readCount / all.length * 100) : 0, readCount, label };
}

/** Called when a day's chapters are all read: advance, and keep the streak honest. */
export function advance(plan: NonNullable<Plan>, today = dayKey()): NonNullable<Plan> {
  if (plan.lastDone === today) return { ...plan, day: plan.day + 1 };
  const y = new Date(); y.setDate(y.getDate() - 1);
  const streak = plan.lastDone === dayKey(y) ? plan.streak + 1 : 1;
  return { ...plan, day: plan.day + 1, streak, lastDone: today };
}

export const startPlan = (perDay = 4): NonNullable<Plan> => ({ startedAt: dayKey(), day: 0, streak: 0, perDay, seenCompleted: 0 });

/** Civil-day arithmetic: UTC represents the date only, avoiding DST-length days. */
function civilDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number), date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() / 86_400_000 : undefined;
}
export const isCivilDate = (value: string) => civilDay(value) !== undefined;
/** 27.2.0 uses one-based days at the calendar boundary; stored plan.day stays zero-based. */
export function getScheduledPlanDay(start: string, date: string): number | undefined {
  const from = civilDay(start), to = civilDay(date);
  return from === undefined || to === undefined ? undefined : to - from + 1;
}
export function getPlanDayDate(start: string, day: number): string | undefined {
  const from = civilDay(start);
  if (from === undefined || !Number.isInteger(day) || day < 1) return undefined;
  return new Date((from + day - 1) * 86_400_000).toISOString().slice(0, 10);
}
/** Days between valid YYYY-MM-DD keys. */
export function daysBetween(a: string, b: string) {
  return (getScheduledPlanDay(a, b) ?? 1) - 1;
}
/** The calendar day a plan day falls on, from the start date. */
export function dateOfDay(plan: NonNullable<Plan>, day: number) {
  const [y, m, d] = plan.startedAt.split("-").map(Number);
  return new Date(y, m - 1, d + day);
}
/** How the reader stands against the calendar: days behind (>0) or ahead (<0), and the chapters owed. */
export function schedule(plan: NonNullable<Plan>, books: Book[], progress: Progress, today = dayKey()) {
  const due = daysBetween(plan.startedAt, today);
  const offset = due - plan.day;
  const all = flatChapters(plan.books ? books.filter(b => plan.books!.includes(b.slug)) : books);
  let owed = 0;
  for (let i = plan.day * plan.perDay; i < Math.min(all.length, (due + 1) * plan.perDay); i++) if (!expand(progress[all[i].slug]).has(all[i].chapter)) owed++;
  return { due, offset, owed: offset > 0 ? owed : 0 };
}
/** Move the start date so today is the day the reader is on. */
export const realign = (plan: NonNullable<Plan>, today = new Date()): NonNullable<Plan> => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - plan.day);
  return { ...plan, startedAt: dayKey(d) };
};

export const PLAN_CATALOGUE: { id: string; name: string; description: string; select: (b: Book) => boolean }[] = [
  { id: "whole", name: "Whole Bible with Apocrypha", description: "Read every book in the library’s order.", select: () => true },
  { id: "new", name: "New Testament", description: "Matthew through Revelation, in book order.", select: b => b.testament === "New Testament" },
  { id: "apocrypha", name: "Apocrypha", description: "The books included in the King James Apocrypha.", select: b => b.testament === "Apocrypha" },
  { id: "psalms-proverbs", name: "Psalms and Proverbs", description: "Read through these two books, a chapter at a time.", select: b => ["psalms", "proverbs"].includes(b.slug) },
  { id: "law", name: "The Law", description: "Genesis, Exodus, Leviticus, Numbers and Deuteronomy.", select: b => ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"].includes(b.slug) },
];
export type PlanFilters = { query: string; language: "all" | "en" };
export const normalizePlanFilters = (query: string | null, language: string | null): PlanFilters => ({ query: query ?? "", language: language === "all" ? "all" : "en" });
export function filterPlans<T extends { name: string; description: string }>(plans: T[], filters: PlanFilters): T[] {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = normalize(filters.query).trim().split(/\s+/);
  return plans.filter(plan => words.every(word => normalize(`${plan.name} ${plan.description}`).includes(word)));
}
export function cataloguePlan(id: string, books: Book[], pace: number): NonNullable<Plan> | null {
  const entry = PLAN_CATALOGUE.find(p => p.id === id), book = id.startsWith("book:") ? books.find(b => b.slug === id.slice(5)) : undefined;
  if (!entry && !book) return null;
  const selected = book ? [book] : books.filter(entry!.select);
  return { ...startPlan([1, 2, 4, 6].includes(pace) ? pace : 1), catalogId: id, name: book?.book ?? entry!.name, books: selected.map(b => b.slug) };
}
export function planDays(plan: NonNullable<Plan>, books: Book[], progress: Progress): PlanDay[] {
  const read = new Map(books.map(book => [book.slug, expand(progress[book.slug])]));
  const all = flatChapters(plan.books ? books.filter(book => plan.books!.includes(book.slug)) : books).map(chapter => ({ ...chapter, read: read.get(chapter.slug)?.has(chapter.chapter) ?? false }));
  const per = Math.max(1, Math.floor(plan.perDay) || 4), total = Math.ceil(all.length / per), readCount = all.filter(chapter => chapter.read).length;
  return Array.from({ length: total }, (_, day) => {
    const chapters = all.slice(day * per, (day + 1) * per), first = chapters[0], last = chapters[chapters.length - 1];
    const label = first.slug === last.slug ? `${first.book} ${first.chapter}${last.chapter > first.chapter ? `–${last.chapter}` : ""}` : `${first.book} ${first.chapter} – ${last.book} ${last.chapter}`;
    return { day, chapters, done: chapters.every(chapter => chapter.read), total, readCount, pct: all.length ? Math.round(readCount / all.length * 100) : 0, label };
  });
}
/** Resume at the first unfinished day; a finished plan keeps the reminder cursor past its end. */
export function planCompletion(days: PlanDay[]) {
  const completed = days.filter(day => day.done).length, first = days.findIndex(day => !day.done);
  return { completed, resume: first < 0 ? days.length : first, finished: !!days.length && completed === days.length };
}
