import { openDB, type DBSchema } from "idb";
import { studySchema, type Study } from "./model";
import { personalStore, store } from "@/tg/store";
import { archiveSchema } from "@shared/studies";

export type Annotation = { id: string; verseKey: string; start: number; end: number; quote: string; style: "highlight" | "underline" | "circle"; /** A highlight colour key (color1, a custom colour id); none draws the original phrase style. */ color?: string; created: string };
interface StudyDB extends DBSchema {
  studies: { key: string; value: Study };
  annotations: { key: string; value: Annotation; indexes: { verse: string } };
}
let db: ReturnType<typeof openDB<StudyDB>> | undefined;
const database = () => db ??= openDB<StudyDB>("cyberjudah-personal-study", 1, { upgrade(d) {
  d.createObjectStore("studies", { keyPath: "id" });
  d.createObjectStore("annotations", { keyPath: "id" }).createIndex("verse", "verseKey");
} });
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;
try { channel = new BroadcastChannel("cyberjudah-personal-study"); channel.onmessage = () => listeners.forEach(fn => fn()); } catch { /* One-window environments still receive local updates. */ }
const changed = () => { listeners.forEach(fn => fn()); channel?.postMessage("changed"); };
store.subscribe("studies", changed); store.subscribe("wordAnnotations", changed);
export const subscribeStudies = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const listStudies = async () => {
  const sync = await personalStore();
  const values: Study[] = sync ? Object.values(JSON.parse(sync.get("studies"))) : await (await database()).getAll("studies");
  return values.sort((a, b) => b.updated.localeCompare(a.updated));
};
export const getStudy = async (id: string): Promise<Study | undefined> => {
  const sync = await personalStore();
  return sync ? JSON.parse(sync.get("studies"))[id] : (await database()).get("studies", id);
};
export class StudyConflict extends Error { constructor() { super("This study changed in another window. Export your draft before reloading, or save it as a new copy."); } }
export async function saveStudy(study: Study): Promise<Study> {
  const next = studySchema.parse({ ...study, revision: study.revision + 1, updated: new Date().toISOString() });
  if (new TextEncoder().encode(JSON.stringify(next)).length > 2_000_000) throw new Error("This study is full (2 MB). Start a second study or export this one.");
  const sync = await personalStore();
  if (sync) {
    const previous = JSON.parse(sync.get("studies"))[study.id] as Study | undefined;
    if ((previous?.revision ?? 0) !== study.revision) throw new StudyConflict();
    if (new TextEncoder().encode(JSON.stringify(next)).length > 750_000) throw new Error("This study is too large to sync. Export your draft before splitting it into smaller studies.");
    await sync.set("studies", JSON.stringify({ [study.id]: next }), JSON.stringify(previous ? { [study.id]: previous } : {}));
    changed(); return next;
  }
  const tx = (await database()).transaction("studies", "readwrite");
  const previous = await tx.store.get(study.id);
  if ((previous?.revision ?? 0) !== study.revision) { tx.abort(); await tx.done.catch(() => {}); throw new StudyConflict(); }
  await tx.store.put(next); await tx.done; changed(); return next;
}
export async function deleteStudy(id: string, revision: number) {
  const sync = await personalStore();
  if (sync) {
    const previous = JSON.parse(sync.get("studies"))[id] as Study | undefined;
    if (previous?.revision !== revision) throw new StudyConflict();
    await sync.set("studies", null, JSON.stringify({ [id]: previous })); changed(); return;
  }
  const tx = (await database()).transaction("studies", "readwrite");
  if ((await tx.store.get(id))?.revision !== revision) { tx.abort(); await tx.done.catch(() => {}); throw new StudyConflict(); }
  await tx.store.delete(id); await tx.done; changed();
}
export const verseAnnotations = async (key: string): Promise<Annotation[]> => {
  const sync = await personalStore();
  return sync ? (Object.values(JSON.parse(sync.get("wordAnnotations"))) as Annotation[]).filter(a => a.verseKey === key) : (await database()).getAllFromIndex("annotations", "verse", key);
};
export async function addAnnotation(a: Annotation, text: string) {
  if (!Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end <= a.start || a.end > text.length || text.slice(a.start, a.end) !== a.quote || !["highlight", "underline", "circle"].includes(a.style) || (a.color !== undefined && (typeof a.color !== "string" || !a.color || a.color.length > 40))) throw new Error("Select a phrase in this verse before saving.");
  const sync = await personalStore();
  if (sync) await sync.set("wordAnnotations", JSON.stringify({ [a.id]: a }), JSON.stringify({ [a.id]: JSON.parse(sync.get("wordAnnotations"))[a.id] }));
  else await (await database()).put("annotations", a);
  changed();
}
export async function removeAnnotation(id: string) {
  const sync = await personalStore();
  if (sync) await sync.set("wordAnnotations", null, JSON.stringify({ [id]: JSON.parse(sync.get("wordAnnotations"))[id] }));
  else await (await database()).delete("annotations", id);
  changed();
}
export async function exportPersonalStudies() {
  const sync = await personalStore();
  if (sync) return { app: "cyberjudah-studies", version: 1, studies: Object.values(JSON.parse(sync.get("studies"))) as Study[], annotations: Object.values(JSON.parse(sync.get("wordAnnotations"))) as Annotation[] };
  const d = await database();
  const tx = d.transaction(["studies", "annotations"]);
  return { app: "cyberjudah-studies", version: 1, studies: await tx.objectStore("studies").getAll(), annotations: await tx.objectStore("annotations").getAll() };
}
export async function clearPersonalStudies() {
  const tx = (await database()).transaction(["studies", "annotations"], "readwrite");
  await tx.objectStore("studies").clear(); await tx.objectStore("annotations").clear(); await tx.done; changed();
}

/** An import never replaces existing work. Validate the entire archive before opening a write transaction. */
export async function importPersonalStudies(raw: string) {
  if (new TextEncoder().encode(raw).length > 10_000_000) throw new Error("Choose a personal-study backup smaller than 10 MB.");
  const archive = archiveSchema.parse(JSON.parse(raw));
  const sync = await personalStore();
  if (sync) {
    for (const study of archive.studies) await saveStudy({ ...study, id: crypto.randomUUID(), revision: 0 });
    const existing = Object.values(JSON.parse(sync.get("wordAnnotations"))) as Annotation[];
    for (const annotation of archive.annotations) if (!existing.some(a => a.verseKey === annotation.verseKey && a.start === annotation.start && a.end === annotation.end && a.quote === annotation.quote && a.style === annotation.style)) {
      const id = crypto.randomUUID(); await sync.set("wordAnnotations", JSON.stringify({ [id]: { ...annotation, id } }), "{}");
    }
    changed(); return archive.studies.length;
  }
  const tx = (await database()).transaction(["studies", "annotations"], "readwrite");
  for (const study of archive.studies) await tx.objectStore("studies").put({ ...study, id: crypto.randomUUID(), revision: 1, title: study.title, updated: new Date().toISOString() });
  const existing = await tx.objectStore("annotations").getAll();
  for (const annotation of archive.annotations) if (!existing.some(a => a.verseKey === annotation.verseKey && a.start === annotation.start && a.end === annotation.end && a.quote === annotation.quote && a.style === annotation.style)) await tx.objectStore("annotations").put({ ...annotation, id: crypto.randomUUID() });
  await tx.done; changed(); return archive.studies.length;
}
