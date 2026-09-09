// Opt-in external-source smoke: OVERHEAD_LIVE=1 npx playwright test tests/overhead-lifecycle-live.spec.js
const {test,expect}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
test.use({channel:'chrome'});test.setTimeout(120000);
test('live ISS lifecycle with fixed-time minute-by-minute simulation',async({page})=>{
 test.skip(process.env.OVERHEAD_LIVE!=='1','Explicit live-source opt-in required');
 const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://local').pathname.slice(1);if(!/^(overhead[\w-]*\.(html|js)|analytics-lite.js|vendor\/overhead\/[\w.\-]+\.js)$/.test(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');res.end(fs.readFileSync(path.resolve(file)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/overhead.html');await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:90000});
  const found=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;for(let i=0;i<7;i++){const p=s.results[i]?.find(p=>p.norad==='25544'&&p.likely&&p.start>Date.now());if(p)return {pass:p,night:i,sources:s.sources};}return null;});
  expect(found,'A real upcoming ISS pass is needed for live validation').not.toBeNull();
  const p=found.pass,begin=Math.floor((p.start-20*60000)/60000)*60000,finish=Math.ceil((Math.max(p.end,p.set)+10*60000)/60000)*60000;
  console.log('LIVE ISS',JSON.stringify({fetchedAt:new Date().toISOString(),night:found.night,score:p.score,fields:Object.fromEntries(['rise','start','end','set','epoch'].map(k=>[k,new Date(p[k]).toISOString()])),peak:new Date(p.peak.t).toISOString(),orbitalPeak:new Date(p.orbitalPeak.t).toISOString(),source:found.sources['orbits:stations']}));
  await page.clock.setFixedTime(new Date(begin));await page.evaluate(({p,night})=>{const s=__OVERHEAD_TEST__.state;s.view='tonight';s.day=night;s.limit=1000;s.selected=p;__OVERHEAD_TEST__.render();window.__liveResults=s.results;__OVERHEAD_TEST__.showEvent(p.id,p);}, {p,night:found.night});
  const detail=await page.locator('#detail-content').innerHTML();
  for(let now=begin;now<=finish;now+=60000){
   await page.clock.setFixedTime(new Date(now));await page.evaluate(()=>__OVERHEAD_TEST__.render());
   const l=await page.evaluate(({p,now})=>OverheadLifecycle.eventLifecycle(p,now),{p,now});
   expect(l.timingInvariantValid).toBe(true);expect(await page.locator('[data-event="'+p.id+'"]').count()).toBe(l.displayEligible?1:0);
   expect(await page.evaluate(id=>__OVERHEAD_TEST__.state.weekly.entries.some(e=>e.pass.id===id),p.id)).toBe(l.recommendationEligible);
   if(l.lifecycle==='in-progress')await expect(page.locator('[data-event="'+p.id+'"]')).toContainText('IN PROGRESS');
   if(l.lifecycle==='recently-ended')await expect(page.locator('[data-event="'+p.id+'"]')).toContainText('JUST ENDED');
   await expect(page.locator('#event-dialog')).toBeVisible();expect(await page.locator('#detail-content').innerHTML()).toBe(detail);
   expect(await page.evaluate(()=>__liveResults===__OVERHEAD_TEST__.state.results)).toBe(true);
  }
  expect(errors).toEqual([]);console.log('LIVE PASS: '+((finish-begin)/60000+1)+' minute renders; sources loaded live, simulation only (not a field observation).');
 }finally{await new Promise(r=>server.close(r));}
});
