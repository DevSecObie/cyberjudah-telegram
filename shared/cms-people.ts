import { z } from 'zod';
import { FileSha, Reason } from './cms';
export const Relationships = ['father','mother','siblings','partners','children'] as const;
const PersonId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const url = z.string().url().refine(s=>new URL(s).protocol === 'https:','Use an HTTPS image or source URL');
export const PersonPicture = z.strictObject({src:url,caption:z.string().trim().min(1).max(2000),credit:z.string().trim().min(1).max(500),license:z.string().trim().min(1).max(500),sourceUrl:url});
export const PersonEdit = z.strictObject({ description:z.string().max(50_000),father:z.array(PersonId).max(100),mother:z.array(PersonId).max(100),siblings:z.array(PersonId).max(100),partners:z.array(PersonId).max(100),children:z.array(PersonId).max(200),image:PersonPicture.nullable() });
export const PersonSave = z.strictObject({id:PersonId,sha:FileSha,value:PersonEdit,reason:Reason});
export type PersonRecord = { id:string;name:string;type:string;description:string;father:string[];mother:string[];siblings:string[];partners:string[];children:string[];image?:z.infer<typeof PersonPicture>;[key:string]:unknown };
/** Only explicit edits change relatives; existing unresolved source ids remain untouched. */
export function applyPersonEdit(people:PersonRecord[], id:string, value:z.infer<typeof PersonEdit>) {
  const records=structuredClone(people), byId=new Map(records.map(p=>[p.id,p])), person=byId.get(id);
  if(!person)throw new Error('Person not found.');
  for(const kind of Relationships) {
    if(new Set(value[kind]).size!==value[kind].length)throw new Error(`A ${kind} relationship is listed twice.`);
    for(const relative of value[kind])if(relative===id||!byId.has(relative)&&!person[kind].includes(relative))throw new Error('Choose another person already in the catalog.');
  }
  if(value.father.some(id=>value.mother.includes(id)))throw new Error('The same person cannot be entered as both father and mother.');
  if(person.type!=='Male'&&person.type!=='Female'&&JSON.stringify(value.children)!==JSON.stringify(person.children))throw new Error('For a group, edit the child’s named father or mother instead.');
  const parentLinks:[string,string][]=[];
  for(const kind of Relationships) {
    const previous=person[kind], next=value[kind];
    const inverse=kind==='father'||kind==='mother'?'children':kind==='children'?(person.type==='Male'?'father':'mother'):kind;
    for(const other of previous.filter(v=>!next.includes(v))){const record=byId.get(other);if(record)record[inverse]=record[inverse].filter(v=>v!==id);}
    for(const other of next.filter(v=>!previous.includes(v))){const record=byId.get(other)!;if(!record[inverse].includes(id))record[inverse].push(id);if(kind==='father'||kind==='mother')parentLinks.push([id,other]);if(kind==='children')parentLinks.push([other,id]);}
    person[kind]=[...next];
  }
  const ancestor=(from:string,target:string,seen=new Set<string>()):boolean=>{if(from===target)return true;if(seen.has(from))return false;seen.add(from);const p=byId.get(from);return !!p&&[...p.father,...p.mother].some(x=>ancestor(x,target,seen));};
  for(const [child,parent]of parentLinks)if(ancestor(parent,child))throw new Error('This relationship would make a person their own ancestor.');
  person.description=value.description;if(value.image)person.image=value.image;else delete person.image;
  return records;
}
