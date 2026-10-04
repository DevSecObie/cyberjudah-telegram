import { Hono } from 'hono';
import type { Env } from './env';
import { PersonSave, PersonEdit, applyPersonEdit, type PersonRecord } from '../../shared/cms-people';
import { CONTENT_REPO, PEOPLE_FILE, Github, CmsError, createChange } from './cms-github';
async function source(env:Env){const git=new Github(env,CONTENT_REPO),main=await git.main(),file=await git.file(PEOPLE_FILE,main.commit.sha),doc=JSON.parse(file.text) as {people:PersonRecord[]};if(!Array.isArray(doc.people))throw new CmsError('The People source is unavailable.',503);return{main,file,doc};}
export const cmsPeople=new Hono<{Bindings:Env;Variables:{tma:{user?:{id:number;first_name:string;username?:string}}}}>();
cmsPeople.get('/',async c=>{const d=await source(c.env);return c.json({people:d.doc.people.map(p=>({id:p.id,name:p.name}))});});
cmsPeople.get('/:id',async c=>{const d=await source(c.env),p=d.doc.people.find(p=>p.id===c.req.param('id'));if(!p)throw new CmsError('Person not found.',404);return c.json({id:p.id,name:p.name,sha:d.file.sha,value:PersonEdit.parse({description:p.description,father:p.father,mother:p.mother,siblings:p.siblings,partners:p.partners,children:p.children,image:p.image??null}),people:d.doc.people.map(p=>({id:p.id,name:p.name}))});});
cmsPeople.post('/',async c=>{
  const input=PersonSave.parse(await c.req.json()),d=await source(c.env);
  if(input.sha!==d.file.sha)throw new CmsError('The People source changed. Reload before saving your correction.',409);
  let people:PersonRecord[];try{people=applyPersonEdit(d.doc.people,input.id,input.value);}catch(e){throw new CmsError((e as Error).message);}
  if(JSON.stringify(people)===JSON.stringify(d.doc.people))throw new CmsError('There is no change to save.');
  const user=c.get('tma').user!,name=people.find(p=>p.id===input.id)!.name;
  return c.json(await createChange(c.env,{repo:CONTENT_REPO,kind:'person',subject:input.id,title:`Edit person: ${name}`,reason:input.reason,base:d.main.commit.sha,files:[{...d.file,text:JSON.stringify({...d.doc,people})+'\n'}]},{id:user.id,name:user.username?`@${user.username}`:user.first_name}),201);
});
