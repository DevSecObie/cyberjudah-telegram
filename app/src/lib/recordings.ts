import { useQuery } from "@tanstack/react-query";
import { cachedResponse } from "./offline";

export type Narrator = { id: string; reader: string; audio: string; verses: [number, number, number][]; source: string; license: string };
export type RecordingCredit = { readerId: string; reader: string; slug: string; chapter: number; audio: string; source: string; license: string; bytes: number };
export const recordingUrl = (slug: string, chapter: number) => `/api/recordings/${encodeURIComponent(slug)}/${chapter}`;
export async function recordingJson<T>(path: string): Promise<T> {
  let response: Response | undefined;
  try { response = await fetch(path); if (!response.ok) response = undefined; } catch { /* offline */ }
  response ??= await cachedResponse(new URL(path, location.origin).href);
  if (!response) throw new Error("Recordings unavailable");
  return response.json() as Promise<T>;
}
export function useNarrators(where?: { slug: string; chapter: number }) {
  return useQuery({ queryKey: ["narrators", where?.slug, where?.chapter], enabled: !!where,
    queryFn: () => recordingJson<{ narrators: Narrator[] }>(recordingUrl(where!.slug, where!.chapter)), staleTime: 300_000, retry: 1 });
}
export async function narrationSource(url: string): Promise<{ url: string; release: () => void }> {
  const saved = await cachedResponse(new URL(url, location.origin).href);
  if (!saved) return { url, release: () => undefined };
  const local = URL.createObjectURL(await saved.blob());
  return { url: local, release: () => URL.revokeObjectURL(local) };
}
