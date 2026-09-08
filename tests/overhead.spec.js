const {test,expect}=require('@playwright/test');
const path=require('path');
const fs=require('fs');
const http=require('http');
const {execFileSync}=require('child_process');
test.use({channel:'chrome'});
test.setTimeout(90000);
const iss={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const start=Date.parse('2026-09-06T00:00Z')/1000;
const hourly={time:Array.from({length:264},(_,i)=>start+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:12,cloud_cover_low:5,cloud_cover_mid:0,cloud_cover_high:7,visibility:30000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:20}))hourly[key]=Array(264).fill(value);
async function boot(page,{offline=false,url}={}){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});await page.clock.setFixedTime(new Date('2026-09-07T18:00Z'));await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));await page.route('**celestrak.org/**',r=>r.fulfill({json:offline?{error:'Unavailable'}:[iss]}));await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:offline?{error:'Unavailable'}:{timezone:'America/Chicago',hourly}}));await page.goto(url||`file://${path.resolve('overhead.html')}`);await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);return errors;}
test('all widths, seven nights, sky chart, favorite, settings and saved sites',async({page})=>{const errors=await boot(page);for(const width of [390,768,1024,1440,1920]){await page.setViewportSize({width,height:950});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#headline')).not.toBeEmpty();}
 await page.getByRole('tab',{name:'NEXT 7 DAYS'}).click();await expect(page.locator('#week button')).toHaveCount(7);await page.locator('[data-day="1"]').click();await page.locator('.event').first().click();await expect(page.locator('#detail-title')).toContainText('ISS');await expect(page.locator('#detail-content svg')).toBeVisible();await page.getByRole('button',{name:'Favorite spacecraft'}).click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.favorites')))).toEqual(['25544']);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[name="minimum"]').selectOption('30');await page.locator('[name="clock"]').selectOption('24');await page.getByRole('button',{name:'Apply settings'}).click();await page.waitForFunction(()=>!__OVERHEAD_TEST__.state.busy);expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.settings.minimum)).toBe('30');
 await page.locator('#location-open').click();await page.getByRole('button',{name:'Save current location'}).click();await page.getByRole('button',{name:'Save current location'}).click();await expect(page.locator('.saved-row')).toHaveCount(1);await page.getByRole('button',{name:'Delete saved Princeton, Indiana'}).click();await expect(page.locator('.saved-row')).toHaveCount(0);await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'NOW',exact:true}).click();await expect(page.locator('#night-label')).toContainText('NEXT TWO HOURS');expect(errors).toEqual([]);
});
test('API failures never create events; import restores real orbital calculation',async({page})=>{const errors=await boot(page,{offline:true});await expect(page.locator('.event')).toHaveCount(0);await expect(page.locator('#headline')).toContainText('data isn’t');await expect(page.locator('#night-score')).toHaveText('—');await page.locator('#diagnostics summary').click();await page.locator('#import').setInputFiles({name:'iss.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([iss]))});await page.waitForFunction(()=>!__OVERHEAD_TEST__.state.busy);await expect(page.locator('.event').first()).toBeVisible();expect(await page.evaluate(()=>Object.values(__OVERHEAD_TEST__.state.results).flat().every(p=>p.provisional))).toBe(true);expect(errors).toEqual([]);});
test('stale cache survives network failure, then clearing cache removes downloaded data',async({page})=>{await boot(page);await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('overhead-cache',1);r.onsuccess=()=>{const tx=r.result.transaction('responses','readwrite'),s=tx.objectStore('responses'),q=s.getAll();q.onsuccess=()=>q.result.forEach(row=>s.put({...row,at:Date.now()-86400000}));tx.oncomplete=resolve;tx.onerror=reject;};}));await page.route('**celestrak.org/**',r=>r.fulfill({json:{error:'Unavailable'}}));await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{error:'Unavailable'}}));await page.reload();await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);await expect(page.locator('.event').first()).toBeVisible();await expect(page.locator('#freshness')).toContainText(/stale cache/i);await page.locator('#diagnostics summary').click();await page.getByRole('button',{name:'Clear downloaded cache'}).click();await expect(page.locator('#status')).toContainText('cache cleared');await page.reload();await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);await expect(page.locator('.event')).toHaveCount(0);});
test('theme-only rendering, deployed dark parity, contrast and persistence',async({page,browser})=>{
 const baseline=execFileSync('git',['show','8725153:overhead.html'],{encoding:'utf8'});
 const server=http.createServer((req,res)=>{const raw=new URL(req.url,'http://local').pathname;const file=raw.replace(/^\/baseline/,'').slice(1);if(file==='overhead.html'&&raw.startsWith('/baseline/')){res.setHeader('Content-Type','text/html');res.end(baseline);return;}if(!['overhead.html','overhead-engine.js','overhead-weekly.js','overhead-trains.js','overhead-objects.js','overhead-worker.js','analytics-lite.js','vendor/overhead/satellite-6.0.1.min.js','vendor/overhead/suncalc-1.9.0.js'].includes(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');res.end(fs.readFileSync(path.resolve(file)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const old=await browser.newPage();
 try{
 await page.addInitScript(()=>requestAnimationFrame(()=>{window.__firstTheme=document.documentElement.dataset.theme||'dark';}));
 await page.emulateMedia({colorScheme:'light'});const errors=await boot(page,{url:origin+'/overhead.html'});const oldErrors=await boot(old,{url:origin+'/baseline/overhead.html'});
 // Isolate the pre-existing dark dashboard for pixel parity; the new card has its own QA below.
 await page.addStyleTag({content:'#weekly-card,#weekly-tonight,#weekly-ranking-diagnostics,#train-diagnostics,#about,[data-group="trains"]{display:none!important}'});
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
 const boxes=()=>page.evaluate(()=>Object.fromEntries(['header','.toolbar','.briefing','.layout','#events','.chart-panel','.timeline-panel'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height]];})));
 const application=()=>page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;return JSON.stringify({site:s.site,settings:s.settings,selected:s.selected,results:s.results,view:s.view,day:s.day,favorites:s.favorites});});
 for(const width of [390,768,1024,1440,1920]){
   await page.setViewportSize({width,height:1000});await old.setViewportSize({width,height:1000});await page.waitForTimeout(250);
   const before=await boxes();const data=await application();
   const dark=await page.screenshot({fullPage:true,mask:[page.locator('footer'),page.locator('#freshness')],path:'/private/tmp/overhead-theme-dark-'+width+'.png'});
   const original=await old.screenshot({fullPage:true,mask:[old.locator('footer'),old.locator('#freshness')],path:'/private/tmp/overhead-theme-original-'+width+'.png'});
   // Compare below the toolbar: the ABOUT tab is an intentional new-release addition to the frozen baseline.
   const pixelDifference=await page.evaluate(async images=>{const read=async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {pixels:ctx.getImageData(0,0,c.width,c.height).data,w:c.width,h:c.height};};const [a,b]=await Promise.all(images.map(read));let count=0,minX=a.w,minY=a.h,maxX=0,maxY=0;const endY=Math.min(a.h,b.h)-250;for(let i=150*a.w*4;i<endY*a.w*4;i+=4)if(a.pixels[i]!==b.pixels[i]||a.pixels[i+1]!==b.pixels[i+1]||a.pixels[i+2]!==b.pixels[i+2]||a.pixels[i+3]!==b.pixels[i+3]){const x=(i/4)%a.w,y=Math.floor(i/4/a.w);count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}return {count,bounds:[minX,minY,maxX,maxY],dimensions:[a.w,a.h,b.w,b.h]};},[dark,original].map(b=>'data:image/png;base64,'+b.toString('base64')));
   console.log('Dark comparison',width,pixelDifference);
   // The ABOUT tab and Starlink-trains chip are intentional visible additions to the frozen
   // baseline; parity is asserted below the toolbar with a small anti-aliasing tolerance.
   expect(pixelDifference.count/(pixelDifference.dimensions[0]*pixelDifference.dimensions[1]),'Original dark rendering at '+width+'px').toBeLessThan(.001);
   await page.locator('#settings-open').click();await page.getByRole('button',{name:'Use light theme'}).click();
   await expect(page.getByRole('button',{name:'Use light theme'})).toHaveAttribute('aria-pressed','true');
   await page.keyboard.press('Escape');await page.mouse.click(1,1);
   expect(await boxes()).toEqual(before);expect(await application()).toBe(data);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
   await page.screenshot({fullPage:true,path:'/private/tmp/overhead-theme-light-'+width+'.png'});
   await page.locator('#settings-open').click();await page.getByRole('button',{name:'Use dark theme'}).click();await page.keyboard.press('Escape');await page.mouse.click(1,1);
   expect(await boxes()).toEqual(before);
 }
 await page.locator('#settings-open').click();await page.getByRole('button',{name:'Use light theme'}).focus();await page.keyboard.press('Enter');
 expect(await page.getByRole('button',{name:'Use light theme'}).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 const contrast=await page.evaluate(()=>{
  const css=getComputedStyle(document.documentElement),hex=n=>css.getPropertyValue('--'+n).trim();
  const rgb=h=>h.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255),lum=c=>c.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const result={};for(const fg of ['ink','muted','lime','blue','amber','danger','route','footer'])for(const bg of ['bg','panel','status-bg','hover','event-hover'])result[fg+'/'+bg]=ratio(rgb(hex(fg)),rgb(hex(bg)));
  result['action text']=ratio(rgb(hex('on-action')),rgb(hex('lime')));result['sky grid']=ratio(rgb(hex('sky-grid')),rgb(hex('panel')));result['input border']=ratio(rgb(hex('control-border')),rgb(hex('input-bg')));
  const cloud=rgb(hex('timeline-cloud')),alpha=+hex('cloud-opacity');for(const bg of ['timeline-night','twilight-civil','twilight-nautical','twilight-astro']){const back=rgb(hex(bg));result['cloud/'+bg]=ratio(cloud.map((x,i)=>x*alpha+back[i]*(1-alpha)),back);result['event/'+bg]=ratio(rgb(hex('lime')),back);}
  return result;
 });
 for(const [name,ratio]of Object.entries(contrast))expect(ratio,name).toBeGreaterThanOrEqual(name.startsWith('cloud/')||name.startsWith('event/')||name==='sky grid'||name==='input border'?3:4.5);
 console.log('Light contrast ratios',JSON.stringify(contrast));
 await page.reload();await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
 expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');expect(await page.evaluate(()=>window.__firstTheme)).toBe('light');await page.emulateMedia({colorScheme:'dark'});expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
 await page.locator('.event').first().click();await page.screenshot({path:'/private/tmp/overhead-theme-detail-light.png'});await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'NEXT 7 DAYS'}).click();await page.screenshot({fullPage:true,path:'/private/tmp/overhead-theme-week-light.png'});
 // Existing map instance, camera, data source and selected pass must survive palette changes.
 await page.locator('.event').first().click();await page.locator('#map-open').click();
 await page.waitForFunction(()=>__OVERHEAD_TEST__.getMap()?.getLayer('pass'),null,{timeout:30000});
 await page.evaluate(()=>{const m=__OVERHEAD_TEST__.getMap();m.jumpTo({zoom:3.25,center:[-86,37]});window.__themeMap=m;window.__themeSource=m.getSource('pass');window.__themeResults=__OVERHEAD_TEST__.state.results;});
 const camera=()=>page.evaluate(()=>{const m=__OVERHEAD_TEST__.getMap();return [m.getZoom(),...m.getCenter().toArray(),m.getBearing(),m.getPitch()];});
 const fixedCamera=await camera();const passId=await page.evaluate(()=>__OVERHEAD_TEST__.state.selected.id);
 for(const width of [390,768,1024,1440,1920]){
   await page.setViewportSize({width,height:1000});await page.evaluate(()=>__OVERHEAD_TEST__.getMap().resize());
   for(const theme of ['dark','light']){
     await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);
     expect(await camera()).toEqual(fixedCamera);
     expect(await page.evaluate(()=>__themeMap===__OVERHEAD_TEST__.getMap()&&__themeSource===__themeMap.getSource('pass')&&__themeResults===__OVERHEAD_TEST__.state.results)).toBe(true);
     expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.selected.id)).toBe(passId);
     expect(await page.evaluate(()=>__themeMap.getPaintProperty('tiles','raster-brightness-max'))).toBe(theme==='light'?1:.55);
     expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
     await page.locator('#map').scrollIntoViewIfNeeded();await page.waitForTimeout(400);await page.screenshot({path:'/private/tmp/overhead-theme-map-'+theme+'-'+width+'.png'});
   }
 }
 await page.keyboard.press('Escape');
 await page.locator('#location-open').click();await page.locator('#save-location').click();await page.screenshot({path:'/private/tmp/overhead-theme-location.png'});await page.keyboard.press('Escape');
 await page.locator('#settings-open').click();await page.screenshot({path:'/private/tmp/overhead-theme-settings.png'});await page.keyboard.press('Escape');
 await page.locator('#diagnostics summary').click();await page.screenshot({fullPage:true,path:'/private/tmp/overhead-theme-diagnostics.png'});
 expect(errors).toEqual([]);expect(oldErrors).toEqual([]);
 }finally{await old.close();await new Promise(r=>server.close(r));}
});
test('weekly conclusion, detail reuse, forecast updates and both-theme responsive QA',async({page})=>{
 const errors=await boot(page);const {pass,now}=require('./overhead-weekly.cjs');
 const seed=pass(now+3600000);
 await page.evaluate(seed=>{
  const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
  const move=(night,score,name)=>{const t=s.nights[night].start+3600000,delta=t-seed.start;const p=structuredClone(seed);Object.assign(p,{id:'weekly-'+night,name,score,start:t,end:t+342000,rise:t-60000,set:t+400000});for(const k of ['entry','exit','peak','orbitalPeak'])p[k].t+=delta;p.path.forEach(x=>x.t+=delta);return p;};
  s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));s.results[0]=[move(0,70,'ISS')];s.results[1]=[move(1,96,'International Space Station — a deliberately long observing target name')];s.day=0;s.view='tonight';__OVERHEAD_TEST__.render();window.__weeklyResults=s.results;
 },seed);
 await expect(page.locator('.weekly-grade')).toHaveText('96 · Exceptional');
 const stateBefore=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;return JSON.stringify([s.site,s.settings,s.day,s.view,s.favorites]);});
 for(const width of [390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:1000});let box;
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
   const current=await page.locator('#weekly-card').boundingBox();if(box)expect(current).toEqual(box);box=current;
   await page.locator('#weekly-open').focus();expect(await page.locator('#weekly-open').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
   await page.screenshot({fullPage:true,path:'/private/tmp/overhead-weekly-'+theme+'-'+width+'.png'});
  }
 }
 await page.keyboard.press('Enter');await expect(page.locator('#event-dialog')).toBeVisible();await expect(page.locator('#detail-title')).toContainText('deliberately long');
 await page.evaluate(()=>__OVERHEAD_TEST__.render());expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.selected.id)).toBe('weekly-1');
 expect(await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;return JSON.stringify([s.site,s.settings,s.day,s.view,s.favorites]);})).toBe(stateBefore);
 expect(await page.evaluate(()=>__weeklyResults===__OVERHEAD_TEST__.state.results)).toBe(true);await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'NEXT 7 DAYS'}).click();await expect(page.locator('[data-week-best="true"]')).toHaveCount(1);await expect(page.locator('[data-day="1"]')).toContainText('BEST');
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.results[1][0].score=12;s.results[1][0].w.cloud_cover=85;__OVERHEAD_TEST__.render();});await expect(page.locator('.weekly-grade')).toHaveText('70 · Good');await expect(page.locator('#weekly-card')).toContainText('Nothing exceptional');
 await page.getByRole('tab',{name:'TONIGHT',exact:true}).click();await expect(page.locator('#weekly-tonight')).toContainText('best opportunity');
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.results[1][0].score=75;s.results[1][0].provisional=true;s.results[1][0].w=null;__OVERHEAD_TEST__.render();});await expect(page.locator('.weekly-grade')).toContainText('Potentially exceptional');await expect(page.locator('#weekly-card')).toContainText('forecast unavailable');
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;delete s.results[6];__OVERHEAD_TEST__.render();});await expect(page.locator('#weekly-card')).toContainText('BEST FOUND SO FAR');await expect(page.locator('#weekly-tonight')).toBeHidden();
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));__OVERHEAD_TEST__.render();});await expect(page.locator('#weekly-card')).toContainText('No likely visible passes');await expect(page.locator('#weekly-open')).toHaveCount(0);
 await expect(page.locator('#weekly-diagnostics')).toContainText('eventsConsidered');expect(errors).toEqual([]);
});
test('Starlink Train Watch rendering, weekly integration and About tab',async({page})=>{
 const errors=await boot(page);
 // Build a deterministic fresh-train event with the real module, then inject it as a calculated result.
 const trainEvent=await page.evaluate(()=>{
  const T=window.OverheadTrains,E=window.OverheadEngine,now=Date.now();
  const members=Array.from({length:24},(_,i)=>({OBJECT_NAME:'STARLINK-'+(70000+i),OBJECT_ID:'2026-210-'+i,NORAD_CAT_ID:70000+i,
   EPOCH:new Date(now-6*3600000).toISOString(),MEAN_MOTION:15.06,MEAN_MOTION_DOT:.00002,MEAN_MOTION_DDOT:0,ECCENTRICITY:.0001,
   INCLINATION:53,RA_OF_ASC_NODE:140,ARG_OF_PERICENTER:0,MEAN_ANOMALY:(i*.05)%360,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',ELEMENT_SET_NO:999,REV_AT_EPOCH:100,BSTAR:0}));
  const windows=__OVERHEAD_TEST__.state.windows;
  const {events}=T.detectTrains({id:'2026-210',name:'Starlink train 2026-210',launchDate:new Date(now-216000000).toISOString().slice(0,10),ageDays:2.5,members,memberCount:24,source:'CelesTrak SupGP · SpaceX ephemeris'},{lat:38.3553,lon:-87.5675,alt:0,tz:'America/Chicago'},windows,10,{now});
  const hourlyTime=Array.from({length:240},(_,i)=>Math.floor(now/3600000)*3600+i*3600-48*3600);
  const weather={timezone:'America/Chicago',hourly:{time:hourlyTime,cloud_cover:hourlyTime.map(()=>6),visibility:hourlyTime.map(()=>25000),precipitation:hourlyTime.map(()=>0),cloud_cover_low:hourlyTime.map(()=>5),cloud_cover_mid:hourlyTime.map(()=>0),cloud_cover_high:hourlyTime.map(()=>2)}};
  const e=T.finalize(events[0].event,weather);
  const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
  s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));
  s.results[events[0].windowIndex]=[e];
  s.trainCohorts=[];s.trainDiagnostics={enabled:true,cohorts:1,skipped:[],sources:{'2026-210':'CelesTrak SupGP · SpaceX ephemeris'},discoveryMs:5,calculationMs:42,
   diagnostics:[{cohort:'2026-210',memberCount:24,launchDate:'2026-09-06',ageDays:2.5,elementAgeDays:.3,samples:9000,clusterCandidates:2,rejected:[],results:[{window:events[0].windowIndex,state:'Fresh Train',visibleCount:e.train.visibleCount,medianSpacingDeg:e.train.medianSpacingDeg,spanDeg:e.train.spanDeg,maxGapDeg:e.train.maxGapDeg,stale:false}]}]};
  __OVERHEAD_TEST__.render();window.__trainEvent=e;return {id:e.id,score:e.score,state:e.train.state,windowIndex:events[0].windowIndex};
 });
 await expect(page.locator('#events')).toContainText('STARLINK TRAIN');
 await expect(page.locator('.weekly-grade')).toContainText(trainEvent.score+' ·');
 await expect(page.locator('#weekly-card')).toContainText('Starlink train 2026-210');
 // Event detail reuses the existing dialog with train-specific facts.
 await page.locator(`[data-event="${trainEvent.id}"]`).click();
 await expect(page.locator('#event-dialog')).toBeVisible();
 await expect(page.locator('#detail-title')).toContainText('Starlink train 2026-210');
 await expect(page.locator('#detail-content')).toContainText('Strong viewing window');
 await expect(page.locator('#detail-content')).toContainText('Individual spacecraft (24)');
 await expect(page.locator('#detail-content svg circle')).not.toHaveCount(0);
 expect(await page.locator('#favorite').isHidden()).toBe(true);
 await page.keyboard.press('Escape');
 // Sky preview shows multiple train members.
 const dots=await page.locator('#sky-preview svg circle').count();expect(dots).toBeGreaterThan(3);
 // Diagnostics section reports the train calculation.
 (await page.locator('#train-diagnostics summary').click());
 await expect(page.locator('#train-diagnostic-output')).toContainText('trainCalculationMs');
 // About tab: navigation, content, hash, and state preservation.
 const stateBefore=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;return JSON.stringify([s.site,s.settings,s.day,s.view,s.favorites,s.results]);});
 await page.getByRole('tab',{name:'ABOUT'}).click();
 await expect(page.locator('#about')).toBeVisible();
 await expect(page.locator('.briefing')).toBeHidden();
  await expect(page.locator('#about')).toContainText('Starlink Train Watch');
  await expect(page.locator('#about')).toContainText('CelesTrak');
  await expect(page.locator('#about')).toContainText('What are these satellites?');
  await expect(page.locator('#about')).toContainText('Wikidata');
  await expect(page.locator('#about')).toContainText('use only spacecraft identifiers');
 await expect(page.locator('#about-version')).toContainText('version 20');
 expect(new URL(page.url()).hash).toBe('#about');
 await page.getByRole('tab',{name:'TONIGHT'}).click();
 await expect(page.locator('#about')).toBeHidden();await expect(page.locator('.briefing')).toBeVisible();
 expect(await page.evaluate(()=>JSON.stringify([__OVERHEAD_TEST__.state.site,__OVERHEAD_TEST__.state.settings,__OVERHEAD_TEST__.state.day,__OVERHEAD_TEST__.state.view,__OVERHEAD_TEST__.state.favorites,__OVERHEAD_TEST__.state.results]))).toBe(stateBefore);
 expect(new URL(page.url()).hash).toBe('');
 // Keyboard navigation across four tabs.
 await page.getByRole('tab',{name:'NOW'}).focus();
 await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'TONIGHT'})).toBeFocused();
 await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'ABOUT'})).toBeFocused();
 // Responsive + both themes: no horizontal overflow anywhere, with the train card present.
 await page.getByRole('tab',{name:'TONIGHT'}).click();
 for(const width of [390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:1000});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.querySelector('[data-theme-choice=\"'+theme+'\"]').click(),theme);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
   const card=await page.locator('#weekly-card').boundingBox();
   expect(card.width).toBeLessThan(width);
  }
 }
 await page.screenshot({fullPage:true,path:'/private/tmp/overhead-train-about-dark-390.png'});
 expect(errors).toEqual([]);
});

