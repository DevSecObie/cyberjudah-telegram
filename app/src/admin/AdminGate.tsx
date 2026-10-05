import { lazy } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/tg/sdk';
import { Screen } from '@/ui/ui';
// The import runs only after a successful server admin check, including deep links.
const Admin = lazy(() => import('./Admin').then(m => ({ default: m.Admin })));
export function AdminGate() {
  const who = useQuery({ queryKey: ['me'], queryFn: () => api<{ admin?: boolean }>('/api/me'), retry: false });
  if (who.isPending) return <Screen title="Settings"><p>Checking access…</p></Screen>;
  if (!who.isSuccess || !who.data.admin) return <Screen title="Settings"><p>This area is available to admins only.</p></Screen>;
  return <Admin />;
}
