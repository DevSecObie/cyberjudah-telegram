import { z } from 'zod';
import { CalendarDate, FileSha, Reason, resolveScripture } from './cms';
import { VideoId } from './cms-classes';
export function preceptSeconds(ts:string){if(!/^\d{1,2}(:\d{2}){1,2}$/.test(ts))return null;const parts=ts.split(':').map(Number);if(parts.slice(1).some(n=>n>59))return null;return parts.reduce((n,v)=>n*60+v,0);}
const stamp=z.string().refine(v=>preceptSeconds(v)!==null,'Use m:ss or h:mm:ss with minutes and seconds below 60');
const reference=z.string().max(200).refine(v=>!!resolveScripture(v),'Reference must resolve to KJV verses');
const explanation=z.string().trim().min(1).max(100_000);
const at=z.string().regex(/^\s*\d+(?:\s*[-–]\s*\d+)?\s*$/);
export function atVerses(value:string,passage:ReturnType<typeof resolveScripture>){const match=/^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(value);if(!match||!passage)return false;const start=+match[1],end=+(match[2]??match[1]);return end>=start&&end-start<=1000&&Array.from({length:end-start+1},(_,i)=>start+i).every(v=>passage.verses.includes(v));}
const passage=z.strictObject({opened:reference,teacher:z.string().max(200).optional(),ts:stamp,sense:z.array(z.strictObject({at,text:explanation})).max(1000).optional(),precepts:z.array(z.strictObject({ref:reference,at,why:explanation,ts:stamp.optional()})).max(1000)});
export const PreceptPass=z.strictObject({video:VideoId,title:z.string().trim().min(1).max(1000),date:CalendarDate,teacher:z.string().max(200).optional(),passages:z.array(passage).min(1).max(1000)}).superRefine((pass,ctx)=>{
 let last=-1;
 pass.passages.forEach((p,i)=>{
  const seconds=preceptSeconds(p.ts)!;if(seconds<last)ctx.addIssue({code:'custom',path:['passages',i,'ts'],message:'Passage timestamps must stay in recording order'});last=seconds;
  const opened=resolveScripture(p.opened);
  for(const key of ['sense','precepts']as const)(p[key]??[]).forEach((entry,j)=>{if(!atVerses(entry.at,opened))ctx.addIssue({code:'custom',path:['passages',i,key,j,'at'],message:'This verse must be inside the opened passage'});});
 });
});
export const PreceptSave=z.strictObject({video:VideoId,sha:FileSha,pass:PreceptPass,reason:Reason});
export function samePreceptStructure(before:z.infer<typeof PreceptPass>,after:z.infer<typeof PreceptPass>){
 const structural=(p:z.infer<typeof PreceptPass>)=>({video:p.video,title:p.title,date:p.date,teacher:p.teacher,passages:p.passages.map(x=>({opened:x.opened,teacher:x.teacher,precepts:x.precepts.map(r=>r.ref)}))});
 return JSON.stringify(structural(before))===JSON.stringify(structural(after));
}
