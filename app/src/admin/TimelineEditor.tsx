import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from './client';
import { Sheet } from '@/bible/ui/Sheet';
import type { CmsChange, TimelineEntry, CmsPeriod } from '@shared/cms';
import { Field, Group, Multi, Select, Strings } from './fields';

export function TimelineList() {
  const [query, setQuery] = useState('');
  const entries = useQuery({ queryKey: ['cms', 'timeline'], queryFn: () => api<{ entries: { id: string; title: string; draft: boolean }[] }>('/api/admin/cms/timeline') });
  return <><p><Link className="btn" to="new">Add event</Link></p><Field label="Find an event" value={query} onChange={setQuery} />{entries.isError ? <p role="alert">The Timeline could not be loaded. Check the app repository token and try again.</p> : null}<div className="cms-list">{entries.data?.entries.filter(e => e.title.toLowerCase().includes(query.toLowerCase())).map(e => <Link key={e.id} to={e.id}><b>{e.title}</b><small>{e.draft ? 'Draft' : 'Published'}</small></Link>)}</div></>;
}
type Source = { event: TimelineEntry | null; draft: boolean; shas: { events: string; drafts: string }; periods: CmsPeriod[]; groups: string[]; tribes: string[]; peoples: string[]; leaders: { id: string; name: string }[] };
export function TimelineEditor() {
  const { id = 'new' } = useParams();
  const source = useQuery({ queryKey: ['cms', 'timeline', id], queryFn: () => api<Source>(`/api/admin/cms/timeline/${encodeURIComponent(id)}`), staleTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (source.isPending) return <p>Loading event…</p>;
  if (source.isError) return <p role="alert">{source.error.message} <button type="button" onClick={() => void source.refetch()}>Retry</button></p>;
  return <TimelineForm key={`${id}:${source.data.shas.events}:${source.data.shas.drafts}`} source={source.data} />;
}
function TimelineForm({ source }: { source: Source }) {
  const navigate = useNavigate();
  const [event, setEvent] = useState<Omit<TimelineEntry, 'date'> & { date?: { text: string; precision: NonNullable<TimelineEntry['date']>['precision'] | '' } }>(source.event ?? { slug: '', title: '', period: '' });
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof event>(k: K, value: (typeof event)[K]) => setEvent(e => ({ ...e, [k]: value }));
  const save = async (action: 'add' | 'edit' | 'publish' | 'unpublish') => {
    setBusy(true); setError('');
    try {
      const change = await api<CmsChange>('/api/admin/cms/timeline', { method: 'POST', body: JSON.stringify({ id: event.slug, action, draft: source.draft, event, shas: source.shas, reason }) });
      navigate(`/settings/admin/changes/${change.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const refs = (key: 'scriptures' | 'answer', title: string) => <Group title={title}>{(event[key] ?? []).map((r, i) => <fieldset className="cms-group" key={i}><legend>{title} {i + 1}</legend><Field label={`${title} ${i + 1} reference`} value={r.ref} onChange={ref => set(key, event[key]!.map((x, n) => n === i ? { ...x, ref } : x))} /><Field label={`${title} ${i + 1} explanation`} value={r.why} multiline onChange={why => set(key, event[key]!.map((x, n) => n === i ? { ...x, why } : x))} /><button type="button" className="link" onClick={() => set(key, event[key]!.filter((_, n) => n !== i))}>Remove reference {i + 1}</button></fieldset>)}<button type="button" className="link" onClick={() => set(key, [...(event[key] ?? []), { ref: '' }])}>Add {title.toLowerCase()} reference</button></Group>;
  return <Sheet open height="full" title={source.event ? 'Edit Timeline event' : 'Add Timeline event'} subTitle={source.draft ? 'Draft event' : 'Published event'} onClose={() => navigate('/settings/admin/timeline')} footer={<div className="cms-actions"><button className="btn" type="button" disabled={busy || reason.trim().length < 3} onClick={() => void save(source.event ? 'edit' : 'add')}>{busy ? 'Saving…' : 'Save for review'}</button>{source.event ? <button className="btn btn--quiet" disabled={busy || reason.trim().length < 3} onClick={() => void save(source.draft ? 'publish' : 'unpublish')}>{source.draft ? 'Move to published' : 'Move to drafts'}</button> : null}</div>}>
    <form className="cms-form" onSubmit={e => e.preventDefault()}>
      <p>Save opens a review. Nothing changes for readers until you publish the reviewed change and approve deployment. Leave unknown facts blank; the editor supplies no dates, quotes or references.</p>
      {error ? <p role="alert" className="cms-error">{error}</p> : null}
      <Field label="Event id" value={event.slug} readOnly={!!source.event} onChange={v => set('slug', v)} />
      <Field label="Title" value={event.title} onChange={v => set('title', v)} />
      <Field label="Summary" multiline value={event.summary} onChange={v => set('summary', v)} />
      <Select label="Period" value={event.period} options={source.periods} onChange={v => set('period', v)} />
      <Select label="Group" value={event.group} options={source.groups.map(v => ({ id: v, title: v }))} onChange={v => set('group', v || undefined)} />
      <Group title="Dates and place"><Field label="Start year (negative for BC)" type="number" value={event.start ?? ''} onChange={v => set('start', v === '' ? undefined : Number(v))} /><Field label="End year (negative for BC)" type="number" value={event.end ?? ''} onChange={v => set('end', v === '' ? undefined : Number(v))} />
        <Field label="Date as the source states it" value={event.date?.text} onChange={v => set('date', { text: v, precision: event.date?.precision ?? '' })} />
        <Select label="Date precision" value={event.date?.precision} options={['day', 'month', 'year', 'circa', 'range', 'decade'].map(v => ({ id: v, title: v }))} onChange={v => set('date', { text: event.date?.text ?? '', precision: v as NonNullable<TimelineEntry['date']>['precision'] })} />
        <button className="link" type="button" onClick={() => setEvent(({ start: _start, end: _end, date: _date, ...rest }) => rest)}>Clear unknown dates</button>
        <Field label="Place" value={event.place} onChange={v => set('place', v)} /><Field label="Region" value={event.region} onChange={v => set('region', v)} />
      </Group>
      <Group title="People and tribes"><Multi label="Tribes" values={event.tribes} options={source.tribes} onChange={v => set('tribes', v)} /><Multi label="Peoples" values={event.peoples} options={source.peoples} onChange={v => set('peoples', v)} /><Strings label="Named people" values={event.people} onChange={v => set('people', v)} /><Select label="Leader" value={event.leader} options={source.leaders.map(l => ({ id: l.id, title: l.name ?? l.id }))} onChange={v => set('leader', v || undefined)} /></Group>
      <Group title="Account"><Strings label="Account paragraph" values={event.account} multiline onChange={v => set('account', v)} /></Group>
      <Group title="Sources">{(event.sources ?? []).map((s, i) => <fieldset key={i} className="cms-group"><legend>Source {i + 1}</legend>{(['title', 'url', 'author', 'publisher', 'year', 'accessed', 'supports', 'via'] as const).map(k => <Field key={k} label={`Source ${i + 1} ${k}`} value={s[k]} multiline={k === 'supports'} onChange={v => set('sources', event.sources!.map((x, n) => n === i ? { ...x, [k]: v } : x))} />)}<button className="link" type="button" onClick={() => set('sources', event.sources!.filter((_, n) => n !== i))}>Remove source {i + 1}</button></fieldset>)}<button className="link" type="button" onClick={() => set('sources', [...(event.sources ?? []), { title: '', url: '' }])}>Add source</button></Group>
      {refs('scriptures', 'Scriptures')}{refs('answer', 'Answer')}
      <Group title="Class teaching">{(event.teaching ?? []).map((t, i) => <fieldset key={i} className="cms-group"><legend>Teaching {i + 1}</legend>
        <Select label={`Teaching ${i + 1} kind`} value={t.source.kind} options={['class', 'history', 'site', 'note'].map(v => ({ id: v, title: v }))} onChange={v => set('teaching', event.teaching!.map((x, n) => n === i ? { ...x, source: { ...x.source, kind: v as typeof t.source.kind } } : x))} />
        {(['title', 'url', 'id', 'ts', 'date'] as const).map(k => <Field key={k} label={`Teaching ${i + 1} ${k === 'id' ? 'video id' : k === 'ts' ? 'timestamp' : k}`} value={t.source[k]} onChange={v => set('teaching', event.teaching!.map((x, n) => n === i ? { ...x, source: { ...x.source, [k]: v } } : x))} />)}
        <Field label={`Teaching ${i + 1} teacher`} value={t.teacher} onChange={v => set('teaching', event.teaching!.map((x, n) => n === i ? { ...x, teacher: v } : x))} />
        <Field label={`Teaching ${i + 1} quote`} value={t.quote} multiline onChange={v => set('teaching', event.teaching!.map((x, n) => n === i ? { ...x, quote: v } : x))} />
        <Strings label={`Teaching ${i + 1} points`} values={t.points} multiline onChange={v => set('teaching', event.teaching!.map((x, n) => n === i ? { ...x, points: v } : x))} /><button className="link" type="button" onClick={() => set('teaching', event.teaching!.filter((_, n) => n !== i))}>Remove teaching {i + 1}</button>
      </fieldset>)}<button className="link" type="button" onClick={() => set('teaching', [...(event.teaching ?? []), { source: { kind: 'class', title: '', url: '' }, points: [] }])}>Add teaching</button></Group>
      <Group title="Picture">{event.image ? <><Select label="Picture kind" value={event.image.kind} options={['archival', 'generated'].map(v => ({ id: v, title: v }))} onChange={v => set('image', { ...event.image!, kind: v as 'archival' | 'generated' })} />{(['src', 'caption', 'credit', 'license', 'sourceUrl'] as const).map(k => <Field key={k} label={`Picture ${k}`} value={event.image![k]} onChange={v => set('image', { ...event.image!, [k]: v })} />)}<button type="button" className="link" onClick={() => set('image', undefined)}>Remove picture</button></> : <button type="button" className="link" onClick={() => set('image', { kind: 'archival', src: '', caption: '' })}>Add picture details</button>}</Group>
      <Group title="Uncertainty and disagreements"><Field label="Uncertainty" multiline value={event.uncertainty} onChange={v => set('uncertainty', v)} /><Field label="Still needed for this draft" multiline value={event.needs} onChange={v => set('needs', v)} />{(event.disagreements ?? []).map((d, i) => <fieldset key={i} className="cms-group"><Field label={`Disagreement ${i + 1}`} value={d.point} onChange={v => set('disagreements', event.disagreements!.map((x, n) => n === i ? { ...x, point: v } : x))} /><Strings label={`Disagreement ${i + 1} views`} values={d.views} multiline onChange={v => set('disagreements', event.disagreements!.map((x, n) => n === i ? { ...x, views: v } : x))} /><button type="button" className="link" onClick={() => set('disagreements', event.disagreements!.filter((_, n) => n !== i))}>Remove disagreement {i + 1}</button></fieldset>)}<button type="button" className="link" onClick={() => set('disagreements', [...(event.disagreements ?? []), { point: '', views: [] }])}>Add disagreement</button></Group>
      <Field label="Reason for this change" multiline value={reason} onChange={setReason} />
    </form>
  </Sheet>;
}
