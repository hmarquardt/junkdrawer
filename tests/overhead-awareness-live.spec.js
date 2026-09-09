/* Opt-in live capture; no source mocking except analytics. Does not tune scores. */
const {test,expect}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
test.use({channel:'chrome'});test.setTimeout(120000);
test('capture field-incident ISS presentation and raw weather association',async({page},info)=>{
 test.skip(process.env.OVERHEAD_LIVE!=='1','Explicit live-source opt-in required');
 const server=http.createServer((req,res)=>{const file=new URL(req.url,'http://local').pathname.slice(1);if(!/^(overhead[\w-]*\.(html|js)|analytics-lite.js|vendor\/overhead\/[\w.\-]+\.js)$/.test(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');res.end(fs.readFileSync(path.resolve(file)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 try{
  await page.clock.setFixedTime(new Date('2026-09-09T01:18:00Z'));
  await page.goto('http://127.0.0.1:'+server.address().port+'/overhead.html');await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:90000});
  const readiness=await page.evaluate(()=>({ready:!!__OVERHEAD_TEST__.state.results[0],errors:__OVERHEAD_TEST__.state.errors}));expect(readiness.ready,'Live sources/calculation unavailable: '+JSON.stringify(readiness.errors)).toBe(true);
  const traces=[];
  for(const minute of [18,20,21]){
   await page.clock.setFixedTime(new Date('2026-09-09T01:'+minute+':00Z'));await page.evaluate(()=>__OVERHEAD_TEST__.render());
   const trace=await page.evaluate(()=>{
    const api=__OVERHEAD_TEST__,s=api.state,E=api.engine,now=Date.now(),p=s.results[0].find(p=>p.norad==='25544'&&p.start<now&&p.end>now);
    if(!p)throw Error('Reported in-progress ISS pass missing from raw results');
    const sort=(a,b)=>b.score-a.score||b.brightness-a.brightness||a.start-b.start,raw=api.passes(0),before=raw.filter(p=>s.settings.show==='all'||p.likely).sort(sort),scored=before.filter(p=>s.settings.show==='all'||p.score>=+s.settings.score),shown=scored.filter(p=>s.settings.show!=='great'||p.score>=75),actual=api.displayPasses();
    if(JSON.stringify(shown.map(p=>p.id))!==JSON.stringify(actual.map(p=>p.id)))throw Error('Trace does not match actual displayPasses');
    const rank=a=>{const i=a.findIndex(x=>x.id===p.id);return i<0?null:i+1;},h=s.weather.hourly,index=Math.floor((p.peak.t/1000-h.time[0])/3600),fmt=t=>new Intl.DateTimeFormat('en-US',{timeZone:s.site.tz,dateStyle:'short',timeStyle:'long'}).format(t);
    const row=i=>({index:i,rawTime:h.time[i],utc:new Date(h.time[i]*1000).toISOString(),local:fmt(h.time[i]*1000),...Object.fromEntries(Object.keys(h).filter(k=>k!=='time').map(k=>[k,h[k][i]]))});
    const score=E.scorePass(p,s.weather),l=api.lifecycle(p,now);
    return {capturedAtUTC:new Date().toISOString(),now:new Date(now).toISOString(),site:s.site,presentInResults:true,groups:p.groups,likely:p.likely,lifecycle:l.lifecycle,recommendationEligible:l.recommendationEligible,displayEligible:l.displayEligible,score:p.score,recomputedScore:score.score,provisional:p.provisional,brightness:p.brightness,weatherHour:row(index),weatherNeighbors:[row(index-1),row(index+1)],weatherTimeUnits:s.weather.hourly_units.time,weatherTimezone:s.weather.timezone,weatherUTCOffset:s.weather.utc_offset_seconds,weatherGrid:{latitude:s.weather.latitude,longitude:s.weather.longitude},weatherSourceKey:'weather:'+s.site.lat.toFixed(3)+','+s.site.lon.toFixed(3),weatherSource:s.sources['weather:'+s.site.lat.toFixed(3)+','+s.site.lon.toFixed(3)],weatherAt:E.weatherAt(s.weather,p.peak.t),factors:score.factors,settingsShow:s.settings.show,settingsScore:s.settings.score,ISSCategoryEnabled:s.groups.has('iss'),favoriteOnly:s.favoriteOnly,objectInCandidates:api.candidates().some(o=>String(o.NORAD_CAT_ID)==='25544'),rankBeforeFilters:rank(before),rankAfterScoreFilter:rank(scored),rankAfterShowFilter:rank(shown),rankAfterLimit:rank(actual.slice(0,s.limit)),rowLimit:s.limit,renderedInDOM:!!document.querySelector('[data-event="'+p.id+'"]'),happeningNowInDOM:!!document.querySelector('[data-happening="'+p.id+'"]'),best:api.best()?{id:api.best().id,name:api.best().name,score:api.best().score,start:fmt(api.best().start)}:null,firstRows:actual.slice(0,s.limit).map(p=>({id:p.id,name:p.name,score:p.score,start:fmt(p.start)})),pass:p,weather:s.weather,night:s.nights[0],nightPasses:s.results[0]};
   });traces.push(trace);
  }
  const file=info.outputPath('incident-capture.json');fs.writeFileSync(file,JSON.stringify(traces,null,2));await info.attach('captured-fields',{path:file,contentType:'application/json'});
  for(const t of traces){const {pass,weather,night,nightPasses,...brief}=t;console.log(JSON.stringify(brief));expect(t.score).toBe(t.recomputedScore);expect(t.lifecycle).toBe('in-progress');expect(t.happeningNowInDOM).toBe(true);}
  await page.locator('[data-happening="'+traces[2].pass.id+'"]').click();await expect(page.locator('#event-dialog')).toBeVisible();await expect(page.locator('#detail-content .sky')).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await new Promise(r=>server.close(r));}
});
