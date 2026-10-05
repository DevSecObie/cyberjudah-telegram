import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import type { PreceptSave } from '@shared/cms-precepts';
import type { CmsChange } from '@shared/cms';
import { Sheet } from '@/bible/ui/Sheet';
import { api } from './client';
import { Field } from './fields';
type Source = Omit<z.infer<typeof PreceptSave>, 'reason'>;
export function PreceptList() {
  const [query, setQuery] = useState('');
  const q = useQuery({ queryKey: ['cms', 'precepts'], queryFn: () => api<{ passes: { video: string }[] }>('/api/admin/cms/precepts') });
  return <><h2>Precept passes</h2><p>Open Edit beside a class’s precept, or find its recording id here.</p><Field label="Find a recording id" value={query} onChange={setQuery} />{q.isError ? <p role="alert">{q.error.message}</p> : null}<div className="cms-list">{q.data?.passes.filter(p => p.video.toLowerCase().includes(query.toLowerCase())).map(p => <Link key={p.video} to={p.video}><b>{p.video}</b><small>Class passages and explanations</small></Link>)}</div></>;
}
export function PreceptEditor() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['cms', 'precept', id], queryFn: () => api<Source>(`/api/admin/cms/precepts/${encodeURIComponent(id)}`), refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (q.isPending) return <p>Loading precept pass…</p>;
  if (q.isError) return <p role="alert">{q.error.message}</p>;
  return <PreceptForm key={q.data.sha} source={q.data} />;
}
function PreceptForm({ source }: { source: Source }) {
  const [pass, setPass] = useState(source.pass), [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const update = (index: number, change: Partial<Source['pass']['passages'][number]>) => setPass({ ...pass, passages: pass.passages.map((p, i) => i === index ? { ...p, ...change } : p) });
  const save = async () => {
    setBusy(true); setError('');
    try { const c = await api<CmsChange>('/api/admin/cms/precepts', { method: 'POST', body: JSON.stringify({ ...source, pass, reason }) }); navigate(`/settings/admin/changes/${c.id}`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Sheet open title="Edit precept pass" subTitle={pass.title} height="full" onClose={() => navigate('/settings/admin/precepts')} footer={<div className="cms-actions"><button className="btn" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Save for review'}</button></div>}><div className="cms-form">
    <p>{pass.date} · {pass.teacher || 'Teacher not recorded'}</p><p>Keep the class’s own explanation and exact scripture words. References stay as recorded. Leave a precept’s optional timestamp blank to use the opened passage’s time.</p>
    {pass.passages.map((p, i) => <details className="cms-disclosure" key={i} open={i === 0}>
      <summary>{i + 1}. {p.opened}</summary>
      <Field label={`Passage ${i + 1} reference`} value={p.opened} readOnly onChange={() => {}} />
      <Field label={`Passage ${i + 1} timestamp`} value={p.ts} onChange={ts => update(i, { ts })} />
      <fieldset className="cms-group"><legend>Sense of the passage</legend>{p.sense?.map((s, j) => <div key={j}>
        <Field label={`Passage ${i + 1} sense ${j + 1} verse`} value={s.at} onChange={at => update(i, { sense: p.sense!.map((x, n) => n === j ? { ...x, at } : x) })} />
        <Field label={`Passage ${i + 1} sense ${j + 1} explanation`} multiline value={s.text} onChange={text => update(i, { sense: p.sense!.map((x, n) => n === j ? { ...x, text } : x) })} />
        <button type="button" onClick={() => update(i, { sense: p.sense!.filter((_, n) => n !== j) })}>Remove sense {j + 1}</button>
      </div>)}<button type="button" onClick={() => update(i, { sense: [...(p.sense ?? []), { at: '', text: '' }] })}>Add sense to passage {i + 1}</button></fieldset>
      {p.precepts.map((pre, j) => <fieldset className="cms-group" key={j}><legend>{pre.ref}</legend>
        <Field label={`Passage ${i + 1} precept ${j + 1} reference`} readOnly value={pre.ref} onChange={() => {}} />
        <Field label={`Passage ${i + 1} precept ${j + 1} verse`} value={pre.at} onChange={at => update(i, { precepts: p.precepts.map((x, n) => n === j ? { ...x, at } : x) })} />
        <Field label={`Passage ${i + 1} precept ${j + 1} why`} multiline value={pre.why} onChange={why => update(i, { precepts: p.precepts.map((x, n) => n === j ? { ...x, why } : x) })} />
        <Field label={`Passage ${i + 1} precept ${j + 1} timestamp (optional)`} value={pre.ts} onChange={ts => update(i, { precepts: p.precepts.map((x, n) => { if (n !== j) return x; const copy = { ...x }; if (ts) copy.ts = ts; else delete copy.ts; return copy; }) })} />
      </fieldset>)}
    </details>)}
    <Field label="Reason for this change" multiline value={reason} onChange={setReason} />{error ? <p role="alert">{error}</p> : null}
  </div></Sheet>;
}
