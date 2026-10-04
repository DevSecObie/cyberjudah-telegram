import { useBackButton } from "@/tg/hooks";
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { APPROVED_RESOURCE_IDS, type Catalog, type Manifest } from '@shared/resources';
import { resourceCatalog, resourceManifest } from '@/resources/client';
import { useResourceRelease } from '@/resources/hooks';
import { installedResources, installResource, removeResource, rollbackResource } from '@/resources/storage';
import { Sheet } from '@/bible/ui/Sheet';
import { Empty, Screen } from '@/ui/ui';
import './ResourceInstaller.css';

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const label = (id: string) => id === 'CC-BY-SA-unversioned' ? 'CC BY-SA · version unstated' : id === 'public-domain' ? 'Public domain edition' : id;
export function ResourceInstaller() {
  useBackButton(false);
  const client = useQueryClient();
  useResourceRelease('strongs'); // Keep installed metadata current across tabs.
  const catalog = useQuery({ queryKey: ['resource-catalog'], queryFn: () => resourceCatalog() });
  const installed = useQuery({ queryKey: ['resource-installed'], queryFn: installedResources });
  const [refreshError, setRefreshError] = useState('');
  const refresh = async () => {
    setRefreshError('');
    try { const value = await resourceCatalog(true); client.setQueryData(['resource-catalog'], value); window.dispatchEvent(new Event('resourcechange')); }
    catch { setRefreshError('The catalog could not be refreshed. Installed resources are still available.'); }
  };
  const ids = APPROVED_RESOURCE_IDS.filter((id) => catalog.data?.resources.some((e) => e.id === id) || installed.data?.some((r) => r.id === id));
  return <Screen title="Study resources" kicker="Keep your study library offline">
    <p>Install resources to read them without a connection. Your Bible and saved notes stay where they are.</p>
    <button type="button" className="resource-refresh" onClick={() => void refresh()}>Refresh catalog</button>
    {refreshError ? <p role="status">{refreshError}</p> : null}
    {catalog.isPending || installed.isPending ? <p className="bs-loading">Loading resources…</p> : !ids.length ? <Empty title={catalog.isError ? 'The resource catalog did not load' : 'No published resources yet'}>Approved resources will appear here after publication.</Empty> : null}
    <div className="resource-list">{ids.map((id) => <ResourceCard key={id} id={id} catalog={catalog.data} local={installed.data?.find((r) => r.id === id)} />)}</div>
  </Screen>;
}
function ResourceCard({ id, catalog, local }: { id: string; catalog?: Catalog; local?: Awaited<ReturnType<typeof installedResources>>[number] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(''), [status, setStatus] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null), client = useQueryClient();
  useEffect(() => () => abort.current?.abort(), []);
  const entry = catalog?.resources.find((r) => r.id === id);
  const details = useQuery({ queryKey: ['resource-manifest', id, entry?.release ?? local?.manifest.release], queryFn: () => entry ? resourceManifest(entry) : Promise.resolve(local!.manifest), initialData: !entry || entry.release === local?.manifest.release ? local?.manifest : undefined, staleTime: Infinity, retry: false });
  const manifest = details.data ?? local?.manifest;
  const run = async (action: 'install' | 'remove' | 'rollback') => {
    setBusy(action); setStatus('');
    try {
      if (action === 'install' && catalog) { abort.current = new AbortController(); await installResource(catalog, id, abort.current.signal, (done, total) => setProgress({ done, total })); }
      else if (action === 'remove') await removeResource(id);
      else if (action === 'rollback') await rollbackResource(id);
      await client.invalidateQueries({ queryKey: ['resource-installed'] });
      setStatus(action === 'install' ? 'Ready offline.' : action === 'remove' ? 'Removed from this device.' : 'Previous release restored.');
    } catch (error) { setStatus(error instanceof Error && error.name === 'AbortError' ? 'Download cancelled.' : 'The change could not finish. Any installed release is still available. Please try again.'); }
    finally { setBusy(''); setProgress(null); abort.current = null; }
  };
  return <article className="resource-card">
    <button type="button" className="resource-card__title" onClick={() => setOpen(true)}><b>{manifest?.title ?? id.replaceAll('-', ' ')}</b><span>{local ? 'Available offline' : details.isPending ? 'Loading details…' : 'Available to install'}</span></button>
    {manifest ? <p className="hint">{size(manifest.parts.reduce((n, p) => n + p.bytes, 0))} · {[...new Set(manifest.license.map((l) => label(l.id)))].join(', ')}</p> : null}
    <div className="resource-actions">
      {entry && entry.release !== local?.manifest.release ? <button type="button" disabled={!!busy || !details.data} onClick={() => void run('install')}>{busy === 'install' ? 'Installing…' : local ? 'Install update' : 'Install'}</button> : null}
      {local ? <button type="button" disabled={!!busy} onClick={() => void run('remove')}>Remove</button> : null}
      {local?.previous ? <button type="button" disabled={!!busy} onClick={() => void run('rollback')}>Roll back</button> : null}
      {manifest ? <Link to={id === 'strongs' ? '/lexicon' : `/resources/${id}/${local?.manifest.release ?? manifest.release}`}>Read</Link> : null}
      <button type="button" onClick={() => setOpen(true)}>Source &amp; licence</button>
      {busy === 'install' ? <button type="button" onClick={() => abort.current?.abort()}>Cancel</button> : null}
    </div>
    {progress ? <div role="status"><progress value={progress.done} max={progress.total} aria-label={`Installing ${manifest?.title}`} /><small>{size(progress.done)} of {size(progress.total)}</small></div> : null}
    {status ? <p role="status">{status}</p> : null}
    {details.isError ? <p role="status">New release details could not be loaded. <button type="button" onClick={() => void details.refetch()}>Retry</button></p> : null}
    <Sheet open={open} onClose={() => setOpen(false)} height="full" title={manifest?.title ?? 'Resource details'} subTitle="Source and licence">
      {manifest ? <ResourceDetails manifest={manifest} /> : <p className="bs-loading">Details are unavailable.</p>}
    </Sheet>
  </article>;
}
function ResourceDetails({ manifest }: { manifest: Manifest }) {
  return <div className="resource-details">
    <p>{size(manifest.parts.reduce((n, p) => n + p.bytes, 0))} to keep this resource offline.</p>
    {manifest.id !== 'strongs' ? <p>This is an OCR transcription. Compare quotations, names and dates with the original scans.</p> : null}
    {manifest.license.map((l, i) => <section key={i}><h3>{label(l.id)}</h3><a href={l.url} target="_blank" rel="noopener noreferrer">Original source and notice</a><pre>{l.attribution}</pre><p>{l.modifications}</p></section>)}
    <details><summary>Source revisions</summary><ul>{manifest.source.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">Source file {i + 1}</a><small>{s.revision}</small></li>)}</ul></details>
  </div>;
}
