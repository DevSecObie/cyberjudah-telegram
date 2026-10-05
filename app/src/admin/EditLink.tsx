import { Link } from 'react-router';
import { useIsAdmin } from '@/ui/photo-edit';
export function CmsEditLink({ kind, id, label = 'Edit' }: { kind: string; id: string; label?: string }) {
  const admin = useIsAdmin();
  return admin ? <Link className="chip" to={`/settings/admin/${kind}/${encodeURIComponent(id)}`}>{label}</Link> : null;
}
