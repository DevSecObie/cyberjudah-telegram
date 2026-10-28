import { z } from "zod";

export const NaveLanguage = z.literal("en");
export type NaveLanguage = z.infer<typeof NaveLanguage>;
const text = z.string().min(1);
const resource = z.object({ kind: z.literal("nave"), language: NaveLanguage, revision: text });
export const NaveSummary = z.object({ normalizedName: text, name: text, initial: text });
export const NaveTopic = NaveSummary.extend({ description: z.string() });
export const NavePage = z.object({ resource, topics: z.array(NaveSummary), limit: z.number().int().positive(), nextCursor: text.optional() });
export const NaveArticle = z.object({ resource, topic: NaveTopic });
const reference = NaveSummary.omit({ initial: true });
export const NaveVerse = z.object({ resource, verseKey: z.string().regex(/^[1-9]\d*-[1-9]\d*-[1-9]\d*$/), verseTopics: z.array(reference), chapterTopics: z.array(reference) });
export type NaveSummary = z.infer<typeof NaveSummary>;
export type NaveTopic = z.infer<typeof NaveTopic>;
export type NavePage = z.infer<typeof NavePage>;
export type NaveVerse = z.infer<typeof NaveVerse>;

export const navePath = (language: NaveLanguage, name: string) => `/nave/${language}/${encodeURIComponent(name)}`;
