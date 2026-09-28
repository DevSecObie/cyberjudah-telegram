import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, inTelegram } from '@/tg/sdk';
import type { ReadingSettings, readingSummary } from '@shared/reading.mjs';
export type ReadingState = ReturnType<typeof readingSummary> & { settings: ReadingSettings; quote?: { text: string; source?: string }; admin?: boolean };
export function useReading() {
  return useQuery({ queryKey: ['reading'], queryFn: () => api<ReadingState>('/api/reading'), enabled: inTelegram, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true });
}
export function useReadingChange() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ path, value }: { path: 'chapter' | 'settings'; value: unknown }) => api<ReadingState>(`/api/reading/${path}`, { method: path === 'settings' ? 'PUT' : 'POST', json: value }), onSuccess: state => client.setQueryData(['reading'], state) });
}
