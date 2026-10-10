import { z } from "zod";

const id = z.string().uuid();
const text = z.string().max(40_000);
export const studyBlock = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("text"), text }),
  z.object({ id, kind: z.literal("scripture"), book: z.string().regex(/^[a-z0-9-]+$/).max(80), chapter: z.number().int().min(1).max(150), reference: z.string().max(160), verses: z.array(z.object({ verse: z.number().int().min(1).max(200), text })).min(1).max(200) }),
  z.object({ id, kind: z.literal("strongs"), number: z.string().regex(/^[HG][1-9]\d{0,4}$/), lemma: z.string().max(300), definition: text }),
]);
export const studySchema = z.object({
  version: z.literal(1), id, revision: z.number().int().nonnegative(),
  title: z.string().max(160), tags: z.array(z.string().max(40)).max(20),
  created: z.string().datetime(), updated: z.string().datetime(),
  blocks: z.array(studyBlock).max(200),
});
export type StudyBlock = z.infer<typeof studyBlock>;
export type Study = z.infer<typeof studySchema>;
export const newStudy = (blocks: StudyBlock[] = []): Study => ({ version: 1, id: crypto.randomUUID(), revision: 0, title: "Untitled study", tags: [], created: new Date().toISOString(), updated: new Date().toISOString(), blocks });
export const textBlock = (): StudyBlock => ({ id: crypto.randomUUID(), kind: "text", text: "" });

/** Imports become independent documents; never overwrite another device's work. */
export function importStudy(raw: string): Study {
  if (new TextEncoder().encode(raw).length > 2_000_000) throw new Error("This study exceeds the 2 MB import limit.");
  const parsed = studySchema.parse(JSON.parse(raw));
  return { ...parsed, id: crypto.randomUUID(), revision: 0, created: new Date().toISOString(), updated: new Date().toISOString(), blocks: parsed.blocks.map(b => ({ ...b, id: crypto.randomUUID() })) };
}
export function studyMarkdown(study: Study): string {
  return `# ${study.title.replace(/[\r\n]/g, " ")}\n\n` + study.blocks.map(b => b.kind === "text" ? b.text : b.kind === "scripture" ? `## ${b.reference} (KJV)\n\n${b.verses.map(v => `> ${v.verse}. ${v.text}`).join("\n>\n")}\n\n[Read passage](https://cyberjudah.io/app/read/${b.book}/${b.chapter}?v=${b.verses[0].verse})` : `## ${b.number} · ${b.lemma}\n\n${b.definition}`).join("\n\n");
}

export const archiveSchema = z.object({ app: z.literal("cyberjudah-studies"), version: z.literal(1), studies: z.array(studySchema).max(500), annotations: z.array(z.object({ id: z.string().uuid(), verseKey: z.string().regex(/^[a-z0-9-]+$/).max(120), start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1).max(20_000), style: z.enum(["highlight", "underline", "circle"]), color: z.string().min(1).max(40).optional(), created: z.string().datetime() }).refine(a => a.end > a.start && a.end - a.start === a.quote.length)).max(10_000) });
