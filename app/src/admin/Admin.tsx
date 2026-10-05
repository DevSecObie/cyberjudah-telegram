import { PreceptList, PreceptEditor } from './PreceptEditor';
import { PeopleList, PeopleEditor } from './PeopleEditor';
import { ClassList, ClassEditor } from './ClassEditor';
import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import type { CmsChange } from '@shared/cms';
import { api } from './client';
import { useBackButton } from '@/tg/hooks';
import { Screen } from '@/ui/ui';
import { Sheet } from '@/bible/ui/Sheet';
import { NoteEditSheet } from '@/ui/note-edit';
import { PhotoEdit, usePhotos, type PhotoSlot } from '@/ui/photo-edit';
import { data, type Note } from '@/api/data';
import { TimelineEditor, TimelineList } from './TimelineEditor';
import { Field, Select } from './fields';
import { ResourceAdmin } from './ResourceAdmin';
import './admin.css';

export function Admin() {
  useBackButton(false);
  const who = useQuery({ queryKey: ['me'], queryFn: () => api<{ admin?: boolean }>('/api/me'), retry: false });
  if (who.isPending) return <Screen title="Settings"><p>Checking access…</p></Screen>;
  if (!who.isSuccess || !who.data?.admin) return <Screen title="Settings"><p>This area is available to admins only.</p></Screen>;
  return <Screen title="Admin"><div className="cms"><p><Link to="/settings/admin">Admin home</Link></p><Routes>
    <Route index element={<AdminHome />} />
    <Route path="timeline" element={<TimelineList />} /><Route path="timeline/:id" element={<TimelineEditor />} />
    <Route path="outside-sources" element={<OutsideSources />} /><Route path="resources" element={<ResourceAdmin />} />
    <Route path="classes" element={<ClassList />} /><Route path="classes/:id" element={<ClassEditor />} /><Route path="notes" element={<NotesAdmin />} />
    <Route path="photos" element={<PhotosAdmin />} />
    <Route path="changes" element={<Changes />} /><Route path="changes/:id" element={<ChangeStatus />} />
    <Route path="people" element={<PeopleList />} /><Route path="people/:id" element={<PeopleEditor />} /><Route path="precepts" element={<PreceptList />} /><Route path="precepts/:id" element={<PreceptEditor />} />
  </Routes></div></Screen>;
}
function AdminHome() {
  return <><p>Correct the app’s content and follow each review through its checks.</p><nav className="cms-list" aria-label="Admin sections">{[['timeline', 'Timeline', 'Events, drafts, sources and pictures'], ['classes', 'Classes', 'Titles, teachers, dates and class notes'], ['people', 'People', 'Summaries and relationships'], ['precepts', 'Precepts', 'Class passages and explanations'], ['outside-sources', 'Outside sources', 'Sites Ask may read'], ['resources', 'Resources', 'Published editions and catalog rollback'], ['photos', 'Photos', 'Existing photo editor'], ['changes', 'Recent changes', 'Reviews, checks and publication']].map(([path, title, sub]) => <Link key={path} to={path}><b>{title}</b><small>{sub}</small></Link>)}</nav></>;
}
function Changes() {
  const q = useInfiniteQuery({ queryKey: ['cms', 'changes'], initialPageParam: '', queryFn: ({ pageParam }) => api<{ changes: CmsChange[]; cursor: string | null }>(`/api/admin/cms/changes${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`), getNextPageParam: page => page.cursor, refetchInterval: 10_000 });
  const changes = q.data?.pages.flatMap(p => p.changes);
  return <><h2>Recent changes</h2>{q.isError ? <p role="alert">{q.error.message}</p> : null}<div className="cms-list">{changes?.map(c => <Link key={c.id} to={c.id}><b>{c.title}</b><small>{c.state} · {c.by.name} · {new Date(c.at).toLocaleString()}</small><small>{c.message}</small></Link>)}</div>{changes && !changes.length ? <p>No changes saved yet.</p> : null}{q.hasNextPage ? <button type="button" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{q.isFetchingNextPage ? 'Loading…' : 'Older changes'}</button> : null}</>;
}
export function ChangeStatus() {
  const { id = '' } = useParams(), client = useQueryClient();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const q = useQuery({ queryKey: ['cms', 'change', id], queryFn: () => api<CmsChange>(`/api/admin/cms/changes/${id}`), refetchInterval: q => q.state.data?.state === 'Checking' ? 3000 : false, retry: false });
  const publish = async () => {
    if (!q.data) return;
    setBusy(true); setError('');
    try { const result = await api<CmsChange>(`/api/admin/cms/changes/${id}/publish`, { method: 'POST', body: JSON.stringify({ head: q.data.head, confirm: 'publish' }) }); client.setQueryData(['cms', 'change', id], result); void client.invalidateQueries({ queryKey: ['cms', 'changes'] }); setConfirm(false); }
    catch (e) { setError((e as Error).message); void q.refetch(); } finally { setBusy(false); }
  };
  if (q.isPending) return <p>Loading review…</p>;
  if (q.isError) return <p role="alert">{q.error.message} <button onClick={() => void q.refetch()}>Retry</button></p>;
  const c = q.data;
  return <><h2>{c.title}</h2><p role="status" className="cms-status"><b>{c.state}</b><br />{c.message}</p><p>Edited by {c.by.name} · {new Date(c.at).toLocaleString()}</p><p>{c.reason}</p>{c.url ? <p><a href={c.url} target="_blank" rel="noopener noreferrer">Open review</a></p> : null}{error ? <p role="alert">{error}</p> : null}<div className="cms-actions"><button type="button" onClick={() => void q.refetch()}>Refresh status</button>{c.pr && c.state !== 'Published' && c.state !== 'Live' && c.state !== 'Closed' ? <button className="btn" type="button" disabled={!c.canPublish} onClick={() => setConfirm(true)}>Publish</button> : null}</div>
    <Sheet open={confirm} onClose={() => setConfirm(false)} title="Publish change" subTitle={c.title} height="half"><div className="cms-form"><p>Merge this reviewed version into the app’s content? The server checks the exact version and required checks again. Production deployment still requires its own approval.</p>{error ? <p role="alert">{error}</p> : null}<button className="btn" type="button" disabled={busy} onClick={() => void publish()}>{busy ? 'Publishing…' : 'Confirm publish'}</button><button type="button" className="btn btn--quiet" onClick={() => setConfirm(false)}>Cancel</button></div></Sheet>
  </>;
}
function OutsideSources() {
  const q = useQuery({ queryKey: ['cms', 'sources'], queryFn: () => api<{ hosts: string[]; defaults: string[]; sha: string }>('/api/admin/ask-sources'), refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (q.isPending) return <p>Loading outside sources…</p>;
  if (q.isError) return <p role="alert">{q.error.message}</p>;
  return <SourcesForm key={q.data.sha} initial={q.data} />;
}
function SourcesForm({ initial }: { initial: { hosts: string[]; defaults: string[]; sha: string } }) {
  const [hosts, setHosts] = useState(initial.hosts), [site, setSite] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false); const navigate = useNavigate();
  const save = async () => { setBusy(true); setError(''); try { const c = await api<CmsChange>('/api/admin/ask-sources', { method: 'PUT', body: JSON.stringify({ sha: initial.sha, hosts, reason }) }); navigate(`/settings/admin/changes/${c.id}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <><h2>Outside sources</h2><p>Changes are reviewed before they apply. A default site can be removed; its default label remains visible.</p><div className="cms-list">{[...new Set([...hosts, ...initial.defaults])].sort().map(h => <div key={h}><span><b>{h}</b>{initial.defaults.includes(h) ? <small>Default</small> : null}</span><button type="button" onClick={() => setHosts(hosts.includes(h) ? hosts.filter(x => x !== h) : [...hosts, h])}>{hosts.includes(h) ? 'Remove' : 'Restore'}</button></div>)}</div><Field label="Site to add" value={site} onChange={setSite} /><button type="button" onClick={() => { const h = site.trim().toLowerCase(); if (h && !hosts.includes(h)) setHosts([...hosts, h]); setSite(''); }}>Add site</button><Field label="Reason for changing these sites" multiline value={reason} onChange={setReason} />{error ? <p role="alert">{error}</p> : null}<button type="button" className="btn" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Save for review'}</button></>;
}
function NotesAdmin() {
  const [params, setParams] = useSearchParams(), navigate = useNavigate();
  const [query, setQuery] = useState(''), [file, setFile] = useState(params.get('file') ?? '');
  const notes = useQuery({ queryKey: ['notes'], queryFn: data.notes, staleTime: 60_000 });
  const chosen = params.get('file');
  const source = useQuery({ queryKey: ['cms', 'note', chosen], enabled: !!chosen, queryFn: () => api<{ ok: boolean; text: string; sha: string; error?: string }>(`/api/notes/source?file=${encodeURIComponent(chosen!)}`) });
  const text = source.data?.text ?? '';
  const value = (name: string) => new RegExp(`^${name}:[ \t]*["']?(.*?)["']?$`, 'm').exec(text)?.[1] ?? '';
  const note: Note = { kind: 'class', title: value('title'), teacher: value('teacher'), file: chosen, body: text, url: '' };
  return <><h2>Classes and notes</h2><p>Open a class note’s Edit button, or select its source file below. Saving creates a review.</p><Field label="Source note file" value={file} onChange={setFile} /><button type="button" onClick={() => setParams({ file })}>Open note editor</button>{source.isError ? <p role="alert">{source.error.message}</p> : null}{source.data && !source.data.ok ? <p role="alert">{source.data.error}</p> : null}
    <Field label="Find a class note" value={query} onChange={setQuery} /><div className="cms-list">{notes.data?.filter(n => ['class', 'captains'].includes(n.kind) && n.title.toLowerCase().includes(query.toLowerCase())).slice(0, 80).map(n => <Link key={n.url} to={`/note${n.url}`}><b>{n.title}</b><small>{n.teacher}</small></Link>)}</div>
    {chosen && source.data?.ok ? <NoteEditSheet key={chosen} open note={note} initialSource={source.data} onClose={() => setParams({})} onSaved={(_changes, _url, id) => navigate(`/settings/admin/changes/${id}`)} /> : null}
  </>;
}
function PhotosAdmin() {
  const photos = usePhotos(); const [kind, setKind] = useState('event'), [id, setId] = useState('');
  const valid = /^[a-z0-9][a-z0-9-]{0,79}$/.test(id), slot = `${kind}:${id}` as PhotoSlot;
  return <><h2>Photos</h2><p>Use the existing photo editor for an event, period or leader. Photo changes apply immediately.</p><Select label="Photo type" value={kind} onChange={setKind} options={['event', 'period', 'leader'].map(v => ({ id: v, title: v }))} /><Field label="Photo content id" value={id} onChange={setId} />{valid ? <PhotoEdit key={slot} slot={slot} label={id} shape={kind === 'period' ? 'cover' : 'square'} hasPhoto={!!photos.data?.[slot]} /> : null}<div className="cms-list">{Object.keys(photos.data ?? {}).map(slot => <button key={slot} type="button" onClick={() => { const [k, i] = slot.split(':'); setKind(k); setId(i); }}>{slot}</button>)}</div></>;
}
