import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { dataJson } from './data';
import { NOTE_FILE } from './edit.mjs';
import { ClassMetadata, ClassSave, VideoId, parseClassTable, writeClassTable, noteField, updateClassNote } from '../../shared/cms-classes';
import { CONTENT_REPO, CLASS_FILE, Github, CmsError, createChange } from './cms-github';
const Catalog = z.array(ClassMetadata.extend({ file:z.string().nullable(), url:z.string().nullable() }).passthrough()).max(20_000);
async function catalog(env: Env) {
  const rows = await dataJson<unknown>(env, '/api/classes/metadata.json');
  if (!rows) throw new CmsError('The class metadata reader needs to be published from the content repository first.',503);
  return Catalog.parse(rows);
}
async function source(env:Env, video:string) {
  VideoId.parse(video);
  const row = (await catalog(env)).find(r=>r.video === video); if (!row) throw new CmsError('Class not found.',404);
  const git = new Github(env,CONTENT_REPO), main = await git.main(), table = await git.file(CLASS_FILE,main.commit.sha), rows = parseClassTable(table.text);
  if (row.file && !NOTE_FILE.test(row.file)) throw new CmsError('The class source file is outside the allowed paths.',403);
  const note = row.file ? await git.file(row.file,main.commit.sha) : null;
  if (note && !note.text.includes(`data-video-id="${video}"`)) throw new CmsError('The class note no longer matches this recording. Refresh its metadata before editing.',409);
  const current = rows.get(video) ?? (note ? { video,title:noteField(note.text,'title'),teacher:noteField(note.text,'teacher'),date:noteField(note.text,'date') } : row);
  const value = ClassMetadata.parse({video:current.video,title:current.title,teacher:current.teacher,date:current.date});
  return { main,table,rows,note,value };
}
export const cmsClasses = new Hono<{Bindings:Env;Variables:{tma:{user?:{id:number;first_name:string;username?:string}}}}>();
cmsClasses.get('/',async c=>c.json({classes:await catalog(c.env)}));
cmsClasses.get('/:video',async c=>{const d=await source(c.env,c.req.param('video'));return c.json({value:d.value,tableSha:d.table.sha,note:d.note ? {file:d.note.path,sha:d.note.sha} : null});});
cmsClasses.post('/',async c=>{
  const input=ClassSave.parse(await c.req.json()), d=await source(c.env,input.value.video);
  if (input.tableSha !== d.table.sha || input.note?.file !== d.note?.path || input.note?.sha !== d.note?.sha) throw new CmsError('Class details changed since you opened them. Reload before saving.',409);
  if (JSON.stringify(input.value) === JSON.stringify(d.value)) throw new CmsError('There is no class detail change to save.');
  d.rows.set(input.value.video,input.value);
  const files=[{...d.table,text:writeClassTable(d.rows)}];
  if(d.note){const text=updateClassNote(d.note.text,input.value);if(text!==d.note.text)files.push({...d.note,text});}
  const user=c.get('tma').user!;
  return c.json(await createChange(c.env,{repo:CONTENT_REPO,kind:'class',subject:input.value.video,title:`Edit class details: ${input.value.title}`,reason:input.reason,base:d.main.commit.sha,files},{id:user.id,name:user.username?`@${user.username}`:user.first_name}),201);
});
