import { flatten, type TimelineData, type TimelineEvent } from "@shared/timeline.mjs";
import raw from "@/data/timeline.json";

/**
 * The Bible Timeline's data (app/src/data/timeline.json, built by app/scripts/timeline-data.mjs
 * from Bible Strong's events.txt) and the small helpers the period canvas, the search and the
 * event sheet share.
 */
const TL = raw as TimelineData;
export const SECTIONS = TL.sections;
/** The Final Captivity's age, and the date its sources were reviewed through (app/scripts/final-captivity). */
export const FINAL_CAPTIVITY = TL.finalCaptivity;
export const ALL = flatten(SECTIONS);
const BY_SLUG = new Map(ALL.map((e) => [e.slug, e]));
const BASE = import.meta.env.BASE_URL;

export const eventBySlug = (slug: string | null | undefined): TimelineEvent | undefined => (slug ? BY_SLUG.get(slug) : undefined);

/** An event's picture: the approved portrait of its person, at the size drawn (64px strip, the sheet, search). */
export const portraitSrc = (e: TimelineEvent, size: 128 | 256) => (e.portrait ? `${BASE}people/${e.portrait}-${size}.webp` : null);

/** A People id (name-book-chapter-verse, as STEPBible's): the portrait's person has a page in People. */
export const personOf = (e: TimelineEvent): string | null => (e.portrait && /-[a-z0-9]{2,3}-\d+-\d+$/.test(e.portrait) ? e.portrait : null);

export const reignLabel = (r: NonNullable<TimelineEvent["reign"]>) => `${r.approx ? "c. " : ""}${r.from === r.to ? r.from : `${r.from}–${r.to}`} BC, ${r.kingdom === "United" ? "the united kingdom" : r.kingdom}`;

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
