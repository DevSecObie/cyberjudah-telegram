import type { Env } from "./env";
import type { Passage } from "./ai.mjs";
import { dataJson } from "./data";

type NoteRow = { url?: string; videoId?: string | null; teacher?: string; date?: string };
type Recorded = { teacher?: string; date?: string };
type Index = { at: number; byVideo: Map<string, Recorded>; byUrl: Map<string, Recorded> };
const indexes = new Map<string, Index>();
const recorded = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Only names and dates explicitly recorded for this class; conflicting records stay unnamed. */
function collect(rows: NoteRow[], key: (row: NoteRow) => string | undefined): Map<string, Recorded> {
  const groups = new Map<string, { teachers: Set<string>; dates: Set<string> }>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const group = groups.get(id) ?? { teachers: new Set<string>(), dates: new Set<string>() };
    const teacher = recorded(row.teacher), date = recorded(row.date);
    if (teacher) group.teachers.add(teacher);
    if (date) group.dates.add(date);
    groups.set(id, group);
  }
  return new Map([...groups].map(([id, group]) => [id, {
    ...(group.teachers.size === 1 ? { teacher: [...group.teachers][0] } : {}),
    ...(group.dates.size === 1 ? { date: [...group.dates][0] } : {}),
  }]));
}

async function indexFor(env: Env): Promise<Index | null> {
  if (!env.DATA_ORIGIN) return null;
  const cached = indexes.get(env.DATA_ORIGIN);
  if (cached && Date.now() - cached.at < 3_600_000) return cached;
  const rows = await dataJson<NoteRow[]>(env, "/api/notes/index.json").catch(() => null);
  if (!Array.isArray(rows)) return cached ?? null;
  const index = { at: Date.now(), byVideo: collect(rows, row => row.videoId || undefined), byUrl: collect(rows, row => row.url) };
  indexes.set(env.DATA_ORIGIN, index);
  return index;
}

export async function classAttributor(env: Env): Promise<<T extends Passage>(source: T) => T> {
  const index = await indexFor(env);
  return source => {
    if (!index) return source;
    let path: string | undefined = source.url?.split(/[?#]/)[0];
    if (path && !path.startsWith("/")) {
      try { const url = new URL(path); path = url.origin === new URL(env.SITE_URL).origin ? url.pathname : undefined; }
      catch { path = undefined; }
    }
    const metadata = (source.video && index.byVideo.get(source.video)) || (path && index.byUrl.get(path));
    return metadata ? { ...source, ...metadata } : source;
  };
}

export async function withTeachers<T extends Passage>(env: Env, sources: T[]): Promise<T[]> {
  if (!sources.length) return sources;
  const attribute = await classAttributor(env);
  return sources.map(attribute);
}
