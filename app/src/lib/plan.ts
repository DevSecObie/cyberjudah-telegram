import type { Book } from "@/api/data";
import { dayKey, expand, type Plan, type Progress } from "./marks";

/**
 * The reading plan: the whole library in order at a set number of chapters a day (four, as
 * the class reads it: 4 Chapters a Day). Day N is chapters N*perDay .. N*perDay+perDay-1 of
 * the flat list of every chapter in every book. A day is done when its chapters are marked
 * read; the streak counts consecutive days with a day completed.
 */
export type PlanDay = { day: number; chapters: { slug: string; book: string; chapter: number; read: boolean }[]; done: boolean; total: number; pct: number; label: string };

export function flatChapters(books: Book[]) {
  const out: { slug: string; book: string; chapter: number }[] = [];
  for (const b of books) for (const c of b.chapterIds) out.push({ slug: b.slug, book: b.book, chapter: c });
  return out;
}

export function planDay(plan: NonNullable<Plan>, books: Book[], progress: Progress, day = plan.day): PlanDay {
  const all = flatChapters(books);
  const per = plan.perDay;
  const slice = all.slice(day * per, day * per + per).map((c) => ({ ...c, read: expand(progress[c.slug]).has(c.chapter) }));
  const total = Math.ceil(all.length / per);
  const first = slice[0], last = slice[slice.length - 1];
  const label = !first ? "Finished" : first.slug === last.slug ? `${first.book} ${first.chapter}${last.chapter > first.chapter ? `–${last.chapter}` : ""}` : `${first.book} ${first.chapter} – ${last.book} ${last.chapter}`;
  return { day, chapters: slice, done: slice.length > 0 && slice.every((c) => c.read), total, pct: Math.min(100, Math.round((day / total) * 100)), label };
}

/** Called when a day's chapters are all read: advance, and keep the streak honest. */
export function advance(plan: NonNullable<Plan>, today = dayKey()): NonNullable<Plan> {
  if (plan.lastDone === today) return { ...plan, day: plan.day + 1 };
  const y = new Date(); y.setDate(y.getDate() - 1);
  const streak = plan.lastDone === dayKey(y) ? plan.streak + 1 : 1;
  return { ...plan, day: plan.day + 1, streak, lastDone: today };
}

export const startPlan = (perDay = 4): NonNullable<Plan> => ({ startedAt: dayKey(), day: 0, streak: 0, perDay });
