import { Hono } from 'hono';
import type { Env } from './env';
import { VideoId } from '../../shared/cms-classes';
import { PreceptPass,PreceptSave,samePreceptStructure } from '../../shared/cms-precepts';
import { CONTENT_REPO,Github,CmsError,createChange } from './cms-github';
async function source(env:Env,video:string){VideoId.parse(video);const git=new Github(env,CONTENT_REPO),main=await git.main(),file=await git.file(`data/precepts/classes/${video}.json`,main.commit.sha);return{main,file,pass:PreceptPass.parse(JSON.parse(file.text))};}
export const cmsPrecepts=new Hono<{Bindings:Env;Variables:{tma:{user?:{id:number;first_name:string;username?:string}}}}>();
cmsPrecepts.get('/',async c=>{const git=new Github(c.env,CONTENT_REPO),main=await git.main(),files=await git.json<{name:string;type:string}[]>(`/contents/data/precepts/classes?ref=${main.commit.sha}`);return c.json({passes:files.filter(f=>f.type==='file'&&/^[\w-]{11}\.json$/.test(f.name)).map(f=>({video:f.name.slice(0,-5)}))});});
cmsPrecepts.get('/:video',async c=>{const d=await source(c.env,c.req.param('video'));return c.json({video:d.pass.video,sha:d.file.sha,pass:d.pass});});
cmsPrecepts.post('/',async c=>{
 const input=PreceptSave.parse(await c.req.json()),d=await source(c.env,input.video);
 if(input.sha!==d.file.sha)throw new CmsError('This precept pass changed. Reload it before saving.',409);
 if(input.video!==input.pass.video||!samePreceptStructure(d.pass,input.pass))throw new CmsError('Keep the class metadata, opened passages and referenced precepts unchanged. Only explanations, verse positions and timestamps may be edited here.');
 if(JSON.stringify(input.pass)===JSON.stringify(d.pass))throw new CmsError('There is no change to save.');
 const user=c.get('tma').user!;
 return c.json(await createChange(c.env,{repo:CONTENT_REPO,kind:'precept',subject:input.video,title:`Edit precept pass: ${input.pass.title}`,reason:input.reason,base:d.main.commit.sha,files:[{...d.file,text:JSON.stringify(input.pass,null,2)+'\n'}]},{id:user.id,name:user.username?`@${user.username}`:user.first_name}),201);
});
