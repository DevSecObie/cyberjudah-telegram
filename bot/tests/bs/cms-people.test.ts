import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonEdit,applyPersonEdit,type PersonRecord } from '../../../shared/cms-people.ts';
const person=(id:string,type='Male'):PersonRecord=>({id,name:id,type,description:'Summary',father:[],mother:[],siblings:[],partners:[],children:[],verses:['genesis/1/1']});
const edit=(p:PersonRecord)=>PersonEdit.parse({description:p.description,father:p.father,mother:p.mother,siblings:p.siblings,partners:p.partners,children:p.children,image:null});
test('editing a relationship changes its matching link and preserves scripture/source details',()=>{
 const rows=[person('father'),person('child'),person('wife','Female')],value={...edit(rows[0]),children:['child'],partners:['wife']};
 const next=applyPersonEdit(rows,'father',value);assert.deepEqual(next[1].father,['father']);assert.deepEqual(next[2].partners,['father']);assert.deepEqual(next[0].verses,rows[0].verses);assert.deepEqual(rows[0].children,[]);
 const removed=applyPersonEdit(next,'father',edit(rows[0]));assert.deepEqual(removed[1].father,[]);assert.deepEqual(removed[2].partners,[]);
});
test('self links, new unknown ids, duplicate relationships and ancestry cycles are refused',()=>{
 const rows=[person('father'),person('child')];rows[0].children=['child'];rows[1].father=['father'];
 for(const patch of [{father:['father']},{siblings:['missing']},{partners:['child','child']},{father:['child']}])assert.throws(()=>applyPersonEdit(rows,'father',{...edit(rows[0]),...patch}));
 const group=person('group','Group');assert.throws(()=>applyPersonEdit([group,rows[1]],'group',{...edit(group),children:['child']}),/group/);
});
test('an existing unresolved source relationship is preserved during a summary correction, with no invented replacement',()=>{
 const p=person('known');p.father=['legacy-unresolved'];const next=applyPersonEdit([p],'known',{...edit(p),description:'Owner supplied correction'});assert.deepEqual(next[0].father,['legacy-unresolved']);
});
test('pictures require HTTPS, captions and credit; removal does not invent a replacement',()=>{
 const p=person('known'),picture={src:'https://example.org/pic.jpg',caption:'Artist’s depiction',credit:'Artist',license:'CC0',sourceUrl:'https://example.org/source'};
 assert.equal(PersonEdit.safeParse({...edit(p),image:{...picture,src:'javascript:alert(1)'}}).success,false);assert.equal(PersonEdit.safeParse({...edit(p),image:{...picture,credit:''}}).success,false);
 const withPicture=applyPersonEdit([p],'known',{...edit(p),image:picture});assert.deepEqual(withPicture[0].image,picture);assert.equal(applyPersonEdit(withPicture,'known',edit(p))[0].image,undefined);
});
