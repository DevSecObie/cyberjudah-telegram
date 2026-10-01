import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/tg/sdk";

/**
 * Asking for a class's notes. Notes are written from a class's transcript only when readers ask
 * for them (each costs money to write), so a class without notes offers "Request notes": one ask
 * per reader, the count shown, and the admins draft the most asked for first.
 */
export type RequestState = { count: number; mine: boolean };
export type RequestRow = { video: string; title: string; count: number; last: string };

const VIDEO = /^[A-Za-z0-9_-]{11}$/;

export function useNoteRequest(video: string | undefined) {
  const client = useQueryClient();
  const enabled = !!video && VIDEO.test(video);
  const state = useQuery({ queryKey: ["note-request", video], enabled, staleTime: 60_000, retry: 1,
    queryFn: () => api<RequestState & { ok: boolean }>(`/api/requests/${video}`) });
  const ask = useMutation({
    mutationFn: (title: string) => api<RequestState & { ok: boolean; added: boolean }>(`/api/requests/${video}`, { method: "POST", json: { title } }),
    onSuccess: (r) => { client.setQueryData(["note-request", video], { ok: true, count: r.count, mine: r.mine }); void client.invalidateQueries({ queryKey: ["note-requests"] }); },
  });
  return { state, ask, enabled };
}

/** The admins' list: every class asked for, the most asked first. */
export function useNoteRequests(enabled: boolean) {
  return useQuery({ queryKey: ["note-requests"], enabled, staleTime: 30_000,
    queryFn: () => api<{ ok: boolean; requests: RequestRow[] }>("/api/requests").then((r) => r.requests) });
}

export function useCloseRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (video: string) => api<{ ok: boolean }>(`/api/requests/${video}`, { method: "DELETE" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["note-requests"] }); },
  });
}
