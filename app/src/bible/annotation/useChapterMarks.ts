import { useEffect, useState } from "react";

import { chapterAnnotations, subscribeStudies, type Annotation } from "@/studies/storage";

/** The chapter's word-mark records, kept current as they change here or in another window. */
export function useChapterMarks(slug: string, chapter: number): Annotation[] {
  const [records, setRecords] = useState<Annotation[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => { void chapterAnnotations(slug, chapter).then((a) => { if (active) setRecords(a); }).catch(() => { if (active) setRecords([]); }); };
    setRecords([]); load();
    const off = subscribeStudies(load);
    return () => { active = false; off(); };
  }, [slug, chapter]);
  return records;
}
