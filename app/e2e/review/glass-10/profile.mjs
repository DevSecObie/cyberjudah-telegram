import { chromium } from 'playwright';
import fs from 'node:fs';
if (!process.env.PROFILE_DIR || !process.env.PROFILE_ORIGIN || !process.env.PROFILE_COMMIT) throw new Error('Set PROFILE_DIR, PROFILE_ORIGIN and PROFILE_COMMIT for the served production build.');
const out=process.env.PROFILE_DIR;fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'});
async function setup(){
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.addInitScript(()=>window.__cloud={bs:JSON.stringify({preferredColorScheme:'light',preferredLightTheme:'default'})});
await page.route('https://telegram.org/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(new URL('../../telegram-mock.js', import.meta.url),'utf8')}));
await page.route(/ytimg|youtube\.com|fonts\.g/,r=>r.abort());
await page.route(/^(https:\/\/data\.cyberjudah\.io|http:\/\/127\.0\.0\.1:8788)\//,r=>{
 const p=new URL(r.request().url()).pathname;
 if(p==='/api/kjv/books.json')return r.fulfill({json:[{book:'Genesis',slug:'genesis',chapters:50,verses:1533,testament:'Old Testament',url:'/bible/genesis',chapterIds:[1]}]});
 if(p==='/api/kjv/genesis/1.json')return r.fulfill({json:JSON.parse(fs.readFileSync(new URL('../../../../bot/tests/fixtures/bs/api/kjv/genesis/1.json', import.meta.url),'utf8'))});
 return r.fulfill({status:404,body:''});
});
const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
return {page,cdp};
}
const result={browser:await browser.version(),build:'production',cpuThrottle:4,measuredCommit:process.env.PROFILE_COMMIT,viewport:{width:390,height:844},measurements:[]};
for(const action of ['dock-drag','sheet-open','menu-morph','reader-scroll']){
 const {page,cdp}=await setup();
 await page.goto(`${process.env.PROFILE_ORIGIN}/read/genesis/1#tgWebAppData=query_id%3Dprofile&tgWebAppVersion=9.1&tgWebAppPlatform=ios`);await page.locator('#verset-1').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(600);
 const dock=page.getByRole('navigation',{name:'Sections'}),from=await dock.locator('.tab[data-on]').boundingBox(),to=await dock.getByRole('button',{name:'Classes',exact:true}).boundingBox();
 await cdp.send('Tracing.start',{categories:'toplevel,devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
 await page.evaluate(()=>{window.__frames=[];window.__record=true;let previous;performance.mark('profile-start');function tick(t){if(previous!==undefined)window.__frames.push(t-previous);previous=t;performance.mark('profile-frame');if(window.__record)requestAnimationFrame(tick);}requestAnimationFrame(tick);});
 if(action==='dock-drag'){
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  for(let i=1;i<=45;i++){await page.mouse.move(from.x+from.width/2+(to.x-from.x)*i/45,from.y+from.height/2);await page.evaluate(()=>new Promise(requestAnimationFrame));}
  await page.mouse.up();
 }else if(action==='sheet-open'){await page.locator('#verset-1').click();await page.locator('.bs-selected').waitFor();}
 else if(action==='menu-morph'){await page.getByRole('button',{name:'Scripture options',exact:true}).click();await page.locator('.bs-dropdown').waitFor();}
 else{await page.locator('.bs-scroll').hover({position:{x:220,y:300}});await page.mouse.wheel(0,580);await page.waitForFunction(()=>document.querySelector('.bs-scroll').scrollTop>=579);await page.waitForTimeout(180);await page.mouse.wheel(0,-380);}
 await page.waitForTimeout(500);
 const frames=await page.evaluate(()=>{window.__record=false;performance.mark('profile-end');return window.__frames;});
 const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await completed;let raw='';
 while(true){const chunk=await cdp.send('IO.read',{handle:stream});raw+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});fs.writeFileSync(`${out}/${action}-trace.json`,raw);
 const events=JSON.parse(raw).traceEvents,marks=events.filter(e=>e.name==='profile-frame').sort((a,b)=>a.ts-b.ts),pid=marks[0]?.pid,tid=marks[0]?.tid;
 const tasks=events.filter(e=>e.pid===pid&&e.tid===tid&&e.ph==='X'&&/RunTask/.test(e.name));
 const work=marks.slice(1).map((mark,i)=>{const left=marks[i].ts,right=mark.ts;const spans=tasks.map(e=>[Math.max(left,e.ts),Math.min(right,e.ts+e.dur)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let total=0,end=-Infinity;for(const [a,b]of spans){total+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}return total/1000;});
 const stats=values=>{const a=[...values].sort((a,b)=>a-b),round=v=>Math.round((v??0)*100)/100;return {samples:a.length,medianMs:round(a[Math.floor(a.length*.5)]),p95Ms:round(a[Math.floor(a.length*.95)]),maxMs:round(a.at(-1))};};
 const metric={action,frames:stats(frames),framesOver33ms:frames.filter(v=>v>33.4).length,mainThreadWork:stats(work),workIntervalsOver16ms:work.filter(v=>v>16).length,taskEvents:tasks.length,layoutMs:Math.round(events.filter(e=>e.name==='Layout').reduce((s,e)=>s+(e.dur??0),0)/10)/100,styleMs:Math.round(events.filter(e=>e.name==='UpdateLayoutTree').reduce((s,e)=>s+(e.dur??0),0)/10)/100};
 if(!tasks.length)throw new Error('Missing main-thread task events');
 result.measurements.push(metric);console.log(JSON.stringify(metric));
 await page.context().close();
}
await browser.close();fs.writeFileSync(`${out}/profile.json`,JSON.stringify(result,null,2)+'\n');