test('public footer freshness, staged train source fetching and cache capacity',async({page})=>{
 const errors=await boot(page);
 // --- Footer freshness: seeded sources render aggregated, key-free public text; diagnostics stay raw. ---
 await page.evaluate(()=>{
  const s=__OVERHEAD_TEST__.state,now=Date.now();
  s.sources={'weather:38.355,-87.568':{at:now-5*60000},'weather:51.5,-0.1':{at:now-90*60000},
   'orbits:stations':{at:now-120*60000},'orbits:visual':{at:now-130*60000},'orbits:last-30-days':{at:now-10*60000},
   'orbits:supgp:2026-197':{at:now-18*60000},'orbits:supgp:2026-196':{at:now-24*60000},'satcat:2026-197':{at:now-2*60000}};
  for(const k of Object.keys(s.sources))s.activeSourceKeys.add(k); // all seeded sources are active here; satcat must still never surface
  __OVERHEAD_TEST__.render();
 });
 const text=await page.locator('#freshness').textContent();
 expect(text.split('Weather updated').length-1).toBe(1);
 expect(text).toContain('Orbital data updated 2h ago');
 expect(text).toContain('Starlink supplemental data updated 18m ago');
 expect(text).not.toMatch(/satcat:|orbits:|weather:/);
 expect(text).not.toContain('2026-197');
 expect(await page.locator('footer.site-footer').count()).toBe(1);
 await expect(page.locator('footer.site-footer .footer-meta')).toContainText('version 2026.');
 // Stale variants are compact and public.
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.sources={'weather:38.355,-87.568':{at:Date.now(),stale:true},'orbits:stations':{at:Date.now()-7200000,stale:true}};__OVERHEAD_TEST__.render();});
 await expect(page.locator('#freshness')).toContainText('Weather: stale cached forecast');
 await expect(page.locator('#freshness')).toContainText('Orbital data: stale cache · refresh recommended');
 // Diagnostics retain the full raw source telemetry.
 await page.locator('#diagnostics summary').click();
 await expect(page.locator('#diagnostic-output')).toContainText('weather:38.355,-87.568');
 const member=(desig,i,norad)=>({OBJECT_NAME:'STARLINK-'+norad,OBJECT_ID:desig+'-'+i,NORAD_CAT_ID:norad,EPOCH:'2026-09-07T12:00:00.000000',MEAN_MOTION:15.06,MEAN_MOTION_DOT:.00002,MEAN_MOTION_DDOT:0,ECCENTRICITY:.0001,INCLINATION:53,RA_OF_ASC_NODE:140,ARG_OF_PERICENTER:0,MEAN_ANOMALY:(i*.4)%360,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',ELEMENT_SET_NO:999,REV_AT_EPOCH:100,BSTAR:0});
 const cohort=(desig,noradBase)=>Array.from({length:8},(_,i)=>member(desig,i,noradBase+i));
 const omm=[...cohort('2026-180',80000),...cohort('2026-181',81000),...cohort('2026-182',82000),...cohort('2026-183',83000)];
 const requests={satcat:[],supgp:[]};
 // Later routes win: override boot's CelesTrak catch-all for the train-specific endpoints.
 await page.route('**/gp.php*GROUP=last-30-days*',r=>r.fulfill({json:omm}));
 await page.route('**/satcat/records.php*',r=>{
  const intdes=new URL(r.request().url()).searchParams.get('INTDES');requests.satcat.push(intdes);
  const launch={'2026-180':'2026-08-01','2026-181':'2026-09-06','2026-183':'2026-09-06'}[intdes];
  if(intdes==='2026-182')return r.fulfill({status:500,body:'unavailable'}); // SATCAT failure: age must stay unknown
  r.fulfill({json:[{OBJECT_NAME:'STARLINK-'+intdes,OBJECT_ID:intdes+'A',NORAD_CAT_ID:1,LAUNCH_DATE:launch}]});
 });
 await page.route('**sup-gp.php*',r=>{
  const intdes=new URL(r.request().url()).searchParams.get('INTDES');requests.supgp.push(intdes);
  if(intdes==='2026-183')return r.fulfill({status:500,body:'unavailable'}); // SupGP failure: general-catalog fallback
  r.fulfill({json:omm.filter(o=>o.OBJECT_ID.startsWith(intdes))});
 });
 await page.locator('#refresh').click();
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy&&!__OVERHEAD_TEST__.state.loading,null,{timeout:60000});
 await page.waitForTimeout(500);
 const flow=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;return {cohorts:s.trainCohorts.map(c=>({id:c.id,age:c.launchAgeDays,src:c.ageSource,elements:c.source})),skipped:s.trainSkipped,diag:s.trainDiagnostics};});
 // Old cohort: SATCAT asked, then rejected before any SupGP request.
 expect(flow.skipped.some(s=>s.id==='2026-180'&&/Launched ~3\d days ago/.test(s.reason))).toBe(true);
 expect(requests.satcat).toContain('2026-180');
 expect(requests.supgp).not.toContain('2026-180');
 // Young cohort: SATCAT then SupGP, SpaceX-ephemeris elements.
 expect(requests.supgp).toContain('2026-181');
 expect(flow.cohorts.some(c=>c.id==='2026-181'&&c.age!==null&&c.src==='SATCAT launch date'&&/SupGP/.test(c.elements))).toBe(true);
 // Unknown launch age (SATCAT 500): kept without fabrication, SupGP still requested.
 expect(flow.cohorts.some(c=>c.id==='2026-182'&&c.age===null&&c.src==='unknown')).toBe(true);
 expect(requests.supgp).toContain('2026-182');
 // SupGP failure: general-catalog fallback, train pipeline still alive.
 expect(flow.cohorts.some(c=>c.id==='2026-183'&&/general catalog/.test(c.elements))).toBe(true);
 // On file:// the worker is blocked and Train Watch detection disables itself (documented
 // fallback); the staged FETCH behavior is what this test verifies, via real network counts.
 expect(requests.supgp).toContain('2026-181');
 expect(requests.supgp).not.toContain('2026-180');
 // --- Cache capacity: 41 records evict to the bounded 32, newest kept. ---
 const size=await page.evaluate(async()=>{
  const T=window.__OVERHEAD_TEST__;const now=Date.now();
  await T.cachePut({key:'weather:core',at:now,data:{kept:true}});
  for(let i=0;i<40;i++)await T.cachePut({key:'filler:'+i,at:now+i,data:i});
  return T.cacheSize();
 });
 expect(size).toBe(32);
 expect(errors).toEqual([]);
 // Footer responsive/theme QA at desktop width resembling the reported failure.
 await page.setViewportSize({width:1024,height:900});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1024);
  const box=await page.locator('footer.site-footer').boundingBox();
  expect(box.height).toBeLessThan(220);
  const sources=await page.locator('.footer-sources').boundingBox();
  expect(sources.height).toBeLessThan(60); // no narrow vertical strip
 }
 await page.screenshot({fullPage:true,path:'/private/tmp/overhead-footer-1024.png'});
});

