import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceRelease } from './client';

/** React Query keys include the selected release; updates cannot reuse old entry data. */
export function useResourceRelease(id: string, explicit?: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    const changed = () => { void client.invalidateQueries({ queryKey: ['resource-release'] }); void client.invalidateQueries({ queryKey: ['resource-installed'] }); };
    window.addEventListener('resourcechange', changed);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cj-resources');
    channel?.addEventListener('message', changed);
    return () => { window.removeEventListener('resourcechange', changed); channel?.close(); };
  }, [client]);
  const selected = useQuery({ queryKey: ['resource-release', id], queryFn: () => resourceRelease(id), staleTime: Infinity, enabled: explicit === undefined });
  return explicit === undefined ? selected.data : explicit;
}
