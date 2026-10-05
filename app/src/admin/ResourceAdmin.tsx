import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CatalogSchema, type Catalog } from '@shared/resources';
import type { CmsChange } from '@shared/cms';
import { Sheet } from '@/bible/ui/Sheet';
import { api } from './client';
import { Field } from './fields';
type Release = Catalog['resources'][number];
export function ResourceAdmin() {
  const q = useQuery({ queryKey: ['cms', 'catalog'], queryFn: () => api<{ catalog: Catalog; etag: string }>('/api/admin/cms/resources'), refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (q.isPending) return <p>Loading resource catalog…</p>;
  if (q.isError) return <p role="alert">{q.error.message}</p>;
  return <CatalogForm key={q.data.etag} initial={q.data} />;
}
function CatalogForm({ initial }: { initial: { catalog: Catalog; etag: string } }) {
  const navigate = useNavigate();
  const [id, setId] = useState(''), [release, setRelease] = useState(''), [hash, setHash] = useState(''), [reason, setReason] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<Release[]>([]), [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const choose = (entry: Release) => {
    const catalog = { ...initial.catalog, revision: initial.catalog.revision + 1, resources: [...initial.catalog.resources.filter(r => r.id !== entry.id), entry] };
    const parsed = CatalogSchema.safeParse(catalog);
    if (!parsed.success) { setError('Enter the resource id, release and complete SHA-256 from its bundle artifact.'); return; }
    setError(''); setPending(parsed.data);
  };
  const older = async () => { try { const r = await api<{ releases: Release[]; cursor: string | null }>(`/api/admin/cms/resources/releases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); setHistory([...history, ...r.releases]); setCursor(r.cursor); } catch(e) { setError((e as Error).message); } };
  const apply = async () => {
    if (!pending) return; setBusy(true); setError('');
    try { const c = await api<CmsChange>('/api/admin/cms/resources', { method: 'POST', body: JSON.stringify({ catalog: pending, etag: initial.etag, reason, confirm: 'apply' }) }); navigate(`/settings/admin/changes/${c.id}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <><h2>Resources</h2><p>Published catalog, revision {initial.catalog.revision}. Catalog changes take effect immediately after confirmation.</p><div className="cms-list">{initial.catalog.resources.map(r => <div key={r.id}><span><b>{r.id}</b><small>{r.release}</small></span></div>)}</div>{!initial.catalog.resources.length ? <p>No resources published yet.</p> : null}
    <h3>Publish an uploaded release</h3><p>Upload its verified bundle first using the resource upload instructions. Copy these values from the artifact; the server verifies the uploaded files.</p><Field label="Resource id" value={id} onChange={setId} /><Field label="Release" value={release} onChange={setRelease} /><Field label="Manifest SHA-256" value={hash} onChange={setHash} /><Field label="Reason for this catalog change" multiline value={reason} onChange={setReason} /><button type="button" className="btn" disabled={reason.trim().length < 3} onClick={() => choose({ id, release, manifestSha256: hash })}>Review publication</button>
    <h3>Previously approved releases</h3><p>Choose an earlier release to roll back one resource. Other resources keep their current release.</p>{cursor !== null ? <button type="button" onClick={() => void older()}>{history.length ? 'Load more releases' : 'Show previous releases'}</button> : null}<div className="cms-list">{history.map(r => <div key={`${r.id}/${r.release}`}><span><b>{r.id}</b><small>{r.release}</small></span><button type="button" disabled={reason.trim().length < 3 || initial.catalog.resources.some(x => x.id === r.id && x.release === r.release)} onClick={() => choose(r)}>Use this release</button></div>)}</div>{error ? <p role="alert">{error}</p> : null}
    <Sheet open={!!pending} onClose={() => setPending(null)} title="Apply resource catalog" height="half"><div className="cms-form"><p>This immediately changes the catalog to revision {pending?.revision}. It does not open a review.</p><ul>{pending?.resources.filter(r => !initial.catalog.resources.some(x => x.id === r.id && x.release === r.release)).map(r => <li key={r.id}>{r.id}: {r.release}</li>)}</ul><p>{reason}</p>{error ? <p role="alert">{error}</p> : null}<button className="btn" type="button" disabled={busy} onClick={() => void apply()}>{busy ? 'Applying…' : 'Confirm catalog change'}</button><button type="button" onClick={() => setPending(null)}>Cancel</button></div></Sheet>
  </>;
}
