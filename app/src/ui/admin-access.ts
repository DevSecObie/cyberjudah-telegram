import { apiURL } from "@/native/platform";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/tg/sdk";
export function usePhotos() {
  return useQuery({
    queryKey: ["photos"],
    queryFn: async () => { const r = await fetch("/api/photos"); const photos = (r.ok ? await r.json() : {}) as Record<string, string>; return Object.fromEntries(Object.entries(photos).map(([key, url]) => [key, apiURL(url)])); },
    staleTime: 60_000,
    retry: 1,
  });
}

/** Whether this reader is an admin (/api/me), shared with the note editor's query. */
export function useIsAdmin() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ admin?: boolean; canEdit?: boolean }>("/api/me"), staleTime: 600_000, retry: false });
  return me.isSuccess && !!me.data?.admin;
}

