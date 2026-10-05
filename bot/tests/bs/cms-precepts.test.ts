import test from 'node:test';
import assert from 'node:assert/strict';
import { PreceptPass, PreceptSave, preceptSeconds, samePreceptStructure } from '../../../shared/cms-precepts.ts';
const fixture = () => ({video:'ABCDEFGHIJK',title:'Validation fixture',date:'2024-02-29',passages:[{opened:'Genesis 1:1-3',ts:'1:00',sense:[{at:'1',text:'Owner supplied explanation'}],precepts:[{ref:'John 1:1',at:'1',why:'Owner supplied reason'}]}]});
test('precept validation resolves 1611 references and keeps optional moments absent',()=>{
  const pass=PreceptPass.parse(fixture());assert.equal(pass.passages[0].precepts[0].ts,undefined);
  for(const ref of ['Ecclesiasticus 1:1','History of Susanna 1:1','First Esdras 1:1','Song of the Three Holy Children 1:1']) {
    const p=fixture();p.passages[0].precepts[0].ref=ref;assert.ok(PreceptPass.safeParse(p).success,ref);
  }
  assert.equal(preceptSeconds('1:23:45'),5025);assert.equal(preceptSeconds('95:10'),5710);
});
test('invalid dates, verse positions, references, timestamps, empty explanations and unknown keys fail',()=>{
  for(const mutate of [
    (p:any)=>p.date='2025-02-29',(p:any)=>p.passages[0].precepts[0].ref='John 1:999',
    (p:any)=>p.passages[0].sense[0].at='0',(p:any)=>p.passages[0].precepts[0].at='3-4',
    (p:any)=>p.passages[0].precepts[0].why=' ',(p:any)=>p.passages[0].sense[0].text='',
    (p:any)=>p.passages[0].ts='1:60',(p:any)=>p.passages[0].precepts[0].ts='1:99:00',
    (p:any)=>p.passages[0].precepts[0].ts='',(p:any)=>p.passages.push({...p.passages[0],ts:'0:59'}),
    (p:any)=>p.path='engine/build.mjs',
  ]){const p=fixture();mutate(p);assert.equal(PreceptPass.safeParse(p).success,false,JSON.stringify(p));}
  assert.equal(PreceptSave.safeParse({video:'../escape',sha:'a'.repeat(40),pass:fixture(),reason:'Test correction'}).success,false);
});
test('explanations and moments can change but the recorded reference structure cannot',()=>{
  const before=PreceptPass.parse(fixture()),after=structuredClone(before);
  after.passages[0].precepts[0].why='Corrected explanation';after.passages[0].precepts[0].at='2';after.passages[0].precepts[0].ts='1:30';assert.ok(samePreceptStructure(before,after));
  for(const mutate of [(p:any)=>p.passages[0].opened='Genesis 2:1',(p:any)=>p.passages[0].precepts[0].ref='John 1:2',(p:any)=>p.title='Changed class',(p:any)=>p.passages.push(p.passages[0])]){const p=structuredClone(after);mutate(p);assert.equal(samePreceptStructure(before,p),false);}
});