test('public source status uses only currently active sources',async({page})=>{
 const errors=await boot(page);
 // Historical telemetry left in state.sources by earlier sessions/locations/toggles.
 await page.evaluate(()=>{
  const s=__OVERHEAD_TEST__.state,now=Date.now();
  Object.assign(s.sources,{
   'weather:99.000,-99.000':{at:now-90*60000,stale:true}, // previous location, stale
   'orbits:supgp:2026-999':{at:now-6*60000,stale:false},  // train toggle later turned off
   'satcat:2026-999':{at:now-7*60000,stale:false}});
  __OVERHEAD_TEST__.render();
 });
 const active=await page.evaluate(()=>[...__OVERHEAD_TEST__.state.activeSourceKeys].sort());
 expect(active.some(k=>k.startsWith('weather:'))).toBe(true);
 expect(active.some(k=>k==='orbits:last-30-days')).toBe(true); // Train Watch enabled by default
 expect(active.includes('orbits:supgp:2026-999')).toBe(false);
 // Footer: only active sources; no supplemental line, no stale warning from history.
 let text=await page.locator('#freshness').textContent();
 expect(text).not.toContain('Starlink supplemental');
 expect(text).not.toMatch(/stale/i);
 expect(text).toMatch(/Weather updated/);
 // Status banner does not inherit the historical stale warning.
 expect(await page.locator('#status').textContent()).not.toContain('Cached data is stale');
 // Diagnostics keep the full historical telemetry AND expose the active set.
 await page.locator('#diagnostics summary').click();
 const diag=await page.locator('#diagnostic-output').textContent();
 expect(diag).toContain('weather:99.000,-99.000');
 expect(diag).toContain('orbits:supgp:2026-999');
 expect(diag).toContain('"activeSourceKeys"');
 // Activating the SupGP key (eligible cohort requests it) makes the line appear…
 await page.evaluate(()=>{__OVERHEAD_TEST__.state.activeSourceKeys.add('orbits:supgp:2026-999');__OVERHEAD_TEST__.render();});
 await expect(page.locator('#freshness')).toContainText('Starlink supplemental data updated');
 // …and deactivating it (Train Watch disabled / cohorts age-gated) removes it again.
 await page.evaluate(()=>{__OVERHEAD_TEST__.state.activeSourceKeys.delete('orbits:supgp:2026-999');__OVERHEAD_TEST__.render();});
 await expect(page.locator('#freshness')).not.toContainText('Starlink supplemental');
 // A STALE ACTIVE source does produce the compact warning.
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;const k=[...s.activeSourceKeys].find(k=>k.startsWith('weather:'));s.sources[k].stale=true;__OVERHEAD_TEST__.render();});
 await expect(page.locator('#freshness')).toContainText('Weather: stale cached forecast');
 await expect(page.locator('#status')).toContainText('Cached data is stale');
 // New load generation rebuilds the active set: historical keys never leak back in.
 await page.locator('#refresh').click();
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy&&!__OVERHEAD_TEST__.state.loading,null,{timeout:60000});
 const after=await page.evaluate(()=>({active:[...__OVERHEAD_TEST__.state.activeSourceKeys].sort(),fresh:__OVERHEAD_TEST__.engine.publicFreshness(Object.fromEntries([...__OVERHEAD_TEST__.state.activeSourceKeys].filter(k=>__OVERHEAD_TEST__.state.sources[k]).map(k=>[k,__OVERHEAD_TEST__.state.sources[k]])))}));
 expect(after.active.some(k=>k.includes('99.000'))).toBe(false);
 expect(after.active.some(k=>k.includes('2026-999'))).toBe(false);
 expect(after.fresh).not.toContain('Starlink supplemental');
 expect(await page.locator('#freshness')).not.toContainText('Starlink supplemental');
 // Footer stays compact in both themes at phone and desktop widths.
 for(const width of [390,1024]){
  await page.setViewportSize({width,height:900});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
   expect((await page.locator('footer.site-footer').boundingBox()).height).toBeLessThan(220);
  }
 }
 await page.getByRole('tab',{name:'ABOUT'}).click();
 await expect(page.locator('footer.site-footer')).toBeVisible();
 expect(errors).toEqual([]);
});

test('theme switching survives failed storage and missing source data',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='overhead.theme')throw new DOMException('Storage full','QuotaExceededError');return original.call(this,key,value);};});
 const errors=await boot(page,{offline:true});await page.setViewportSize({width:390,height:844});
 await page.locator('#settings-open').click();await page.getByRole('button',{name:'Use light theme'}).click();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');await expect(page.locator('#status')).toContainText('could not be saved');await expect(page.locator('.event')).toHaveCount(0);
 await page.screenshot({fullPage:true,path:'/private/tmp/overhead-theme-empty-light.png'});
 await page.reload();await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe('dark');expect(errors).toEqual([]);
});
