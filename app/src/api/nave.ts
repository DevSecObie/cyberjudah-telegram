import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { NaveArticle, NavePage, NaveVerse, type NaveLanguage } from "@shared/nave";
export { navePath, type NaveLanguage, type NaveSummary, type NaveTopic } from "@shared/nave";

export const NAVE_LANGUAGE = "en";

async function request(language: NaveLanguage, path: string, signal?: AbortSignal) {
  const response = await fetch(`/api/nave/${language}/${path}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Nave is temporarily unavailable.");
  return response.json();
}

function inLanguage<T extends { resource: { language: NaveLanguage } }>(result: T, language: NaveLanguage): T {
  if (result.resource.language !== language) throw new Error("Nave language mismatch.");
  return result;
}

export function useNavePage(language: NaveLanguage, search: string, letter: string, enabled = true, limit = 50) {
  return useInfiniteQuery({
    queryKey: ["nave", language, search ? "search" : "letter", search || letter, limit],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ ...(search ? { search } : { initial: letter }), limit: String(limit), ...(pageParam ? { cursor: pageParam } : {}) });
      const page = inLanguage(NavePage.parse(await request(language, `topics?${params}`, signal)), language);
      return { ...page, topics: search ? page.topics : page.topics.filter((t) => t.initial === letter) };
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: Infinity,
    retry: false,
  });
}

export function useNaveTopic(language: NaveLanguage, name: string) {
  return useQuery({ queryKey: ["nave-detail", language, name], enabled: !!name, staleTime: Infinity, retry: false, queryFn: async ({ signal }) => {
    const payload = await request(language, `topics/${encodeURIComponent(name)}`, signal);
    if (!payload) return null;
    const result = inLanguage(NaveArticle.parse(payload), language);
    if (result.topic.normalizedName !== name) throw new Error("Nave topic mismatch.");
    return result.topic;
  } });
}

export function useNaveVerse(language: NaveLanguage, verse: string, enabled: boolean) {
  return useQuery({ queryKey: ["nave-verse", language, verse], enabled: enabled && !!verse, retry: false, queryFn: async ({ signal }) => {
    const result = inLanguage(NaveVerse.parse(await request(language, `verses/${verse}/topics`, signal)), language);
    if (result.verseKey !== verse) throw new Error("Nave verse mismatch.");
    return result;
  } });
}

export async function randomNave(language: NaveLanguage, signal?: AbortSignal) {
  return inLanguage(NaveArticle.parse(await request(language, "random", signal)), language).topic;
}
