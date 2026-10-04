import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import type { ClassSave } from '@shared/cms-classes';
import type { CmsChange } from '@shared/cms';
import { Sheet } from '@/bible/ui/Sheet';
import { api } from './client';
import { Field } from './fields';
type Source = Omit<z.infer<typeof ClassSave>,'reason'>;
export function ClassList() {
  const [query,setQuery]=useState(''),[undated,setUndated]=useState(false);
  const q=useQuery({queryKey:['cms','classes'],queryFn:()=>api<{classes:(Source['value']&{file:string|null})[]}>('/api/admin/cms/classes')});
  return <><h2>Classes</h2><p>Correct a title, teacher or date. Unknown dates stay blank until you provide one.</p><p><Link to="/settings/admin/notes">Open the class note text editor</Link></p><Field label="Find a class" value={query} onChange={setQuery}/><label><input type="checkbox" checked={undated} onChange={e=>setUndated(e.target.checked)}/> Undated classes only</label>{q.isError?<p role="alert">{q.error.message}</p>:null}<div className="cms-list">{q.data?.classes.filter(c=>(!undated||!c.date)&&`${c.title} ${c.teacher} ${c.video}`.toLowerCase().includes(query.toLowerCase())).slice(0,100).map(c=><Link key={c.video} to={c.video}><b>{c.title}</b><small>{c.date||'Date unknown'} · {c.teacher||'Teacher not recorded'}</small></Link>)}</div></>;
}
export function ClassEditor() {
  const {id=''}=useParams();
  const q=useQuery({queryKey:['cms','class',id],queryFn:()=>api<Source>(`/api/admin/cms/classes/${encodeURIComponent(id)}`),refetchOnWindowFocus:false,refetchOnReconnect:false});
  if(q.isPending)return <p>Loading class details…</p>;if(q.isError)return <p role="alert">{q.error.message}</p>;
  return <ClassForm source={q.data} key={`${q.data.tableSha}:${q.data.note?.sha}`}/>;
}
function ClassForm({source}:{source:Source}) {
  const [value,setValue]=useState(source.value),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const navigate=useNavigate();
  const save=async()=>{setBusy(true);setError('');try{const c=await api<CmsChange>('/api/admin/cms/classes',{method:'POST',body:JSON.stringify({...source,value,reason})});navigate(`/settings/admin/changes/${c.id}`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Sheet open title="Edit class details" subTitle={value.video} height="full" onClose={()=>navigate('/settings/admin/classes')} footer={<div className="cms-actions"><button className="btn" disabled={busy||reason.trim().length<3} onClick={()=>void save()}>{busy?'Saving…':'Save for review'}</button></div>}><div className="cms-form"><Field label="Class title" value={value.title} onChange={title=>setValue({...value,title})}/><Field label="Teacher" value={value.teacher} onChange={teacher=>setValue({...value,teacher})}/><Field label="Class date" type="date" value={value.date} onChange={date=>setValue({...value,date})}/><p>Leave an unknown date blank. Use the date supported by the recording or its source.</p>{source.note?<Link to={`/settings/admin/notes?file=${encodeURIComponent(source.note.file)}`}>Edit the full class note</Link>:<p>This recording has no class note yet.</p>}<Field label="Reason for this change" multiline value={reason} onChange={setReason}/>{error?<p role="alert">{error}</p>:null}</div></Sheet>;
}
