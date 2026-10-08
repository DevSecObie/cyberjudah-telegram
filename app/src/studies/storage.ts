import { openDB, type DBSchema } from "idb";
import { studySchema, type Study } from "./model";
import { archiveSchema } from "@shared/studies";

export type Annotation = { id: string; verseKey: string; start: number; end: number; quote: string; style: "highlight" | "underline" | "circle"; created: string };
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
export const subscribeStudies = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const listStudies = async () => (await (await database()).getAll("studies")).sort((a, b) => b.updated.localeCompare(a.updated));
export const getStudy = async (id: string) => (await database()).get("studies", id);
export class StudyConflict extends Error { constructor() { super("This study changed in another window. Export your draft before reloading, or save it as a new copy."); } }
export async function saveStudy(study: Study): Promise<Study> {
  const next = studySchema.parse({ ...study, revision: study.revision + 1, updated: new Date().toISOString() });
  if (new TextEncoder().encode(JSON.stringify(next)).length > 2_000_000) throw new Error("This study is full (2 MB). Start a second study or export this one.");
  const tx = (await database()).transaction("studies", "readwrite");
  const previous = await tx.store.get(study.id);
  if ((previous?.revision ?? 0) !== study.revision) { tx.abort(); await tx.done.catch(() => {}); throw new StudyConflict(); }
  await tx.store.put(next); await tx.done; changed(); return next;
}
export async function deleteStudy(id: string, revision: number) {
  const tx = (await database()).transaction("studies", "readwrite");
  if ((await tx.store.get(id))?.revision !== revision) { tx.abort(); await tx.done.catch(() => {}); throw new StudyConflict(); }
  await tx.store.delete(id); await tx.done; changed();
}
export const verseAnnotations = async (key: string) => (await database()).getAllFromIndex("annotations", "verse", key);
export async function addAnnotation(a: Annotation, text: string) {
  if (!Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.end <= a.start || a.end > text.length || text.slice(a.start, a.end) !== a.quote || !["highlight", "underline", "circle"].includes(a.style)) throw new Error("Select a phrase in this verse before saving.");
  await (await database()).put("annotations", a); changed();
}
export async function removeAnnotation(id: string) { await (await database()).delete("annotations", id); changed(); }
export async function exportPersonalStudies() {
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
  const tx = (await database()).transaction(["studies", "annotations"], "readwrite");
  for (const study of archive.studies) await tx.objectStore("studies").put({ ...study, id: crypto.randomUUID(), revision: 1, title: study.title, updated: new Date().toISOString() });
  const existing = await tx.objectStore("annotations").getAll();
  for (const annotation of archive.annotations) if (!existing.some(a => a.verseKey === annotation.verseKey && a.start === annotation.start && a.end === annotation.end && a.quote === annotation.quote && a.style === annotation.style)) await tx.objectStore("annotations").put({ ...annotation, id: crypto.randomUUID() });
  await tx.done; changed(); return archive.studies.length;
}
