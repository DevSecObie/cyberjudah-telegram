import { Link } from "react-router";

import type { PlanDay } from "@/lib/plan";
import { Feather } from "../icons";

/**
 * The end of a chapter: "Mark as read" (a chapter also counts as read after a while on it),
 * a tap again to undo, and when the chapter is in today's plan, how far through the day the
 * reader is and the next chapter to read.
 */
export function ChapterEnd({ read, today, slug, chapter, onToggle }: { read: boolean; today: PlanDay | null; slug: string; chapter: number; onToggle: (on: boolean) => void }) {
  const inPlan = today?.chapters.some((c) => c.slug === slug && c.chapter === chapter) ? today : null;
  const done = inPlan ? inPlan.chapters.filter((c) => c.read).length : 0;
  const next = inPlan?.chapters.find((c) => !c.read && !(c.slug === slug && c.chapter === chapter));
  return (
    <div className="bs-chapterend">
      <button type="button" className="bs-markread" aria-pressed={read} onClick={() => onToggle(!read)}>
        <span className="bs-markread__dot">{read ? <Feather name="check" size={14} color="var(--bs-reverse)" /> : null}</span>
        {read ? "Read" : "Mark as read"}
      </button>
      {inPlan ? (
        <p className="bs-chapterend__plan">
          Day {inPlan.day + 1} · {done} of {inPlan.chapters.length} read
          {next ? <> · <Link to={`/read/${next.slug}/${next.chapter}`}>Next: {next.book} {next.chapter}</Link></> : null}
        </p>
      ) : null}
    </div>
  );
}
