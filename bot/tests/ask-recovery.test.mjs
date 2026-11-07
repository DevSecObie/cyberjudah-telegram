import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { signInitData } from '../src/initdata.mjs';

const out = new URL('./.build/ask-recovery.mjs', import.meta.url).pathname;
await build({
  stdin: { contents: 'export {default as worker} from "./src/index"; export * from "./src/ai"; export * from "./src/credits"; export * from "./src/ask-requests"; export * from "./src/chats"; export * from "./src/feedback"; export { deleteData } from "./src/mydata";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'offline-answer', setup(b) {
    b.onResolve({filter:/^\.\/approved-answers$/}, () => ({path:'approved',namespace:'approved-fixture'}));
    b.onLoad({filter:/.*/,namespace:'approved-fixture'}, () => ({loader:'js',contents:`
      export const approvedFor = q => q === 'Approved fixture question?' ? {answer:'Original fixture words [1].'} : null;
      export const approvedSources = () => [{n:1,kind:'web',title:'Existing source',url:'https://example.test/source',text:''}];
    `}));
    b.onResolve({filter:/^\.\/agent$/}, () => ({path:'agent',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({loader:'js',contents:`
      export async function runAgent(env,q,history,first,retrieve,emit,ctx,uid,model,spend,resources,rounds,tools,options) {
        env.calls.push({uid,model:model.id});
        spend.modelUsd += 0.001;
        if (env.mode !== 'before-text') emit({delta:'Original fixture words [1].'});
        env.entered?.();
        if (env.gate) await new Promise((resolve,reject) => {
          const stop = () => reject(options.signal.reason);
          options.signal.addEventListener('abort',stop,{once:true});
          if(options.signal.aborted) stop();
          env.gate.then(resolve,reject).finally(() => options.signal.removeEventListener('abort',stop));
        });
        if(env.failAnswer) throw new Error('fixture failure');
        return {text:'Original fixture words [1].', passages:[{kind:'spoken',title:'Existing source',url:'/classes/existing',text:'Original fixture words.'}],actions:[],cut:false};
      }
    `}));
  }}],
});
const api = await import(out);
const test = (name, fn) => nodeTest(name, {timeout:5000}, fn);
const MODEL = 'anthropic/claude-sonnet-5.5';
const body = extra => ({q:'Existing fixture question?',model:MODEL,stream:true,consent:['Anthropic'],caps:{[MODEL]:200_000},request:'recovery-fixture-1',...extra});
function setup(t, overrides = {}) {
  const jobs = [];
  let env;
  t.after(async()=>{env?.release?.(); await Promise.allSettled(jobs);});
  const db = financialDb(t);
  env = db.env;
  Object.assign(db.env,{AI_GATEWAY:'fixture',ANTHROPIC_API_KEY:'fixture',CLAUDE_MODEL:MODEL,AI:{run:async()=>({data:[]})},calls:[]},overrides);
  return {...db,jobs,ctx:{waitUntil:p=>jobs.push(p),passThroughOnException:()=>{}}};
}
async function req(f, value, {uid=77,path='/api/ask',signal} = {}) {
  const auth = await signInitData({auth_date:String(Math.floor(Date.now()/1000)),user:{id:uid,first_name:'Fixture'}}, f.env.BOT_TOKEN);
  return api.worker.fetch(new Request(`https://cyberjudah.io${path}`,{method:value===undefined?'GET':'POST',headers:{authorization:`tma ${auth}`,'content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)}),...(signal?{signal}:{})}),f.env,f.ctx);
}
const events = async r => (await r.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
const recover = (f,request='recovery-fixture-1',uid=77) => req(f,undefined,{path:`/api/ask/requests/${request}`,uid});
async function fund(f, uid=77, amount=500_000) {
  const owner = await api.ownerOfUser(f.env,uid);
  await api.grantPayment(f.env,owner,{charge:`fixture-${uid}`,kind:'pack',stars:77,mc:amount});
  return owner;
}
function pause(f,mode='after-text') {
  f.env.mode=mode;
  f.env.gate=new Promise(resolve=>{f.env.release=resolve;});
  return new Promise(resolve=>{f.env.entered=resolve;});
}

test('paid answer is recoverable and same-ID replays preserve sources, IDs and one charge',async t=>{
  const f=setup(t), owner=await fund(f);
  const first=await events(await req(f,body({chat:'fixturechat'})));
  const done=first.find(e=>e.done), usage=first.find(e=>e.usage).usage;
  assert.equal(done.request,'recovery-fixture-1'); assert.ok(done.answer_id); assert.equal(done.model,MODEL);
  assert.equal(first[0].answer_id,done.answer_id,'acknowledgement and feedback retain the recovery ID');
  const receipt=f.sql.prepare('SELECT * FROM ask_answer_receipts WHERE id = ?').get(done.answer_id);
  assert.deepEqual(JSON.parse(receipt.source_ns),[1]);
  assert.equal((await req(f,{answer_id:done.answer_id,rating:'up',source_n:1},{path:'/api/feedback'})).status,200);
  assert.equal((await req(f,{answer_id:done.answer_id,rating:'up'},{path:'/api/feedback',uid:88})).status,404);
  assert.equal(done.sources[0].excerpt,'Original fixture words.');
  const saved=await (await recover(f)).json();
  assert.equal(saved.state,'completed'); assert.equal(saved.settlement,'settled');
  assert.deepEqual(saved.done,done); assert.deepEqual(saved.usage,usage);
  const again=await events(await req(f,body({chat:'fixturechat',consent:[],caps:{}})));
  assert.equal(again[0].replay,true); assert.deepEqual(again.find(e=>e.done),done);
  assert.equal(f.env.calls.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_answer_receipts').get().n,1,'replay does not mint a new receipt');
  assert.deepEqual(f.sql.prepare('SELECT * FROM ask_answer_receipts WHERE id = ?').get(done.answer_id),receipt,'replay does not renew expiry');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n,1);
  assert.equal((await api.wallet(f.env,owner)).total_mc,500_000-usage.charged_mc);
  const chat=await api.getChat(f.env,77,'fixturechat');
  assert.equal(chat.turns.length,2); assert.equal(chat.turns[1].answer_id,done.answer_id);
  assert.equal(chat.turns[1].request,done.request);
  await api.saveExchange(f.env,77,'fixturechat','Existing fixture question?',{content:done.answer,request:done.request});
  assert.equal((await api.getChat(f.env,77,'fixturechat')).turns.length,2);
  const conflict=await req(f,body({chat:'fixturechat',q:'A different fixture question?'}));
  assert.equal(conflict.status,409); assert.equal((await conflict.json()).error,'request-conflict');
});

test('concurrent same-ID requests admit one generation and one hold; IDs are isolated per owner',async t=>{
  const f=setup(t); await fund(f); await fund(f,88);
  const entered=pause(f);
  const [a,b]=await Promise.all([req(f,body()),req(f,body())]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const rejected=a.status===409?a:b;
  const pending=await rejected.json();
  assert.equal(pending.error,'request-running'); assert.equal(pending.recover,'/api/ask/requests/recovery-fixture-1');
  await entered;
  assert.equal((await (await recover(f)).json()).state,'running');
  assert.equal((await recover(f,undefined,88)).status,404);
  f.env.release();
  await events(a.status===200?a:b); await Promise.all(f.jobs);
  const other=await req(f,body(),{uid:88});
  assert.equal(other.status,200); await events(other);
  assert.equal(f.env.calls.length,2);
  const holds=f.sql.prepare('SELECT request_id FROM credit_holds').all();
  assert.equal(holds.length,2); assert.notEqual(holds[0].request_id,holds[1].request_id);
});

for(const mode of ['before-text','after-text']) test(`disconnect ${mode} saves an interrupted result and keeps #548 settlement`,async t=>{
  const f=setup(t); await fund(f);
  const entered=pause(f,mode), abort=new AbortController();
  const response=await req(f,body(),{signal:abort.signal});
  await entered; abort.abort(); f.env.release();
  const lines=await events(response); await Promise.all(f.jobs);
  assert.equal(lines.some(e=>e.done),false);
  const saved=await (await recover(f)).json();
  assert.equal(saved.state,'interrupted'); assert.equal(saved.done,undefined);
  assert.equal(saved.partial,mode==='after-text'?'Original fixture words [1].':undefined);
  const usage=f.sql.prepare('SELECT status,charged_mc FROM credit_usage').get();
  assert.equal(usage.status,mode==='after-text'?'partial':'failed');
  assert.equal(usage.charged_mc>0,mode==='after-text');
  assert.equal(saved.usage.charged_mc,usage.charged_mc);
  const retry=await req(f,body()); assert.equal(retry.status,409);
  assert.equal((await retry.json()).state,'interrupted'); assert.equal(f.env.calls.length,1);
});

test('cancelling the response reader aborts live work without waiting for start to finish',async t=>{
  const f=setup(t); await fund(f);
  const entered=pause(f);
  const response=await req(f,body()); const reader=response.body.getReader();
  await entered; await reader.read();
  await reader.cancel(); f.env.release(); await Promise.all(f.jobs);
  assert.equal((await (await recover(f)).json()).state,'interrupted');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n,1);
});

for(const overrides of [
  {ASK_FREE_MODELS:'@cf/zai-org/glm-4.7-flash'},
  {ADMIN_IDS:'77'},
  {ASK_BILLING:'off'},
]) test(`request admission also deduplicates ${JSON.stringify(overrides)}`,async t=>{
  const f=setup(t,overrides);
  const free=!!overrides.ASK_FREE_MODELS;
  const value=body(free?{model:overrides.ASK_FREE_MODELS,consent:['Cloudflare (Workers AI)']}:{});
  assert.equal((await req(f,value)).status,200);
  await Promise.all(f.jobs);
  const replay=await req(f,value); assert.equal(replay.status,200); await events(replay);
  assert.equal(f.env.calls.length,1);
  if(free||overrides.ADMIN_IDS) assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM free_spend_holds').get().n,1);
});

test('consent, cost and credit denials leave no admission; same ID can be authorized afterwards',async t=>{
  const f=setup(t);
  assert.equal((await req(f,body({consent:[]}))).status,428);
  assert.equal((await req(f,body({caps:{}}))).status,409);
  assert.equal((await req(f,body())).status,402);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_requests').get().n,0);
  assert.equal(f.env.calls.length,0);
  await fund(f); assert.equal((await req(f,body())).status,200); await Promise.all(f.jobs);
  assert.equal((await req(f,body({request:'bad'}))).status,400);
});

test('legacy paid IDs cannot bypass their old hold during the recovery rollout',async t=>{
  const f=setup(t), owner=await fund(f);
  await api.hold(f.env,owner,'recovery-fixture-1',100_000,1,MODEL);
  const response=await req(f,body()); assert.equal(response.status,409);
  assert.equal((await response.json()).error,'request-used'); assert.equal(f.env.calls.length,0);
});

test('failure to persist the full answer refunds rather than charging for an unrecoverable result',async t=>{
  const f=setup(t), owner=await fund(f);
  f.fail(/UPDATE ask_requests SET state = \?, payload = \?/,2);
  const lines=await events(await req(f,body()));
  assert.equal(lines.some(e=>e.done),false);
  assert.equal(f.sql.prepare('SELECT charged_mc FROM credit_usage').get().charged_mc,0);
  assert.equal((await api.wallet(f.env,owner)).total_mc,500_000);
  const saved=await (await recover(f)).json(); assert.equal(saved.state,'failed');
  assert.equal((await req(f,body())).status,409); assert.equal(f.env.calls.length,1);
});

test('a lost post-settlement write recovers the durable answer and authoritative charge without resettling',async t=>{
  const f=setup(t); await fund(f);
  const prepare=f.env.DB.prepare; let writes=0;
  f.env.DB.prepare=q=>{
    const statement=prepare(q);
    if(!q.startsWith('UPDATE ask_requests SET state = ?, payload = ?')) return statement;
    return {...statement,bind(...args){const bound=statement.bind(...args); return {...bound,async run(){if(++writes===2)throw new Error('fixture lost result write');return bound.run();}};}};
  };
  const lines=await events(await req(f,body())); assert.equal(lines.some(e=>e.done),false);
  const saved=await (await recover(f)).json(); assert.equal(saved.state,'completed');
  assert.equal(saved.done.answer,'Original fixture words [1].'); assert.equal(saved.settlement,'settled');
  assert.equal(saved.usage.charged_mc,f.sql.prepare('SELECT charged_mc FROM credit_usage').get().charged_mc);
  await events(await req(f,body())); assert.equal(f.env.calls.length,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE type = 'release'").get().n,1);
});

test('a lost acknowledgement of the durable answer cannot overwrite it with a failure',async t=>{
  const f=setup(t); await fund(f);
  const prepare=f.env.DB.prepare; let lost=false;
  f.env.DB.prepare=q=>{
    const statement=prepare(q);
    if(!q.startsWith('UPDATE ask_requests SET state = ?, payload = ?')) return statement;
    return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,async run(){
      const result=await bound.run();
      if(!lost && args[0]==='completed'){lost=true;throw new Error('fixture lost write acknowledgement');}
      return result;
    }};}};
  };
  const lines=await events(await req(f,body())); assert.equal(lines.some(e=>e.done),false);
  const saved=await (await recover(f)).json();
  assert.equal(saved.state,'completed'); assert.equal(saved.done.answer,'Original fixture words [1].');
  assert.equal(saved.usage.charged_mc,0); assert.equal(saved.settlement,'settled');
  await events(await req(f,body())); assert.equal(f.env.calls.length,1);
});

test('KV chat-save failures do not lose the authoritative request result',async t=>{
  const f=setup(t); await fund(f);
  f.env.SUBS.put=async()=>{throw new Error('fixture KV unavailable');};
  const done=(await events(await req(f,body({chat:'fixturechat'})))).find(e=>e.done);
  assert.ok(done); assert.deepEqual((await (await recover(f)).json()).done,done);
});

test('deleting recovery data while inference runs prevents resurrection and refunds the answer',async t=>{
  const f=setup(t); await fund(f);
  const entered=pause(f), response=await req(f,body()); await entered;
  await api.deleteAskRequests(f.env,77); f.env.release();
  assert.equal((await events(response)).some(e=>e.done),false); await Promise.all(f.jobs);
  assert.equal((await recover(f)).status,404);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_requests').get().n,0);
  assert.equal(f.sql.prepare('SELECT charged_mc FROM credit_usage').get().charged_mc,0);
});

test('encrypted records support owner-only export, linked-chat deletion and retention cleanup',async t=>{
  const f=setup(t); await fund(f);
  await events(await req(f,body({chat:'fixturechat'})));
  const row=f.sql.prepare('SELECT * FROM ask_requests').get();
  assert.ok(row.payload.startsWith('s1.')); assert.ok(!row.payload.includes('Original fixture words'));
  assert.notEqual(row.owner,'77');
  assert.equal((await api.exportAskRequests(f.env,88)).length,0);
  assert.equal((await api.exportAskRequests(f.env,77))[0].request,'recovery-fixture-1');
  const unauthorized=await api.worker.fetch(new Request('https://cyberjudah.io/api/ask/requests/recovery-fixture-1'),f.env,f.ctx);
  assert.equal(unauthorized.status,401);
  assert.equal(unauthorized.headers.get('cache-control'),'no-store');
  assert.equal((await recover(f,'bad')).status,400);
  f.fail(/SELECT \* FROM ask_requests/);
  const unavailable=await recover(f); assert.equal(unavailable.status,503); assert.equal(unavailable.headers.get('cache-control'),'no-store');
  await api.deleteAskRequests(f.env,77,'differentchat'); assert.equal((await recover(f)).status,200);
  await api.deleteAskRequests(f.env,77,'fixturechat'); assert.equal((await recover(f)).status,404);
  await events(await req(f,body({request:'retention-fixture'})));
  await api.sweepAskRequests(f.env,Date.now()+181*86400_000);
  assert.equal((await recover(f,'retention-fixture')).status,404);
});

test('an abandoned running request is interrupted, never restarted, and keeps settlement pending',async t=>{
  const f=setup(t), identity=await api.requestIdentity(f.env,77,'abandoned-fixture',[]);
  const claimed=await api.claimAskRequest(f.env,identity,MODEL,undefined,Date.now()-180_000);
  const saved=await api.publicAskRequest(f.env,claimed.row);
  assert.equal(saved.state,'interrupted'); assert.equal(saved.settlement,'pending'); assert.equal(saved.done,undefined);
});

test('a streaming checkpoint is recoverable before completion and cannot overwrite the final result',async t=>{
  const f=setup(t); await fund(f);
  t.mock.timers.enable({apis:['setInterval']});
  const entered=pause(f), response=await req(f,body()); await entered;
  t.mock.timers.tick(5000);
  await new Promise(resolve=>setImmediate(resolve));
  const running=await (await recover(f)).json();
  assert.equal(running.state,'running'); assert.equal(running.partial,'Original fixture words [1].');
  f.env.release(); await events(response); await Promise.all(f.jobs);
  t.mock.timers.tick(5000);
  const done=await (await recover(f)).json();
  assert.equal(done.state,'completed'); assert.equal(done.partial,undefined); assert.equal(done.done.answer,'Original fixture words [1].');
});

test('recovery and replay return the current balance after another wallet movement',async t=>{
  const f=setup(t), owner=await fund(f);
  const original=(await events(await req(f,body()))).find(e=>e.usage).usage;
  await api.adjust(f.env,owner,10_000,'fixture-adjustment','fixture');
  const recovered=await (await recover(f)).json();
  assert.equal(recovered.usage.charged_mc,original.charged_mc);
  assert.equal(recovered.usage.balance.total_mc,original.balance.total_mc+10_000);
  const replay=(await events(await req(f,body()))).find(e=>e.usage).usage;
  assert.equal(replay.balance.total_mc,recovered.usage.balance.total_mc);
});

test('request-only JSON clients share the durable admission and replay path',async t=>{
  const f=setup(t); await fund(f);
  const value=body({stream:false,model:undefined});
  const first=await req(f,value); assert.equal(first.status,200);
  const answer=await first.json(); assert.ok(answer.answer_id && answer.request);
  const again=await req(f,value); assert.equal(again.status,200);
  assert.equal((await again.json()).answer_id,answer.answer_id); assert.equal(f.env.calls.length,1);
});

test('optional feedback receipt storage cannot break a durable answer or mint on replay',async t=>{
  const f=setup(t); await fund(f);
  f.fail(/INSERT OR IGNORE INTO ask_answer_receipts/);
  const lines=await events(await req(f,body()));
  const done=lines.find(e=>e.done); assert.ok(done);
  assert.equal(done.answer_id,lines[0].answer_id);
  const saved=await (await recover(f)).json();
  assert.equal(saved.state,'completed'); assert.equal(saved.settlement,'settled');
  assert.equal(saved.done.answer_id,done.answer_id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_answer_receipts').get().n,0);
  assert.equal((await req(f,{answer_id:done.answer_id,rating:'up'},{path:'/api/feedback'})).status,404);
  const replay=await events(await req(f,body()));
  assert.equal(replay.find(e=>e.done).answer_id,done.answer_id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_answer_receipts').get().n,0);
  assert.equal(f.env.calls.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n,1);
});

test('approved answers retain one recoverable feedback ID with no inference or charge',async t=>{
  const f=setup(t);
  const value=body({q:'Approved fixture question?',consent:[],caps:{}});
  const done=(await events(await req(f,value))).find(e=>e.done);
  assert.equal(done.approved,true);
  const saved=await (await recover(f)).json();
  assert.equal(saved.done.answer_id,done.answer_id); assert.equal(saved.state,'completed');
  assert.deepEqual(saved.usage,{charged_mc:0,free:true});
  assert.equal((await req(f,{answer_id:done.answer_id,rating:'up',source_n:1},{path:'/api/feedback'})).status,200);
  const replay=await events(await req(f,value));
  assert.equal(replay[0].replay,true); assert.equal(replay[0].answer_id,done.answer_id);
  assert.equal(replay.find(e=>e.done).answer_id,done.answer_id);
  assert.equal(f.env.calls.length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_answer_receipts').get().n,1);
});

test('recovery receipts cannot be created for running, other-owner or removed requests',async t=>{
  const f=setup(t); await fund(f);
  const identity=await api.requestIdentity(f.env,77,'receipt-pending',[]);
  const {row}=await api.claimAskRequest(f.env,identity,MODEL);
  assert.equal(await api.issueAnswerReceipt(f.env,77,[],Date.now(),row.answer_id),undefined);
  const done=(await events(await req(f,body()))).find(e=>e.done);
  await api.deleteFeedback(f.env,77);
  assert.equal(await api.issueAnswerReceipt(f.env,88,done.sources,Date.now(),done.answer_id),undefined);
  await api.deleteAskRequests(f.env,77);
  assert.equal(await api.issueAnswerReceipt(f.env,77,done.sources,Date.now(),done.answer_id),undefined);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_answer_receipts').get().n,0);
});

test('Delete my data closes recovery before feedback so a late receipt cannot restore deleted data',async t=>{
  const f=setup(t); await fund(f);
  const done=(await events(await req(f,body()))).find(e=>e.done);
  const other=await api.issueAnswerReceipt(f.env,88,[]);
  f.env.SUBS.list=async()=>({keys:[],list_complete:true});
  const batch=f.env.DB.batch; let injected=false;
  f.env.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!injected){
      injected=true;
      // The first batch deletes feedback; try to write again before Delete my data continues.
      assert.equal(await api.issueAnswerReceipt(f.env,77,done.sources,Date.now(),done.answer_id),undefined);
    }
    return result;
  };
  await api.deleteData(f.env,77);
  assert.equal(injected,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ask_requests').get().n,0);
  const receipts=f.sql.prepare('SELECT id FROM ask_answer_receipts').all();
  assert.deepEqual(receipts.map(r=>r.id),[other]);
});
