import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassMetadata, parseClassTable, writeClassTable, updateClassNote, noteField, CLASS_HEADER } from '../../../shared/cms-classes.ts';
import { applyClassCorrection } from '../../src/class-corrections.ts';
test('class validation, TSV round trip and literal front matter edits reject malformed dates and preserve the body',()=>{
  const value={video:'ABCDEFGHIJK',teacher:'Bishop $&',date:'2024-02-29',title:'Quoted "title"'};
  assert.ok(ClassMetadata.safeParse(value).success);
  for(const patch of [{date:'2025-02-29'},{teacher:'Injected\nfield:'},{title:''},{video:'../bad'}])assert.equal(ClassMetadata.safeParse({...value,...patch}).success,false);
  const rows=new Map([[value.video,value]]);assert.deepEqual([...parseClassTable(writeClassTable(rows))],[...rows]);
  assert.throws(()=>parseClassTable(`${CLASS_HEADER}\n${writeClassTable(rows).split('\n')[1]}\n${writeClassTable(rows).split('\n')[1]}\n`));
  const body='---\ntitle: Old\nslug: keep-this-url\n---\n\nEvery original word.';
  const changed=updateClassNote(body,value);assert.equal(changed.slice(changed.indexOf('\n---\n')),body.slice(body.indexOf('\n---\n')));
  assert.equal(noteField(changed,'teacher'),'Bishop $&');assert.equal(noteField(changed,'title'),value.title);assert.ok(changed.includes('slug: keep-this-url'));
});
test('published metadata corrects transcript and search display without replacing recording identifiers or text',()=>{
  const row={video:'ABCDEFGHIJK',title:'Old title',matchedTitle:'Old title',date:'',chunks:[{t:1,text:'Verbatim transcript'}]};
  const changed=applyClassCorrection(row,{ABCDEFGHIJK:{title:'Recorded title',teacher:'Recorded teacher',date:'2024-01-01'}});
  assert.equal(changed.title,'Recorded title');assert.equal(changed.date,'2024-01-01');assert.equal(changed.matchedTitle,'Recorded title');assert.equal(changed.video,row.video);assert.deepEqual(changed.chunks,row.chunks);
  assert.deepEqual(applyClassCorrection(row,{}),row);
});


test('blank front matter fields do not consume the following field as their value',()=>{
  const source='---\ntitle: Known title\nteacher:   \ndate:\nslug: keep-the-link\n---\nBody';
  assert.equal(noteField(source,'teacher'),'');assert.equal(noteField(source,'date'),'');
  const changed=updateClassNote(source,{video:'ABCDEFGHIJK',title:'Known title',teacher:'',date:'2024-01-01'});
  assert.equal(noteField(changed,'date'),'2024-01-01');assert.equal(noteField(changed,'teacher'),'');
  assert.ok(changed.includes('slug: keep-the-link'));
});
