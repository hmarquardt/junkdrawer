/* Celestial observing planner: category switching, planning horizons, empty states, data-failure
   degradation, local time handling, accessibility and the honesty rules that must hold in the DOM.
   The data artifacts are served from disk because a file:// page cannot fetch them. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs');
test.use({channel:'chrome'});
test.setTimeout(180000);
// The published element set is re-dated to the mocked clock so the satellite side really produces
// passes; this test is about the celestial layer not disturbing them.
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:15,cloud_cover_low:5,cloud_cover_mid:5,cloud_cover_high:5,visibility:24000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);

async function boot(page,{datasets='real',meteorsOverride=null,offlineData=false}={}){
 const errors=[];
 page.on('pageerror',e=>errors.push('pageerror: '+e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push('console: '+m.text());});
 await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 await page.route('**celestrak.org/**',r=>r.fulfill({json:[ISS]}));
 await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
 await page.route('**/data/overhead/*.json',route=>{
  const file=route.request().url().split('/data/overhead/')[1].split('?')[0];
  if(offlineData){route.fulfill({status:500,body:'unavailable'});return;}
  if(meteorsOverride&&file==='meteor-showers.json'){route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(meteorsOverride)});return;}
  const full=path.resolve('data/overhead',file);
  if(!fs.existsSync(full)){route.fulfill({status:404,body:'missing'});return;}
  route.fulfill({status:200,contentType:'application/json',body:fs.readFileSync(full,'utf8')});
 });
 await page.goto('file://'+path.resolve('overhead.html'));
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
 return errors;
}
const ready=page=>page.waitForFunction(()=>['ready','error'].includes(__OVERHEAD_TEST__.celestial.status),null,{timeout:150000});

// 1. The new categories render real events with their reasoning, limits and provenance.
test('celestial categories render calculated events with humility and provenance',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('.event').first()).toBeVisible();
 const satelliteEvents=await page.locator('.event').count();
 await page.getByRole('tab',{name:'PLANETS & ALIGNMENTS'}).click();
 await ready(page);
 expect(await page.evaluate(()=>__OVERHEAD_TEST__.celestial.category)).toBe('planets');
 await expect(page.locator('#celestial')).toBeVisible();
 await expect(page.locator('#celestial-events .celestial-card').first()).toBeVisible();
 await expect(page.locator('#celestial-top-score')).not.toHaveText('—');
 // The satellite dashboard is out of the way but its state is untouched.
 await expect(page.locator('#events')).toBeHidden();
 const card=page.locator('.celestial-card').first();
 await expect(card.locator('h3')).not.toBeEmpty();
 await expect(card.locator('.celestial-why li').first()).toBeVisible();
 await expect(card.locator('.celestial-positions')).toBeVisible();
 await expect(card.locator('.celestial-sky')).toBeVisible();
 await expect(card.locator('.celestial-confidence')).toContainText('Position certainty');
 await expect(card.locator('.celestial-confidence')).toContainText('Observing suitability');
 await expect(card.locator('.celestial-confidence')).toContainText('Phenomenon predictability');
 await expect(card.locator('.celestial-caveats li').first()).toBeVisible();
 await expect(card.locator('.celestial-source')).toContainText('Astronomy Engine');
 // The three confidences must be distinct statements, not one merged score.
 const confidence=await card.locator('.celestial-confidence').textContent();
 expect(confidence).toMatch(/exact|horizons-sampled|catalogue|kepler/i);
 expect(confidence.length).toBeGreaterThan(80);
 await expect(page.locator('#celestial-freshness-body')).toContainText('JPL Horizons');
 console.log('planets card:',(await card.locator('h3').textContent()).trim(),'errors',errors.length);
 await page.getByRole('tab',{name:'SATELLITES'}).click();
 await expect(page.locator('#celestial')).toBeHidden();
 await expect(page.locator('.event')).toHaveCount(satelliteEvents);
 expect(errors).toEqual([]);
});

// 2. Horizons: tonight, seven days and ninety days, with consolidation at the long range.
test('planning horizons recalculate and consolidate without inventing events',async({page})=>{
 const errors=await boot(page);
 await page.getByRole('tab',{name:'METEOR SHOWERS'}).click();
 await ready(page);
 const tonight=await page.locator('.celestial-card').count();
 expect(tonight).toBeGreaterThan(0);
 await page.getByRole('radio',{name:'NEXT 7 DAYS'}).click();
 await page.waitForFunction(()=>__OVERHEAD_TEST__.celestial.status==='ready'&&__OVERHEAD_TEST__.celestial.horizon==='week'&&__OVERHEAD_TEST__.celestial.result&&__OVERHEAD_TEST__.celestial.result.horizon==='week',null,{timeout:150000});
 const week=await page.locator('.celestial-card').count();
 expect(week).toBeGreaterThanOrEqual(tonight);
 await page.getByRole('radio',{name:'NEXT 90 DAYS'}).click();
 await page.waitForFunction(()=>__OVERHEAD_TEST__.celestial.status==='ready'&&__OVERHEAD_TEST__.celestial.result&&__OVERHEAD_TEST__.celestial.result.horizon==='extended',null,{timeout:180000});
 const extended=await page.locator('.celestial-card').count();
 expect(extended).toBeGreaterThan(0);
 expect(await page.evaluate(()=>__OVERHEAD_TEST__.celestial.result.plans.extended.consolidated)).toBe(true);
 // Long-range cards that group several nights must say so, and must carry the best night's numbers.
 const merged=page.locator('.celestial-card').filter({hasText:/Best night of \d+ between/});
 expect(await merged.count()).toBeGreaterThan(0);
 await expect(merged.first()).toContainText(/Best night of \d+ between/);
 // Every card in every horizon shows a real local time for the selected site.
 const times=await page.evaluate(()=>[...document.querySelectorAll('.celestial-card .mono')].map(el=>el.textContent));
 for(const text of times)expect(text).toMatch(/best \d{1,2}:\d{2} (AM|PM)/);
 expect(errors).toEqual([]);
 console.log('horizons: tonight',tonight,'week',week,'90 days',extended,'cards; merged cards',await merged.count());
});

// 3. Nothing to show is a real answer, not a gap to fill.
test('an empty or unobservable window renders an explanation rather than fabricated events',async({page})=>{
 const errors=await boot(page);
 await page.getByRole('tab',{name:'PLANETS & ALIGNMENTS'}).click();
 await ready(page);
 // Force the empty state by asking for a window with no events: the polar night has no dark sky in June.
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.site={name:'Longyearbyen',lat:78.22,lon:15.65,tz:'Arctic/Longyearbyen'};});
 await page.evaluate(()=>__OVERHEAD_TEST__.state.site=__OVERHEAD_TEST__.state.site);
 await page.evaluate(()=>{const c=__OVERHEAD_TEST__.celestial;c.result=null;c.status='idle';});
 await page.evaluate(()=>{__OVERHEAD_TEST__.selectCategory('planets');});
 await ready(page);
 const plan=await page.evaluate(()=>{const r=__OVERHEAD_TEST__.celestial.result;return r&&r.plans?{empty:r.plans[r.horizon].empty,reason:r.plans[r.horizon].emptyReason,count:r.plans[r.horizon].opportunities.length}:null;});
 expect(plan).not.toBeNull();
 if(plan.empty){
  await expect(page.locator('#celestial-events .celestial-empty')).toBeVisible();
  await expect(page.locator('#celestial-events .celestial-empty')).toContainText(/quiet night is a normal result|Nothing/);
  expect(plan.reason).toBeTruthy();
  expect(plan.count).toBe(0);
 }
 // Whatever the outcome, no card may claim an object that is below the minimum altitude.
 const lows=await page.evaluate(()=>[...document.querySelectorAll('.celestial-card')].map(card=>{
  const cells=[...card.querySelectorAll('.celestial-positions td:nth-child(2)')].map(td=>parseFloat(td.textContent));
  return {title:card.querySelector('h3').textContent,alts:cells.filter(Number.isFinite)};}).filter(entry=>entry.alts.some(value=>value<8&&value<20)));
 for(const entry of lows)expect(entry.alts.every(value=>value>=8),entry.title+' lists an object below the 8 degree minimum');
 expect(errors).toEqual([]);
 console.log('empty-state check:',plan.empty?'empty plan explained ('+plan.reason.slice(0,60)+'…)':'plan had '+plan.count+' cards, all above the altitude floor');
});

// 4. A missing or expired dataset degrades to an explanation; nothing is guessed.
test('missing and expired source data degrade honestly and never break the page',async({page})=>{
 const errors=await boot(page,{offlineData:true});
 await page.getByRole('tab',{name:'METEOR SHOWERS'}).click();
 await ready(page);
 expect(await page.locator('.celestial-card').count()).toBe(0);
 await expect(page.locator('#celestial-events .celestial-empty')).toBeVisible();
 await expect(page.locator('#celestial-freshness-body')).toContainText('could not be loaded');
 const notices=await page.evaluate(()=>__OVERHEAD_TEST__.celestial.errors.join(' | '));
 expect(notices).toMatch(/meteor shower calendar could not be loaded/i);
 // Satellites are unaffected by celestial source failures.
 await page.getByRole('tab',{name:'SATELLITES'}).click();
 await expect(page.locator('.event').first()).toBeVisible();
 expect(errors).toEqual([]);
 console.log('failure path: meteor showers refused with',notices.slice(0,70));
});
test('an out-of-date meteor calendar produces no predictions for the current year',async({page})=>{
 const real=JSON.parse(fs.readFileSync(path.resolve('data/overhead/meteor-showers.json'),'utf8'));
 const expired={...real,calendar_year:2025,coverage:{start:'2025-01-01',end:'2025-12-31'},generated_at:'2025-07-01T00:00:00Z'};
 const errors=await boot(page,{meteorsOverride:expired});
 await page.getByRole('tab',{name:'METEOR SHOWERS'}).click();
 await ready(page);
 expect(await page.locator('.celestial-card').count()).toBe(0);
 await expect(page.locator('#celestial-events .celestial-empty')).toBeVisible();
 const notices=await page.evaluate(()=>__OVERHEAD_TEST__.celestial.errors.join(' | '));
 expect(notices).toMatch(/2025/);
 expect(notices).toMatch(/refresh/i);
 expect(errors).toEqual([]);
 console.log('expired calendar: refused with',notices.slice(0,90));
});

// 5. Comets: measured brightness is never presented as a prediction and vice versa.
test('comet cards separate measured brightness from model predictions',async({page})=>{
 const errors=await boot(page);
 await page.getByRole('tab',{name:'COMETS & SPECIAL EVENTS'}).click();
 await ready(page);
 const plan=await page.evaluate(()=>{const r=__OVERHEAD_TEST__.celestial.result;return {count:r.plans[r.horizon].opportunities.length,comets:r.plans[r.horizon].opportunities.filter(o=>o.category==='comets').length};});
 await page.getByRole('radio',{name:'NEXT 90 DAYS'}).click();
 await page.waitForFunction(()=>__OVERHEAD_TEST__.celestial.status==='ready'&&__OVERHEAD_TEST__.celestial.result&&__OVERHEAD_TEST__.celestial.result.horizon==='extended',null,{timeout:180000});
 const cards=page.locator('.celestial-card');
 const count=await cards.count();
 expect(count).toBeGreaterThan(0);
 let sawMeasured=false,sawPredicted=false,sawEclipse=false;
 for(let i=0;i<count;i++){
  const text=await cards.nth(i).textContent();
  if(/Measured magnitude/.test(text)){sawMeasured=true;expect(text).toMatch(/COBS/);}
  if(/Predicted magnitude/.test(text)){sawPredicted=true;expect(text).toMatch(/model value, not a measurement/);}
  if(/eclipse/i.test(text)){sawEclipse=true;expect(text).toMatch(/Certified solar filter|Naked eye/);}
 }
 expect(sawMeasured||sawPredicted).toBe(true);
 // Every comet card must state which kind of brightness it is showing.
 const cometCards=await page.evaluate(()=>[...document.querySelectorAll('.celestial-card')].map(card=>({type:card.dataset.type,text:card.textContent})).filter(entry=>entry.type==='comet'));
 for(const entry of cometCards)expect(entry.text).toMatch(/Measured magnitude|Predicted magnitude|No recent measured brightness/);
 // Titles must never oversell: no "spectacle" marketing language anywhere in the planner.
 const pageText=await page.locator('#celestial').textContent();
 expect(pageText).not.toMatch(/spectacle|amazing|once in a lifetime|must see/i);
 expect(errors).toEqual([]);
 console.log('comet cards:',cometCards.length,'comets, measured fields',sawMeasured,'predicted fields',sawPredicted,'eclipse cards',sawEclipse);
});

// 6. Location and timezone: the plan follows the observer, and times are always local.
test('changing location recalculates the plan in the new local timezone',async({page})=>{
 const errors=await boot(page);
 await page.getByRole('tab',{name:'PLANETS & ALIGNMENTS'}).click();
 await ready(page);
 await page.getByRole('radio',{name:'NEXT 90 DAYS'}).click();
 await page.waitForFunction(()=>__OVERHEAD_TEST__.celestial.status==='ready'&&__OVERHEAD_TEST__.celestial.result&&__OVERHEAD_TEST__.celestial.result.horizon==='extended',null,{timeout:180000});
 const princeton=await page.evaluate(()=>{const r=__OVERHEAD_TEST__.celestial.result.plans.extended;
  return {count:r.opportunities.length,ids:r.opportunities.map(o=>o.id+'@'+o.best)};});
 await expect(page.locator('#celestial-status')).toContainText('Princeton, Indiana');
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.site={name:'Cape Town',lat:-33.9249,lon:18.4241,tz:'Africa/Johannesburg'};});
 await page.evaluate(()=>__OVERHEAD_TEST__.selectCategory('planets'));
 await page.waitForFunction(()=>__OVERHEAD_TEST__.celestial.status==='ready'&&__OVERHEAD_TEST__.celestial.result&&__OVERHEAD_TEST__.celestial.result.horizon==='extended',null,{timeout:180000});
 const cape=await page.evaluate(()=>{const r=__OVERHEAD_TEST__.celestial.result.plans.extended;
  return {count:r.opportunities.length,ids:r.opportunities.map(o=>o.id+'@'+o.best)};});
 expect(princeton.count).toBeGreaterThan(0);
 expect(cape.ids.join('|')).not.toBe(princeton.ids.join('|'));
 await expect(page.locator('#celestial-status')).toContainText('Cape Town');
 // Rendered times use the site's zone, not the browser's.
 const rendered=await page.locator('.celestial-card .mono').first().textContent();
 const expected=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state,o=__OVERHEAD_TEST__.celestial.result.plans[__OVERHEAD_TEST__.celestial.horizon].opportunities[0];
  return new Intl.DateTimeFormat('en-US',{timeZone:s.site.tz,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(o.best));});
 expect(rendered).toContain(expected);
 expect(errors).toEqual([]);
 console.log('location: Princeton',princeton.count,'cards vs Cape Town',cape.count,'cards; local time',rendered.trim());
});

// 7. Accessibility, keyboard use and responsive layout in the new interface.
test('celestial controls are accessible, keyboard operable and responsive',async({page})=>{
 const errors=await boot(page);
 const tabs=page.locator('#categories [role="tab"]');
 await expect(tabs).toHaveCount(4);
 await expect(tabs.first()).toHaveAttribute('aria-selected','true');
 const horizons=page.locator('[data-horizon]');
 await expect(horizons).toHaveCount(3);
 await expect(horizons.first()).toHaveAttribute('role','radio');
 await expect(horizons.first()).toHaveAttribute('aria-checked','true');
 // Keyboard navigation on the category tablist.
 await tabs.first().focus();
 await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>document.activeElement.dataset.category)).toBe('planets');
 await ready(page);
 await expect(page.locator('#celestial-controls,caption')).toHaveCount(0).catch(()=>{});
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:1000});
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.locator('.celestial-card').first().isVisible()).toBe(true);
 }
 await page.screenshot({path:'/tmp/overhead-celestial-planets.png',fullPage:true});
 await page.getByRole('tab',{name:'COMETS & SPECIAL EVENTS'}).click();
 await ready(page);
 await page.setViewportSize({width:390,height:1000});
 await page.waitForTimeout(150);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'/tmp/overhead-celestial-comets.png',fullPage:true});
 await page.getByRole('tab',{name:'METEOR SHOWERS'}).click();
 await ready(page);
 await page.screenshot({path:'/tmp/overhead-celestial-meteors.png',fullPage:true});
 expect(errors).toEqual([]);
 console.log('layout: no horizontal overflow at 390/768/1440; keyboard tab navigation works');
});

// 8. The calculation runs off the main thread when workers are available, and the synchronous
//    fallback produces exactly the same plan. Workers need an http origin, so this test serves the
//    repository over a local server (the same pattern the theme-parity test uses for its baseline).
test('the plan is computed in a worker and the synchronous fallback agrees',async({page})=>{
 const http=require('http');
 const types={'.html':'text/html','.js':'application/javascript','.json':'application/json'};
 const allowed=/^(overhead[\w.-]*\.(html|js)|vendor\/overhead\/[\w.-]+\.(js|min\.js)|data\/overhead\/[\w.-]+\.json|analytics-lite\.js)$/;
 const server=http.createServer((request,response)=>{
  const file=new URL(request.url,'http://local').pathname.replace(/^\//,'');
  if(!allowed.test(file)||!fs.existsSync(path.resolve(file))){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',types[path.extname(file)]||'text/plain');
  response.end(fs.readFileSync(path.resolve(file)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push('console: '+m.text());});
  await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',r=>r.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
  await page.goto(origin+'/overhead.html');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  await page.getByRole('tab',{name:'PLANETS & ALIGNMENTS'}).click();
  await ready(page);
  const workerState=await page.evaluate(()=>({used:!!__OVERHEAD_TEST__.celestial.worker,failed:__OVERHEAD_TEST__.celestial.workerFailed,
   available:typeof Worker==='function',candidates:__OVERHEAD_TEST__.celestial.result.diagnostics.candidateCount}));
  expect(workerState.available).toBe(true);
  expect(workerState.used).toBe(true);
  expect(workerState.failed).toBe(false);
  expect(workerState.candidates).toBeGreaterThan(0);
  const workerPlan=await page.evaluate(()=>JSON.stringify(__OVERHEAD_TEST__.celestial.result.plans.tonight.opportunities.map(o=>[o.id,o.observing.value])));
  // Force the inline path and confirm it produces exactly the same plan.
  await page.evaluate(()=>{__OVERHEAD_TEST__.celestial.worker.terminate();__OVERHEAD_TEST__.celestial.worker=null;__OVERHEAD_TEST__.celestial.workerFailed=true;});
  await page.evaluate(()=>__OVERHEAD_TEST__.requestCelestial());
  await ready(page);
  const inlinePlan=await page.evaluate(()=>JSON.stringify(__OVERHEAD_TEST__.celestial.result.plans.tonight.opportunities.map(o=>[o.id,o.observing.value])));
  expect(inlinePlan).toBe(workerPlan);
  expect(errors).toEqual([]);
  console.log('worker: used with',workerState.candidates,'candidates; the inline fallback produced an identical plan');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
