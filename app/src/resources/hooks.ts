import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceRelease } from './client';

/** Keep cross-tab changes observable even while no resource screen is mounted. */
export function useResourceSync() {
  const client = useQueryClient();
  useEffect(() => {
    const changed = () => { void client.invalidateQueries({ queryKey: ['resource-release'] }); void client.invalidateQueries({ queryKey: ['resource-installed'] }); };
    window.addEventListener('resourcechange', changed);
    window.addEventListener('focus', changed);
    let channel: BroadcastChannel | null = null;
    try { channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cj-resources'); channel?.addEventListener('message', changed); } catch { /* A restricted browser can still refresh on focus. */ }
    return () => { window.removeEventListener('resourcechange', changed); window.removeEventListener('focus', changed); channel?.close(); };
  }, [client]);
}

/** React Query keys include the selected release; updates cannot reuse old entry data. */
export function useResourceRelease(id: string, explicit?: string | null) {
  const selected = useQuery({ queryKey: ['resource-release', id], queryFn: () => resourceRelease(id), staleTime: Infinity, enabled: explicit === undefined });
  return explicit === undefined ? selected.data : explicit;
}
