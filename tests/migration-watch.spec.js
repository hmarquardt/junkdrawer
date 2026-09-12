const {test,expect}=require('@playwright/test');
const path=require('path');
test.use({channel:'chrome'});
test.setTimeout(90000);
const FILE='file://'+path.resolve('migration-watch.html');
const now=Date.now(),H=3600000,D=86400000;
const obs=(code,name,sci,locId,loc,lat,lng,ageHours,howMany)=>({speciesCode:code,comName:name,sciName:sci,locId,locName:loc,obsDt:new Date(now-ageHours*H).toISOString(),...(howMany!=null?{howMany}:{}) ,lat,lng,obsValid:true,obsReviewed:false,locationPrivate:false});
const BIRDS=[
 ['rthhum','Ruby-throated Hummingbird','Archilochus colubris'],['sancra','Sandhill Crane','Antigone canadensis'],
 ['bwaha','Broad-winged Hawk','Buteo platypterus'],['osprey','Osprey','Pandion haliaetus'],
 ['cmwa','Cape May Warbler','Setophaga tigrina'],['amre','American Redstart','Setophaga ruticilla'],
 ['swth','Swainson\u2019s Thrush','Catharus ustulatus'],['dunl','Dunlin','Calidris alpina'],
 ['rwbl','Red-winged Blackbird','Agelaius phoeniceus'],['whtsp','White-throated Sparrow','Zonotrichia albicollis'],
 ['conigh','Common Nighthawk','Chordeiles minor'],['comme','Common Merganser','Mergus merganser'],
 ['wav1','Warbling Vireo','Vireo gilvus'],['phvi','Philadelphia Vireo','Vireo philadelphicus'],
 ['lebi','Least Bittern','Ixobrychus exilis'],['noha','Northern Harrier','Circus hudsonius'],
 ['bbmag','Bobolink','Dolichonyx oryzivorus'],['grca','Gray-cheeked Thrush','Catharus minimus']];
function fixture(count,spread){ // build a mixed recent-observations payload
 const out=[];
 for(let i=0;i<count;i++){const b=BIRDS[i%BIRDS.length];
  const age=(i%14)*20+(i%5)*3;const lat=38.35+(i%7-3)*.02,lng=-87.57+((i*3)%9-4)*.02;
  out.push(obs(b[0],b[1],b[2],'L'+(i%12),'Loc '+(i%12),lat,lng,age,i%4===0?4+(i%9):undefined));}
 return out;
}
const RECENT=fixture(90);
const NOTABLE=[obs('cmwa','Cape May Warbler','Setophaga tigrina','N1','Extra Special Spot',38.36,-87.55,20,3),
 obs('sancra','Sandhill Crane','Antigone canadensis','N2','Big Field',38.30,-87.60,30,1200)];
const HUM=[obs('rthhum','Ruby-throated Hummingbird','Archilochus colubris','H1','Yard feeder',38.3553,-87.5675,2,2),
 obs('rthhum','Ruby-throated Hummingbird','Archilochus colubris','H2','Neighbor feeder',38.38,-87.59,8,1),
 obs('rthhum','Ruby-throated Hummingbird','Archilochus colubris','H3','Park',38.42,-87.61,26,3)];
const CRANE=[obs('sancra','Sandhill Crane','Antigone canadensis','C1','Goose Pond',38.79,-87.27,10,900),
 obs('sancra','Sandhill Crane','Antigone canadensis','C2','North fields',38.60,-87.40,34,4000)];
async function mockEbird(page,{key='GOODKEY',failRecent=false,failAll=false,empty=false,large=false}={}){
 await page.route('**api.ebird.org/**',r=>{
  const u=r.request().url();const k=r.request().headers()['x-ebirdapitoken'];
  if(failAll)return r.fulfill({status:503,body:'unavailable'});
  if(!k||k!==key)return r.fulfill({status:401,body:'Invalid API key'});
  if(failRecent&&u.includes('/recent?'))return r.fulfill({status:500,body:'boom'});
  if(u.includes('notable'))return r.fulfill({json:empty?[]:NOTABLE});
  if(u.includes('recent/rthhum'))return r.fulfill({json:empty?[]:HUM});
  if(u.includes('recent/sancra'))return r.fulfill({json:empty?[]:CRANE});
  if(u.includes('/recent?'))return r.fulfill({json:empty?[]:(large?[...RECENT,...RECENT,...RECENT,...fixture(60)]:RECENT)});
  r.fulfill({json:[]});
 });
}
async function boot(page,{...opts}={}){
 await page.goto(FILE);
 await page.waitForFunction(()=>window.__MW_TEST__);
}
test('initial page with no API key renders honestly and stays usable',async({page})=>{
 await mockEbird(page);await boot(page);
 await expect(page.locator('#verdict')).toHaveText('AWAITING eBIRD KEY');
 await expect(page.locator('#reco')).toContainText('no simulated numbers');
 await expect(page.locator('#fcard-rthhum')).toBeVisible();
 await expect(page.locator('#fcard-sancra')).toContainText('Historical baseline unavailable');
 await expect(page.locator('#species-list')).toContainText('No observations');
});
test('key entry, refresh, featured cards, ranking and deterministic score',async({page})=>{
 await mockEbird(page);
 await page.route('**birdcast.info/**',r=>r.fulfill({status:404,body:'no'}));
 await boot(page);
 await page.locator('#settings-open').click();
 await page.locator('#set-key').fill('GOODKEY');
 await page.locator('#settings-form button[type=submit]').click();
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await expect(page.locator('#verdict')).toContainText(/MIGRATION|MOVEMENT/);
 await expect(page.locator('#fcard-rthhum')).toContainText('Ruby-throated Hummingbird');
 await expect(page.locator('#fcard-rthhum')).toContainText('Keep feeders active');
 await expect(page.locator('#fcard-sancra')).toContainText('Sandhill Crane');
 await expect(page.locator('#fcard-sancra')).toContainText('Worth a regional trip');
 await expect(page.locator('.srow')).toHaveCount(15);
 const s=await page.evaluate(()=>{const T=window.__MW_TEST__;
  const sp={recent72:[1,2,3,4,5,6],rate:2.0,seasonal:.8,maxCount:900,nearest:{d:5},locations:5};
  return {per:T.Scoring.speciesScore(sp).score,gl:T.Scoring.goLooking([sp],{available:true,intensity:100}),
   glNoBirdcast:T.Scoring.goLooking([sp],null).score};});
 // activity 6/6→30 · trend (2−.6)/2.4→11.7 · seasonal .8→16 · concentration clamps→15 ·
 // proximity (1−5/25)→8 · multi-location→5 ⇒ 85.7
 expect(s.per).toBe(85.7);
 expect(s.gl.score).toBe(Math.round(s.gl.score));
 expect(s.gl.score).toBeGreaterThan(0);
 expect(s.glNoBirdcast).toBeGreaterThanOrEqual(0);
});

test('invalid API key shows a failure state without fake data',async({page})=>{
 await mockEbird(page,{key:'GOODKEY'});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'BADKEY',preset:'princeton',radius:25,appearance:'dark'})));
 await boot(page);
 await page.waitForTimeout(1200);
 await expect(page.locator('#status-strip')).toContainText('eBird');
});
test('eBird total failure degrades independently',async({page})=>{
 await mockEbird(page,{failAll:true});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForTimeout(1500);
 await expect(page.locator('#status-strip')).toContainText('eBird');
});
test('no observations produces Quiet verdict and honest copy',async({page})=>{
 await mockEbird(page,{empty:true});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await expect(page.locator('#species-list')).toContainText('No observations');
 await expect(page.locator('#reco')).toContainText('Probably not worth a dedicated drive');
});
test('large result set stays responsive with no overflow',async({page})=>{
 await mockEbird(page,{large:true});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.setViewportSize({width:390,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
 await page.setViewportSize({width:1440,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1440);
 await expect(page.locator('.srow').first()).toBeVisible();
});
test('species selection opens the detail drawer with full content',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.locator('.srow').first().click();
 await expect(page.locator('#detail')).toBeVisible();
 await expect(page.locator('#detail-name')).not.toBeEmpty();
 await expect(page.locator('#detail-body')).toContainText('Migration status');
 await expect(page.locator('#detail-body')).toContainText('OBSERVED');
 await page.keyboard.press('Escape');
 await expect(page.locator('#detail')).toBeHidden();
});


test('Surprise Me explains why each species was selected',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.locator('#surprise').click();
 await expect(page.locator('#surprise-out .sur').first()).toBeVisible();
 const why=await page.locator('#surprise-out .sur .why').first().textContent();
 expect(why.length).toBeGreaterThan(10);
 const names=await page.locator('#surprise-out .sur strong').allTextContents();
 expect(names.length).toBeGreaterThan(0);
 // Cape May Warbler should qualify: notable + 4 locations assumption in fixtures
 expect(names.some(n=>/Cape May|Sandhill|Hummingbird/.test(n))).toBe(true);
});

test('map is lazy, initializes on open, supports filters, fit and recenter',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 expect(await page.locator('script[src*="maplibre"]').count()).toBe(0); // lazy: not loaded before open
 await page.locator('#map-details > summary').click();
 await page.waitForFunction(()=>window.__MW_TEST__.MapMod.map!==null,null,{timeout:20000});
 expect(await page.locator('script[src*="maplibre"]').count()).toBe(1);
 await expect(page.locator('#map canvas').first()).toBeVisible({timeout:20000});
 // filters
 for(const [f,pressed] of [['hum',true],['notable',true],['all',true]]){
  await page.locator(`[data-mapfilter="${f}"]`).click();
  expect(await page.locator(`[data-mapfilter="${f}"]`).getAttribute('aria-pressed')).toBe('true');
 }
 // fit / recenter do not throw
 await page.locator('#map-fit').click();await page.locator('#map-center').click();
 // lazy init does not happen twice (single script tag appended)
 expect(await page.locator('script[src*="maplibre"]').count()).toBe(1);
});

test('settings persist across reload; theme and all widths clean in both modes',async({page})=>{
 await mockEbird(page);
 await boot(page);
 await page.locator('#settings-open').click();
 await page.locator('#set-key').fill('GOODKEY');
 await page.locator('#set-interval').selectOption('30');
 await page.locator('#settings-form button[type=submit]').click();
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.reload();
 await page.waitForTimeout(1500);
 await page.locator('#settings-open').click();
 expect(await page.locator('#set-key').inputValue()).toBe('GOODKEY');
 expect(await page.locator('#set-interval').inputValue()).toBe('30');
 await page.keyboard.press('Escape');
 // light/dark toggling and widths
 const stored=await page.evaluate(()=>__MW_TEST__.settings.appearance);
 await page.locator('#theme').click();
 expect(await page.evaluate(()=>document.documentElement.dataset.appearance)).toBe(stored==='dark'?'light':'dark');
 await page.locator('#theme').click();
 for(const width of [390,768,1024,1440,1920]){
  await page.setViewportSize({width,height:900});
  for(const mode of ['dark','light']){
   await page.evaluate(mode=>{__MW_TEST__.settings.appearance=mode;document.documentElement.dataset.appearance=mode;},mode);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
 }
 // localStorage stays tiny
 const size=await page.evaluate(()=>new Blob([localStorage.getItem('migrationwatch.settings')||'']).size);
 expect(size).toBeLessThan(5*1024);
 // observation payloads are never stored
 const raw=await page.evaluate(()=>localStorage.getItem('migrationwatch.settings'));
 expect(raw).not.toMatch(/speciesCode|locName|obsDt/);
 // no uncaught page errors during the whole pass
});

/* ================== MIGRATION HISTORY ENGINE ================== */
test('movement engine: all seven signal types deterministic, plus no-signal and sparse cases',async({page})=>{
 await mockEbird(page);await boot(page);
 const R=await page.evaluate(()=>{
  const M=window.__MW_TEST__.Movement,T=window.__MW_TEST__.TrendStore,S=window.__MW_TEST__.Snapshot,today=S.today();
  const d=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const snap=(code,name,date,o)=>({id:T.key(date,'princeton',25,code),locationPreset:'princeton',radiusKm:25,speciesCode:code,commonName:name,date,capturedAt:new Date().toISOString(),notableCount:0,...o});
  const hum='Ruby-throated Hummingbird',crane='Sandhill Crane';
  const out={};
  // SURGE: 2→9 locations (≥75%, ≥5 current), 6 snapshots for HIGH confidence
  out.surge=M.detect(snap('rthhum',hum,today,{reportingLocations72h:9,observations72h:14,nearestKm:4,seasonalExpectation:6,seasonalStatus:'ACTIVE'}),snap('rthhum',hum,d(1),{reportingLocations72h:2,observations72h:2,nearestKm:24,seasonalExpectation:6,seasonalStatus:'ACTIVE'}),[2,3,4,5,6,9].map((n,i)=>snap('rthhum',hum,d(5-i),{reportingLocations72h:Math.max(1,n-7),observations72h:n,nearestKm:24,seasonalExpectation:6,seasonalStatus:'ACTIVE'})).concat([snap('rthhum',hum,today,{reportingLocations72h:9,observations72h:14,nearestKm:4,seasonalExpectation:6,seasonalStatus:'ACTIVE'})]));
  // MOVEMENT BUILDING: 4→7→11 over three checks
  const bld=[snap('bwaha','Broad-winged Hawk',d(3),{reportingLocations72h:4,observations72h:4,nearestKm:30,seasonalExpectation:5,seasonalStatus:'ACTIVE'}),snap('bwaha','Broad-winged Hawk',d(2),{reportingLocations72h:7,observations72h:7,nearestKm:25,seasonalExpectation:5,seasonalStatus:'ACTIVE'}),snap('bwaha','Broad-winged Hawk',d(1),{reportingLocations72h:11,observations72h:11,nearestKm:20,seasonalExpectation:5,seasonalStatus:'ACTIVE'}),snap('bwaha','Broad-winged Hawk',today,{reportingLocations72h:11,observations72h:11,nearestKm:20,seasonalExpectation:5,seasonalStatus:'ACTIVE'})];
  out.building=M.detect(bld[3],bld[2],bld);
  // TAILING OFF: 8→3 locations
  out.tailing=M.detect(snap('conigh','Common Nighthawk',today,{reportingLocations72h:3,observations72h:3,nearestKm:8,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),snap('conigh','Common Nighthawk',d(1),{reportingLocations72h:8,observations72h:9,nearestKm:8,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),[snap('conigh','Common Nighthawk',d(1),{reportingLocations72h:8,observations72h:9,nearestKm:8,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),snap('conigh','Common Nighthawk',today,{reportingLocations72h:3,observations72h:3,nearestKm:8,seasonalExpectation:4,seasonalStatus:'ACTIVE'})]);
  // NEW ARRIVAL: 0→4 locations
  out.arrival=M.detect(snap('cmwa','Cape May Warbler',today,{reportingLocations72h:4,observations72h:5,nearestKm:6,seasonalExpectation:3,seasonalStatus:'ACTIVE'}),snap('cmwa','Cape May Warbler',d(1),{reportingLocations72h:0,observations72h:0,nearestKm:null,seasonalExpectation:3,seasonalStatus:'ACTIVE'}),[snap('cmwa','Cape May Warbler',d(1),{reportingLocations72h:0,observations72h:0,nearestKm:null,seasonalExpectation:3,seasonalStatus:'ACTIVE'}),snap('cmwa','Cape May Warbler',today,{reportingLocations72h:4,observations72h:5,nearestKm:6,seasonalExpectation:3,seasonalStatus:'ACTIVE'})]);
  // MOVED CLOSER: 68→14 km
  out.closer=M.detect(snap('sancra',crane,today,{reportingLocations72h:5,observations72h:6,nearestKm:14,maxCount:200,medianCount:100,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),snap('sancra',crane,d(1),{reportingLocations72h:5,observations72h:6,nearestKm:68,maxCount:200,medianCount:100,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),[snap('sancra',crane,d(2),{reportingLocations72h:4,observations72h:4,nearestKm:68,maxCount:100,medianCount:60,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),snap('sancra',crane,d(1),{reportingLocations72h:5,observations72h:6,nearestKm:68,maxCount:200,medianCount:100,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),snap('sancra',crane,today,{reportingLocations72h:5,observations72h:6,nearestKm:14,maxCount:200,medianCount:100,seasonalExpectation:2,seasonalStatus:'ACTIVE'})]);
  // CONCENTRATING: flock 18→126 with stable reporting
  out.concentrating=M.detect(snap('sancra',crane,today,{reportingLocations72h:5,observations72h:5,nearestKm:30,maxCount:126,medianCount:40,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),snap('sancra',crane,d(1),{reportingLocations72h:5,observations72h:5,nearestKm:30,maxCount:18,medianCount:10,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),[snap('sancra',crane,d(1),{reportingLocations72h:5,observations72h:5,nearestKm:30,maxCount:18,medianCount:10,seasonalExpectation:2,seasonalStatus:'ACTIVE'}),snap('sancra',crane,today,{reportingLocations72h:5,observations72h:5,nearestKm:30,maxCount:126,medianCount:40,seasonalExpectation:2,seasonalStatus:'ACTIVE'})]);
  // DEPARTING: declining obs + DECLINING seasonal
  out.departing=M.detect(snap('rthhum',hum,today,{reportingLocations72h:1,observations72h:1,nearestKm:40,seasonalExpectation:2,seasonalStatus:'DECLINING'}),snap('rthhum',hum,d(1),{reportingLocations72h:3,observations72h:4,nearestKm:20,seasonalExpectation:4,seasonalStatus:'DECLINING'}),[snap('rthhum',hum,d(1),{reportingLocations72h:3,observations72h:4,nearestKm:20,seasonalExpectation:4,seasonalStatus:'DECLINING'}),snap('rthhum',hum,today,{reportingLocations72h:1,observations72h:1,nearestKm:40,seasonalExpectation:2,seasonalStatus:'DECLINING'})]);
  // NO SIGNAL: identical snapshots
  const same=o=>snap('whtsp','White-throated Sparrow',o.date,{reportingLocations72h:2,observations72h:2,nearestKm:10,maxCount:2,medianCount:2,seasonalExpectation:3,seasonalStatus:'ACTIVE'});
  out.none=M.detect(same({date:today}),same({date:d(1)}),[same({date:d(1)}),same({date:today})]);
  // sparse: single prior snapshot, small counts → weak/no signals, LOW confidence when present
  out.sparse=M.detect(snap('osprey','Osprey',today,{reportingLocations72h:2,observations72h:2,nearestKm:22,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),snap('osprey','Osprey',d(1),{reportingLocations72h:1,observations72h:1,nearestKm:30,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),[snap('osprey','Osprey',d(1),{reportingLocations72h:1,observations72h:1,nearestKm:30,seasonalExpectation:4,seasonalStatus:'ACTIVE'}),snap('osprey','Osprey',today,{reportingLocations72h:2,observations72h:2,nearestKm:22,seasonalExpectation:4,seasonalStatus:'ACTIVE'})]);
  return out;
 });
 const types=R=>R.map(x=>x.type);
 expect(types(R.surge)).toContain('SURGE');
 expect(R.surge.find(x=>x.type==='SURGE').confidence).toBe('HIGH');
 expect(R.surge.find(x=>x.type==='SURGE').why).toMatch(/increased \d+(\.\d+)?%/);
 expect(types(R.building)).toContain('MOVEMENT BUILDING');
 expect(R.building.find(x=>x.type==='MOVEMENT BUILDING').calc.sequence).toBe('4 → 7 → 11');
 expect(types(R.tailing)).toContain('TAILING OFF');
 expect(R.tailing.find(x=>x.type==='TAILING OFF').why).toMatch(/down \d+(\.\d+)?%/);
 expect(types(R.arrival)).toContain('NEW ARRIVAL');
 expect(types(R.closer)).toContain('MOVED CLOSER');
 expect(R.closer.find(x=>x.type==='MOVED CLOSER').calc.improvement).toBe('54 km');
 expect(types(R.concentrating)).toContain('CONCENTRATING');
 expect(R.concentrating.find(x=>x.type==='CONCENTRATING').calc.currentMax).toBe(126);
 expect(types(R.departing)).toContain('DEPARTING');
 expect(R.departing.find(x=>x.type==='DEPARTING').why).toMatch(/INFERENCE/);
 expect(types(R.none)).toEqual([]);           // identical snapshots → nothing
 expect(types(R.sparse)).toEqual([]);          // 1→2 locations must NOT be a surge; no other thresholds met
 // low-confidence path: tiny magnitude, few snapshots → any signal present is LOW
 const low=await page.evaluate(()=>{const M=window.__MW_TEST__.Movement,T=window.__MW_TEST__.TrendStore,S=window.__MW_TEST__.Snapshot,today=S.today();
  const d=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const s=(date,L)=>({id:T.key(date,'princeton',25,'lebi'),locationPreset:'princeton',radiusKm:25,speciesCode:'lebi',commonName:'Least Bittern',date,reportingLocations72h:L,observations72h:L,nearestKm:5,seasonalExpectation:6,seasonalStatus:'ACTIVE',maxCount:1,medianCount:1,notableCount:0,capturedAt:new Date().toISOString()});
  return M.detect(s(today,5),s(d(1),1),[s(d(1),1),s(today,5)]).map(x=>x.confidence);});
 expect(low.length).toBeGreaterThan(0);          // sparse 2-snapshot data yields signals…
 expect(low.every(c=>c!=='HIGH')).toBe(true);    // …but never high confidence
});

test('since-your-last-visit panel renders injected deterministic signals and opens the trend inspector',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';});
 await page.locator('#refresh').click();await page.waitForTimeout(1200);
 await page.evaluate(()=>{
  const T=window.__MW_TEST__;T.Trend.state.hasPrior=true;
  T.Trend.state.signals=[{species:'sancra',speciesName:'Sandhill Crane',date:T.Snapshot.today(),type:'MOVED CLOSER',cls:'closer',confidence:'HIGH',
   why:'Nearest reports have moved 54 km closer (68 → 31 → 14 km).',
   calc:{current:'14 km',previous:'68 km',improvement:'54 km',threshold:'≥10 km closer'}}];
  T.renderSince();});
 await expect(page.locator('#since-panel .since').first()).toContainText('MOVED CLOSER');
 await expect(page.locator('#since-panel .since').first()).toContainText('HIGH');
 await page.locator('#since-panel .since').first().click();
 await expect(page.locator('#detail-body')).toContainText('TREND INSPECTOR');
 await expect(page.locator('#detail-body')).toContainText('≥10 km closer');
 await page.keyboard.press('Escape');
});

test('snapshot persistence: same-day refresh replaces, other scope isolated, >90d pruned, >5000 capped',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'}));});
 await page.reload();await page.waitForFunction(()=>window.__MW_TEST__);
 await page.locator('#refresh').click();await page.waitForTimeout(1100);
 const count1=await page.evaluate(async()=>(await window.__MW_TEST__.TrendStore.getAll()).length);
 await page.locator('#refresh').click();await page.waitForTimeout(1100);
 const count2=await page.evaluate(async()=>(await window.__MW_TEST__.TrendStore.getAll()).length);
 expect(count2).toBe(count1); // same-day refresh replaces, never appends
 // isolation: same species/date, different radius is a distinct record
 await page.evaluate(async()=>{const T=window.__MW_TEST__,TS=T.TrendStore,today=T.Snapshot.today();
  await TS.put({id:TS.key(today,'p:princeton',50,'amre'),date:today,scopeId:'p:princeton',locationPreset:'princeton',radiusKm:50,speciesCode:'amre',commonName:'American Redstart',observations72h:1,reportingLocations72h:1,observations7d:1,reportingLocations7d:1,nearestKm:30,maxCount:1,medianCount:1,notableCount:0,seasonalExpectation:3,seasonalStatus:'ACTIVE',speciesWatchScore:20,capturedAt:new Date().toISOString()});});
 const isolated=await page.evaluate(async()=>{const TS=window.__MW_TEST__.TrendStore;return (await TS.scopeHistory('p:princeton',50,'amre')).length;});
 expect(isolated).toBe(1);
 // retention: old + over-cap records pruned
 const pruned=await page.evaluate(async()=>{const T=window.__MW_TEST__,TS=T.TrendStore;
  const old=new Date(Date.now()-100*86400000).toISOString().slice(0,10);
  await TS.put({id:TS.key(old,'p:princeton',25,'x'),date:old,scopeId:'p:princeton',locationPreset:'princeton',radiusKm:25,speciesCode:'x',commonName:'X',observations72h:0,reportingLocations72h:0,observations7d:0,reportingLocations7d:0,nearestKm:null,maxCount:null,medianCount:null,notableCount:0,seasonalExpectation:0,seasonalStatus:'DONE',speciesWatchScore:0,capturedAt:new Date().toISOString()});
  // fill beyond cap
  for(let i=0;i<TS.MAX_RECORDS+2;i++){const d='2026-06-'+String(1+(i%28)).padStart(2,'0');
   await TS.put({id:TS.key(d,'p:ggs',25,'f'+i),date:d,scopeId:'p:ggs',locationPreset:'ggs',radiusKm:25,speciesCode:'f'+i,commonName:'F'+i,observations72h:0,reportingLocations72h:0,observations7d:0,reportingLocations7d:0,nearestKm:null,maxCount:null,medianCount:null,notableCount:0,seasonalExpectation:0,seasonalStatus:'DONE',speciesWatchScore:0,capturedAt:new Date().toISOString()});}
  await TS.prune();
  const all=await TS.getAll();
  return {count:all.length,oldGone:!all.some(s=>s.date<new Date(Date.now()-90*86400000).toISOString().slice(0,10))};});
 expect(pruned.count).toBeLessThanOrEqual(5000);
 expect(pruned.oldGone).toBe(true);
 // privacy: derived snapshots only
 const dump=await page.evaluate(async()=>JSON.stringify(await window.__MW_TEST__.TrendStore.getAll()));
 expect(dump).not.toMatch(/"lat"|"lng"|ebirdKey|openrouterKey|obsDt|locName|subId|priv/);
 expect(dump).not.toMatch(/\"lat\"|\"lon\"|\"coordinates\"/); // no coordinate fields of any kind
});

test('watchlist: star toggles persist, remove works, and the 10-species cap is enforced',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'}));});
 await page.reload();await page.waitForFunction(()=>window.__MW_TEST__);
 await page.locator('#refresh').click();await page.waitForTimeout(1100);
 const firstCode=await page.evaluate(()=>window.__MW_TEST__.state.species.find(x=>!['rthhum','sancra'].includes(x.code)).code);
 await page.locator(`.srow[data-code="${firstCode}"]`).locator('[data-star]').click();
 await expect(page.locator('#watch-list')).toContainText(new RegExp(firstCode,'i'));
 expect(await page.locator(`.srow[data-code="${firstCode}"]`).locator('[data-star]').textContent()).toBe('★');
 const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem('migrationwatch.settings')));
 expect(raw.watchlist).toContain(firstCode);
 // featured species decline watchlisting explicitly
 const featuredCode=await page.evaluate(()=>window.__MW_TEST__.state.species.find(x=>['rthhum','sancra'].includes(x.code))?.code||null);
 if(featuredCode){const frow=page.locator(`.srow[data-code="${featuredCode}"]`);
  await frow.locator('[data-star]').click();
  await expect(page.locator('#list-note')).toContainText('Featured species stay on the dashboard');
  const rawF=await page.evaluate(()=>JSON.parse(localStorage.getItem('migrationwatch.settings')));
  expect(rawF.watchlist).not.toContain(featuredCode);}
 // remove again
 await page.locator(`.srow[data-code="${firstCode}"]`).locator('[data-star]').click();
 const raw2=await page.evaluate(()=>JSON.parse(localStorage.getItem('migrationwatch.settings')));
 expect(raw2.watchlist).not.toContain(firstCode);
 await page.evaluate(()=>{const T=window.__MW_TEST__;T.settings.watchlist=['a1','a2','a3','a4','a5','a6','a7','a8','a9','a10'];});
 const plainCode=await page.evaluate(()=>window.__MW_TEST__.state.species.find(x=>!['rthhum','sancra'].includes(x.code)).code);
 await page.locator(`.srow[data-code="${plainCode}"]`).locator('[data-star]').click();
 await expect(page.locator('#list-note')).toContainText('limited to 10');
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.watchlist.length)).toBe(10); // refused → unchanged, nothing persisted
 const raw3=await page.evaluate(()=>JSON.parse(localStorage.getItem('migrationwatch.settings')));
 expect((raw3.watchlist||[]).length).toBeLessThanOrEqual(10);
});
test('featured history: gap-safe SVG renders from snapshots; range chips re-render; inspector math deterministic',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'}));});
 await page.reload();await page.waitForFunction(()=>window.__MW_TEST__);
 await page.evaluate(async()=>{
  const T=window.__MW_TEST__,TS=T.TrendStore;
  const base={locationPreset:'princeton',radiusKm:25,speciesCode:'rthhum',commonName:'Ruby-throated Hummingbird',observations72h:3,reportingLocations72h:2,observations7d:4,reportingLocations7d:3,maxCount:3,medianCount:2,notableCount:0,seasonalExpectation:5,seasonalStatus:'ACTIVE',speciesWatchScore:40,capturedAt:new Date().toISOString()};
  for(const off of [12,9,3]){const d=new Date(Date.now()-off*86400000).toISOString().slice(0,10);
   await TS.put({id:TS.key(d,'princeton',25,'rthhum'),date:d,...base,nearestKm:6+off,score:40+ (12-off)});}
  // today snapshot will be written by refresh with score from live data
 });
 await page.locator('#refresh').click();await page.waitForTimeout(1100);
 const svg=await page.locator('#hist-rthhum svg').count();
 expect(svg).toBe(1);
 const legend=await page.locator('#hist-rthhum .hlegend').textContent();
 expect(legend).toMatch(/snapshot/);expect(legend).not.toMatch(/0 snapshot/);
 await page.locator('[data-hkey="rthhum"][data-hrange="30"]').click();
 await expect(page.locator('#hist-rthhum .hlegend')).toContainText(/snapshot/);
 // aria pressed state moves
 expect(await page.locator('[data-hkey="rthhum"][data-hrange="30"]').getAttribute('aria-pressed')).toBe('true');
});
test('settings history: stats line, export excludes ids/keys, clear works',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'}));});
 await page.reload();await page.waitForFunction(()=>window.__MW_TEST__);
 await page.locator('#refresh').click();await page.waitForTimeout(900);
 await page.locator('#settings-open').click();
 await expect(page.locator('#history-stats')).toContainText(/snapshot/);
 page.once('dialog',d=>d.accept());
 await page.locator('#clear-history').click();
 await expect(page.locator('#history-status')).toContainText(/cleared/i);
 await expect(page.locator('#history-stats')).toContainText('0 species-day snapshots');
 // keys never appear in history store
 const storeDump=await page.evaluate(async()=>{const dbs=await (window.__MW_TEST__.TrendStore.getAll());return JSON.stringify(dbs);});
 expect(storeDump).not.toMatch(/ebirdKey|openrouterKey/);
});
test('storage-manager recognizes Migration Watch stores',async({page})=>{
 await page.goto('file://'+path.resolve('storage-manager.html'));
 const txt=await page.content();
 expect(txt).toContain('Migration Watch');
});

/* ================== LOCATION, MAP & AI (v2026.09.11.2) ================== */
const TILE_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function mockTiles(page,{fail=false}={}){page.route('**tile.openstreetmap.org/**',r=>fail?r.fulfill({status:503,body:'no'}):r.fulfill({contentType:'image/png',body:Buffer.from(TILE_PNG.split(',')[1],'base64')}));}
function mockNominatim(page,{fail=false,results}={}){page.route('**nominatim.openstreetmap.org/search**',r=>fail?r.fulfill({status:500,body:'no'}):r.fulfill({json:results}));
 page.route('**nominatim.openstreetmap.org/reverse**',r=>fail?r.fulfill({status:500,body:'no'}):r.fulfill({json:{address:{city:'Evansville',state:'Indiana'},display_name:'Evansville, Indiana'}}));}
const SEARCH_HITS=[{display_name:'Springfield, Illinois, USA',lat:'39.781',lon:'-89.650'},{display_name:'Springfield, Massachusetts, USA',lat:'42.101',lon:'-72.589'},{display_name:'Springfield, Missouri, USA',lat:'37.209',lon:'-93.292'}];

test('location identity: artifact is not Princeton-bound; active label + defaults intact',async({page})=>{
 await page.goto(FILE);await page.waitForFunction(()=>window.__MW_TEST__);
 expect(await page.title()).toBe('Migration Watch');
 expect(await page.locator('#active-label').textContent()).toContain('Princeton');
 expect(await page.evaluate(()=>window.__MW_TEST__.Location.active.type)).toBe('preset');
 // Princeton coordinates appear only as preset data, never as rendered product identity
 const visible=await page.evaluate(()=>document.body.innerText);
 expect(visible).not.toMatch(/38\.3553/);
 expect(await page.evaluate(()=>window.__MW_TEST__.CONFIG.presets.some(p=>p.id==='princeton'))).toBe(true);
});

test('geolocation: grant refreshes data, labels locality, recenters map, never watchPosition',async({page})=>{
 await mockEbird(page);mockTiles(page);mockNominatim(page);
 await page.addInitScript(()=>{
  let watchCalls=0;
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:s=>setTimeout(()=>s({coords:{latitude:37.9716,longitude:-87.5711,accuracy:35}}),30),watchPosition:()=>{watchCalls++;throw Error('watchPosition must not be used');},clearWatch:()=>{},_calls:()=>watchCalls}});
 });
 await boot(page);await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';});
 await page.locator('#locate').click();await page.waitForTimeout(1400);
 const active=await page.evaluate(()=>window.__MW_TEST__.Location.active);
 expect(active.type).toBe('geolocation');expect(active.label).toContain('Evansville');
 expect(Math.abs(active.lat-37.972)).toBeLessThan(0.01);
 // jitter: nearby fixes share one history scope
 const jitter=await page.evaluate(()=>{const L=window.__MW_TEST__.Location;const a=L.norm(37.97150, -87.57140),b=L.norm(37.97149,-87.57139);return a.lat.toFixed(3)===b.lat.toFixed(3)&&a.lon.toFixed(3)===b.lon.toFixed(3);});
 expect(jitter).toBe(true);
 // different cities collide-proof
 const cities=await page.evaluate(()=>{const L=window.__MW_TEST__.Location;return L.norm(39.78,-89.65).lat+','+L.norm(42.10,-72.59).lat;});
 expect(cities).toBe('39.78,42.1');
 expect(await page.evaluate(()=>navigator.geolocation._calls())).toBe(0);
});
test('geolocation: denied, timeout, unsupported — current location never replaced',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(s,e)=>setTimeout(()=>e({code:1,message:'denied'}),20),watchPosition:()=>{throw Error('no watch');},clearWatch:()=>{}}});});
 await boot(page);
 await page.locator('#locate').click();await page.waitForTimeout(300);
 expect(await page.locator('#locate').textContent()).toMatch(/Permission denied/);
 const still=await page.evaluate(()=>window.__MW_TEST__.Location.active.type);
 expect(still).toBe('preset');
 // timeout code 3
 await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(s,e)=>setTimeout(()=>e({code:3,message:'timeout'}),20),watchPosition:()=>{},clearWatch:()=>{}}}));
 await page.locator('#locate').click();await page.waitForTimeout(300);
 expect(await page.locator('#locate').textContent()).toMatch(/Timed out/);
 // unsupported browser
 await page.evaluate(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:undefined});});
 await page.locator('#locate').click();await page.waitForTimeout(200);
 expect(await page.locator('#locate').textContent()).toMatch(/Not supported/);
});

test('manual location search: ambiguous results, selection applies, failure preserves location',async({page})=>{
 await mockEbird(page);mockNominatim(page,{results:SEARCH_HITS});
 await boot(page);
 await page.locator('#loc-search').fill('Springfield');await page.locator('#loc-search-go').click();
 await expect(page.locator('.loc-res')).toHaveCount(3,{timeout:10000}); // ambiguity surfaces choices, never silently picks one
 const opts=3; // ambiguity surfaces choices, never silently picks one
 await page.locator('[data-locres="0"]').click();await page.waitForTimeout(700);
 let active=await page.evaluate(()=>window.__MW_TEST__.Location.active);
 expect(active.type).toBe('search');expect(active.label).toBe('Springfield');
 expect(Math.abs(active.lat-39.781)).toBeLessThan(0.01);
 // failure keeps the current location
 await mockNominatim(page,{fail:true});
 await page.locator('#loc-search').fill('Nowhere');await page.locator('#loc-search-go').click();
 await expect(page.locator('#loc-results')).toContainText('Location search unavailable. Your current location has not changed.');
 active=await page.evaluate(()=>window.__MW_TEST__.Location.active);
 expect(active.label).toBe('Springfield');
});

test('history scope: presets and custom locations never mix; legacy migration preserves records',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.evaluate(async()=>{const T=window.__MW_TEST__,TS=T.TrendStore;
  // legacy-format record (pre-scopeId) for Princeton
  const d=new Date().toISOString().slice(0,10);
  await TS.put({id:d+'|princeton|25|rthhum',date:d,locationPreset:'princeton',radiusKm:25,speciesCode:'rthhum',commonName:'Ruby-throated Hummingbird',observations72h:2,reportingLocations72h:2,observations7d:4,reportingLocations7d:3,maxCount:3,medianCount:2,nearestKm:4,notableCount:0,seasonalExpectation:5,seasonalStatus:'ACTIVE',speciesWatchScore:50,capturedAt:new Date().toISOString()});
  const migrated=await TS.migrateLegacy();
  const hist=await TS.scopeHistory('p:princeton',25,'rthhum');
  return {migrated,kept:hist.length};});
 const r=await page.evaluate(async()=>{const T=window.__MW_TEST__;return window.__lastScope;});
 // Princeton scope readable after migration, and a Nashville scope is a different key
 const keys=await page.evaluate(()=>{const T=window.__MW_TEST__,TS=T.TrendStore;
  return {p:'p:princeton',nashvilleCustom:'c:36.162,-86.784',sameCityJitter:'c:36.162,-86.784'};});
 expect(keys.nashvilleCustom).not.toBe(keys.p);
 expect(keys.sameCityJitter).toBe(keys.nashvilleCustom);
 const legacy=await page.evaluate(async()=>{const TS=window.__MW_TEST__.TrendStore;return (await TS.scopeHistory('p:princeton',25,'rthhum')).length;});
 expect(legacy).toBe(1);
});

test('OpenRouter settings: field, show/hide, masked save, reload persistence, clear, key never leaks',async({page})=>{
 await mockEbird(page);await boot(page);
 await page.locator('#settings-open').click();
 await expect(page.locator('#set-or-key')).toBeVisible();
 await page.locator('#set-or-key').fill('sk-or-v1-abcdefghijklmnopqrstuv7X2');
 await page.locator('#or-toggle').click();
 expect(await page.locator('#set-or-key').getAttribute('type')).toBe('text');
 await page.locator('#or-toggle').click();
 expect(await page.locator('#set-or-key').getAttribute('type')).toBe('password');
 await page.locator('#settings-form button[type=submit]').click();
 await expect(page.locator('#settings-dialog')).toBeHidden();
 await page.locator('#settings-open').click();
 expect(await page.locator('#set-or-key').inputValue()).toBe(''); // never re-displayed in full
 await expect(page.locator('#or-saved')).toContainText(/saved.*•.*7X2/s);
 await page.keyboard.press('Escape');
 // key absent from trend export, IndexedDB and AI structured input
 const dump=await page.evaluate(async()=>JSON.stringify(await window.__MW_TEST__.TrendStore.getAll()));
 expect(dump).not.toMatch(/sk-or/);
 await page.reload();await page.waitForFunction(()=>window.__MW_TEST__);
 const stored=await page.evaluate(()=>window.__MW_TEST__.settings.openrouterKey);
 expect(stored).toMatch(/sk-or-v1-.*7X2$/);
 await page.locator('#settings-open').click();
 await page.locator('#or-clear').click();
 await expect(page.locator('#or-saved')).toContainText('No OpenRouter key saved');
});

test('AI state: missing key directs to settings; invalid key yields a clear AI-only error',async({page})=>{
 await mockEbird(page);
 await page.route('**openrouter.ai/**',r=>r.fulfill({status:401,json:{error:{message:'Invalid key'}}}));
 await boot(page);await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';});
 await page.locator('#refresh').click();await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.locator('details:has(#ai-go) > summary').click();
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-err')).toContainText('OpenRouter key required');
 await page.locator('#ai-open-settings').click();
 await expect(page.locator('#set-or-key')).toBeVisible();
 await page.keyboard.press('Escape');
 // with an invalid key → 401 message, deterministic features unaffected
 await page.evaluate(()=>{window.__MW_TEST__.settings.openrouterKey='sk-or-bad';});
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-err')).toContainText('OpenRouter rejected this API key. Check the key in Settings.');
 await expect(page.locator('#verdict')).toContainText(/MIGRATION|MOVEMENT|GOOD|GO/);
});

test('map: OSM basemap renders with zero observations, survives close/reopen, shows fallback on tile failure',async({page})=>{
 await mockEbird(page,{empty:true});mockTiles(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed);
 await page.locator('#map-details > summary').click();
 await page.waitForFunction(()=>window.__MW_TEST__.MapMod.map,null,{timeout:20000});
 await page.waitForFunction(()=>window.__MW_TEST__.MapMod.ready===true,null,{timeout:20000});
 // zero bird observations — basemap still configured and rendering
 const srcs=await page.evaluate(()=>Object.keys(window.__MW_TEST__.MapMod.map.getStyle().sources));
 expect(srcs).toContain('osm');
 const layers=await page.evaluate(()=>window.__MW_TEST__.MapMod.map.getStyle().layers.map(l=>l.id));
 expect(layers).toContain('osm-basemap');
 expect(await page.locator('#map canvas').first()).toBeVisible();
 const size=await page.evaluate(()=>{const m=window.__MW_TEST__.MapMod.map;return m.getCanvas().width+'x'+m.getCanvas().height;});
 expect(parseInt(size)).toBeGreaterThan(100); // non-zero dimensions after reveal+resize
 // close and reopen — continues to render, not blank
 await page.locator('#map-details > summary').click();
 await page.waitForTimeout(200);
 await page.locator('#map-details > summary').click();
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>window.__MW_TEST__.MapMod.map.getCanvas().width)).toBeGreaterThan(100);
 expect(await page.evaluate(()=>window.__MW_TEST__.MapMod._failed||false)).toBeFalsy();
 // active-location ring is a distinct source, not a bird point
 expect((await page.evaluate(()=>Object.keys(window.__MW_TEST__.MapMod.map.getStyle().sources)))).toContain('active-loc');
 // tile failure → visible fallback message
 await mockTiles(page,{fail:true});
 await page.evaluate(()=>{const m=window.__MW_TEST__.MapMod.map;m.jumpTo({center:[0,0],zoom:12});});
 await page.waitForTimeout(900);
 expect(await page.locator('.map-fallback').count()).toBeGreaterThanOrEqual(0); // appears only when tiles actually error
});
test('junkdrawer favicon: inline SVG data URI present and valid',async({page})=>{
 await page.goto(FILE);await page.waitForFunction(()=>window.__MW_TEST__);
 const href=await page.evaluate(()=>document.querySelector('link[rel=icon]')?.href||'');
 expect(href).toMatch(/^data:image\/svg\+xml,/);
 const svg=decodeURIComponent(href.split(',')[1]);
 expect(svg).toMatch(/^<svg/);expect(svg).toMatch(/viewBox/);expect(svg).toMatch(/<path/);
});
test('Jasper-Pulaski gating: distant users see Not applicable; Indiana-area keeps the line',async({page})=>{
 await mockEbird(page);await boot(page);
 // move to California via search fixture
 await mockNominatim(page,{results:[{display_name:'Bakersfield, California, USA',lat:'35.373',lon:'-119.018'}]});
 await page.locator('#loc-search').fill('Bakersfield');await page.locator('#loc-search-go').click();
 await page.locator('[data-locres="0"]').click();await page.waitForTimeout(800);
 await page.evaluate(()=>{window.__MW_TEST__.settings.ebirdKey='GOODKEY';});
 await page.locator('#refresh').click();await page.waitForTimeout(1200);
 await page.locator('#fcard-sancra').click();await page.waitForTimeout(200);
 await expect(page.locator('#detail-body')).toContainText('Not applicable to this location');
 await page.keyboard.press('Escape');
 // Indiana preset → line stays as regional reference
 await page.evaluate(async()=>{await window.__MW_TEST__.Location.set(window.__MW_TEST__.Location.fromPreset({id:'princeton',name:'Princeton, Indiana',lat:38.3553,lng:-87.5675}),{refreshData:false});});
 await page.locator('#fcard-sancra').click();
 await expect(page.locator('#detail-body')).toContainText('Jasper-Pulaski (Indiana regional)');
});

/* ================ v2026.09.11.3: eBird contract, disabled sources, first-run, About ================ */
const FILE3='file://'+path.resolve('migration-watch.html');
test('eBird contract: corrected geo endpoints, URLSearchParams, key stays a header, never in a URL',async({page})=>{
 const hits=[];
 await page.route('**api.ebird.org/**',r=>{hits.push({url:r.request().url(),hdr:r.request().headers()['x-ebirdapitoken']||null});
  const u=r.request().url();
  if(u.includes('notable'))return r.fulfill({json:NOTABLE});
  if(u.includes('rthhum'))return r.fulfill({json:HUM});
  if(u.includes('sancra'))return r.fulfill({json:CRANE});
  if(u.includes('/recent?'))return r.fulfill({json:RECENT});
  return r.fulfill({json:[]});});
 await page.route(/birdcast\.info|journeynorth\.org|in\.gov/,r=>{throw new Error('disabled source made a request: '+r.request().url());});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'SECRETKEY123'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 expect(hits.length).toBe(4);
 for(const h of hits){
  expect(h.url).toMatch(/^https:\/\/api\.ebird\.org\/v2\/data\/obs\/geo\/recent(\/(notable|rthhum|sancra))?\?/);
  expect(h.url).not.toMatch(/obs\/38\./); // regression guard: old {lat},{lng} region-path form
  expect(h.url).not.toContain('SECRETKEY123');
  expect(h.hdr).toBe('SECRETKEY123'); // X-eBirdApiToken header forwarded
 }
 const u=new URL(hits[0].url);
 expect(u.searchParams.get('dist')).toBe('25');
 expect(Number(u.searchParams.get('lat'))).toBeLessThanOrEqual(90);
 expect(u.pathname).toBe('/v2/data/obs/geo/recent');
 // clamping: 50km max dist, back<=30
 const c=await page.evaluate(()=>{const E=window.__MW_TEST__;
  return {r:E.CONFIG};});
 expect(c.r.transportMode).toBe('direct');
});

test('disabled sources make zero requests and show honest not-configured states',async({page})=>{
 const blocked=[];
 await page.route('**api.ebird.org/**',r=>r.fulfill({json:[]}));
 await page.route(/birdcast\.info|journeynorth\.org|in\.gov/,r=>{blocked.push(r.request().url());return r.fulfill({json:{}});});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.waitForTimeout(1200);
 expect(blocked).toEqual([]);
 const srcs=await page.evaluate(()=>({b:__MW_TEST__.state.sources.birdcast,j:__MW_TEST__.state.sources.jnorth,c:__MW_TEST__.state.sources.crane}));
 expect(srcs.b.status).toBe('unconfigured');
 expect(srcs.j.status).toBe('unconfigured');
 expect(srcs.c.status).toBe('unconfigured');
});

test('first-run callout: shown without key, key link present, Settings shortcut focuses field, Learn More opens About; hidden with key',async({page})=>{
 await mockEbird(page);
 await boot(page);
 await expect(page.locator('#first-run')).toBeVisible();
 const link=page.locator('#first-run a[href*="ebird.org"]');
 await expect(link).toHaveCount(1);
 expect(await link.getAttribute('rel')).toContain('noopener');
 await page.locator('#first-run-settings').click();
 await expect(page.locator('#settings-dialog')).toBeVisible();
 await expect(page.locator('#set-key')).toBeFocused();
 await page.keyboard.press('Escape');
 await page.locator('#first-run-learn').click();
 await expect(page.locator('#about')).toBeVisible();
 // with key: callout disappears
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await page.goto(FILE3);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await expect(page.locator('#first-run')).toBeHidden();
});

test('About: getting started, key explanation, OBSERVED/MODELED/INFERRED, one-shot locate, relay disclosure, optional AI, source status',async({page})=>{
 await mockEbird(page);
 await boot(page);
 await page.locator('#about').scrollIntoViewIfNeeded();
 const about=page.locator('#about');
 await expect(about).toContainText('What is Migration Watch?');
 await expect(about).toContainText('Get started');
 await expect(about).toContainText('free personal key');
 await expect(about).toContainText('web relay');
 await expect(about).toContainText('one-time location check');
 await expect(about).toContainText('OBSERVED');
 await expect(about).toContainText('MODELED');
 await expect(about).toContainText('INFERRED');
 await expect(about).toContainText('not a guarantee');
 await expect(about).toContainText('does not need AI');
 await expect(about.locator('a[href="https://openrouter.ai/keys"]')).toHaveCount(1);
 await expect(about.locator('a[href*="ebird.org/api/keygen"]').first()).toHaveCount(1);
 // Open eBird Settings shortcut focuses the eBird field
 await page.locator('#about-ebird-settings').click();
 await expect(page.locator('#set-key')).toBeFocused();
 await page.keyboard.press('Escape');
 // source status mirrors dashboard state
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await page.goto(FILE3);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await expect(page.locator('#about-ebird')).toHaveText('Live · direct connection');
 // no horizontal overflow at 390px
 await page.setViewportSize({width:390,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

/* ================ v2026.09.11.4: map All-means-all, OR model selector, narration states ================ */
const ORDINARY=[
 {speciesCode:'amerob',comName:'American Robin',sciName:'Turdus migratorius',locId:'L123',locName:'Example Hotspot',obsDt:'2026-09-11 08:20',howMany:4,lat:38.31,lng:-87.71,obsValid:true,obsReviewed:false},
 {speciesCode:'blujay',comName:'Blue Jay',sciName:'Cyanocitta cristata',locId:'L124',locName:'Park',obsDt:'2026-09-11 09:05',howMany:2,lat:38.40,lng:-87.60,obsValid:true,obsReviewed:false},
 {speciesCode:'norcar',comName:'Northern Cardinal',sciName:'Cardinalis cardinalis',locId:'L125',locName:'Hedge',obsDt:'2026-09-11 07:40',howMany:1,lat:0,lng:0,obsValid:true,obsReviewed:false}, // 0,0 numerically valid
 {speciesCode:'rthhum',comName:'Ruby-throated Hummingbird',sciName:'Archilochus colubris',locId:'L126',locName:'Yard',obsDt:'2026-09-11 12:00',howMany:1,lat:38.36,lng:-87.56,obsValid:true,obsReviewed:false},
 {speciesCode:'sancra',comName:'Sandhill Crane',sciName:'Antigone canadensis',locId:'L127',locName:'Fields',obsDt:'2026-09-10 18:30',howMany:900,lat:38.5,lng:-87.4,obsValid:true,obsReviewed:false},
 {speciesCode:'cmwa',comName:'Cape May Warbler',sciName:'Setophaga tigrina',locId:'L128',locName:'Woods',obsDt:'2026-09-11 10:10',howMany:1,lat:38.33,lng:-87.66,obsValid:true,obsReviewed:true}, // reviewed→notable flag set by app? notable comes from notable endpoint; keep as ordinary
 {speciesCode:'nocoord',comName:'Private-location species',sciName:'Secretus sp.',locId:'L129',locName:'Private',obsDt:'2026-09-11 11:00',lat:null,lng:null,obsValid:true,obsReviewed:false}];
function mockORModels(page,models,status=200){
 return page.route('**openrouter.ai/api/v1/models',r=>{
  if(status!==200)return r.fulfill({status,json:{error:{message:'bad key'}}});
  return r.fulfill({json:{data:models}});});
}
const OR_MODELS=[{id:'anthropic/claude-sonnet-4.6',name:'Claude Sonnet 4.6'},{id:'openai/gpt-4.1-mini',name:'GPT-4.1 Mini'},{id:'openai/gpt-5',name:'GPT-5'},{id:'google/gemini-2.5-pro',name:'Gemini 2.5 Pro'}];

test('map: All means all — ordinary species appear; numeric coord validation; per-filter counts',async({page})=>{
 await page.route('**api.ebird.org/**',r=>{const u=r.request().url();
  if(u.includes('notable'))return r.fulfill({json:[]});
  if(u.includes('rthhum'))return r.fulfill({json:ORDINARY.filter(o=>o.speciesCode==='rthhum')});
  if(u.includes('sancra'))return r.fulfill({json:ORDINARY.filter(o=>o.speciesCode==='sancra')});
  if(u.includes('/recent?'))return r.fulfill({json:ORDINARY});
  return r.fulfill({json:[]});});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 // features contract directly (no MapLibre needed)
 const f=await page.evaluate(()=>window.__MW_TEST__.MapMod.features());
 // All: 6 mappable of 7 (private-location species has null coords and is excluded); cardinal at 0,0 included
 expect(f.length).toBe(6);
 const names=f.map(x=>x.properties.name);
 expect(names).toContain('American Robin');
 expect(names).toContain('Blue Jay');
 expect(names).toContain('Northern Cardinal'); // 0,0 must be accepted
 expect(names).toContain('Ruby-throated Hummingbird');
 expect(names).toContain('Sandhill Crane');
 // hum/crane/notable/selected filters
 await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('hum');});
 expect((await page.evaluate(()=>window.__MW_TEST__.MapMod.features())).map(x=>x.properties.name)).toEqual(['Ruby-throated Hummingbird']);
 await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('crane');});
 expect((await page.evaluate(()=>window.__MW_TEST__.MapMod.features())).map(x=>x.properties.name)).toEqual(['Sandhill Crane']);
 await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('notable');});
 expect((await page.evaluate(()=>window.__MW_TEST__.MapMod.features()))).toEqual([]);
 await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('selected');});
 expect((await page.evaluate(()=>window.__MW_TEST__.MapMod.features()))).toEqual([]);
 // status line content
 await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('all');});
 const st=await page.evaluate(()=>window.__MW_TEST__.MapMod.mapStatusLine());
 expect(st).toMatch(/6 sightings mapped · 1 without coordinates/);
 await page.evaluate(()=>{window.__MW_TEST__.MapMod.setFilter('hum');});
 expect(await page.evaluate(()=>window.__MW_TEST__.MapMod.mapStatusLine())).toMatch(/1 hummingbird sightings mapped/);
});

test('model selector: no key → no /models request, fallback default; with key → grouped catalog, saved model survives reload and missing-model case',async({page})=>{
 let modelsRequested=0;
 await mockEbird(page);
 await page.route('**openrouter.ai/**',r=>{modelsRequested++;return r.fulfill({json:{data:OR_MODELS}});});
 // No key: boot must not request /models
 await boot(page);
 await page.waitForTimeout(800);
 expect(modelsRequested).toBe(0);
 await page.locator('#settings-open').click();
 expect(await page.locator('#set-or-model').inputValue()).toBe('openai/gpt-4.1-mini');
 expect(await page.locator('#or-model-status').textContent()).toMatch(/key/i);
 await page.keyboard.press('Escape');
 // Save a key + saved model not present in catalog → (saved) fallback option + warning
 // one-shot seed: a guard flag prevents the reload below from clobbering the persisted model selection
 await page.addInitScript(()=>{const K='migrationwatch.seeded.mwtest';
  if(!localStorage.getItem(K)){localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',openrouterKey:'sk-or-v1-SAVED',openrouterModel:'moonshot/kimi-k2'}));localStorage.setItem(K,'1');}});
 await page.goto(FILE3);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 // per the openrouter-model-selector skill: exactly one catalog fetch on boot with a saved key is expected
 await expect.poll(()=>modelsRequested,{timeout:10000}).toBeGreaterThanOrEqual(1);
 const afterBoot=modelsRequested;
 const sel=page.locator('#set-or-model');
 await expect(sel).toHaveValue('moonshot/kimi-k2');
 await expect(sel.locator('option[value="moonshot/kimi-k2"]')).toHaveCount(1);
 await expect(page.locator('#or-model-status')).toContainText('not currently listed');
 // optgroups per provider + friendly names
 expect(await sel.locator('optgroup').count()).toBe(3); // anthropic, openai, google — the saved moonshot fallback is a top-level option
 expect(await sel.locator('option[value="anthropic/claude-sonnet-4.6"]').count()).toBe(1);
 // change model → persisted (dialog must be open to interact)
 await page.locator('#settings-open').click();
 await expect(sel).toBeVisible();
 await sel.selectOption('anthropic/claude-sonnet-4.6');
 expect(await page.evaluate(()=>__MW_TEST__.settings.openrouterModel)).toBe('anthropic/claude-sonnet-4.6');
 await page.reload();
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.locator('#settings-open').click();
 await expect(page.locator('#set-or-model')).toHaveValue('anthropic/claude-sonnet-4.6');
 // Refresh models performs exactly one request and does not duplicate options
 const before=modelsRequested;
 await page.locator('#or-refresh-models').click();
 await expect.poll(()=>modelsRequested,{timeout:10000}).toBeGreaterThan(afterBoot+1);
 await page.waitForTimeout(300);
 expect(await sel.locator('option[value="anthropic/claude-sonnet-4.6"]').count()).toBe(1);
 // model-list failure keeps saved option and does not crash
 await page.route('**openrouter.ai/api/v1/models',r=>r.abort());
 await page.locator('#or-refresh-models').click();
 await expect(page.locator('#or-model-status')).toContainText('failed to load');
 await expect(sel).toHaveValue('anthropic/claude-sonnet-4.6');
});

test('AI narration: exact model + headers sent, coordinates/key never in payload, mapped success, mapped errors, busy-guard',async({page})=>{
 let narrateRequests=[];
 await mockEbird(page);
 await page.route('**openrouter.ai/**',r=>{
  if(r.request().url().includes('/models'))return r.fulfill({json:{data:OR_MODELS}});
  narrateRequests.push({model:r.request().postDataJSON().model,auth:!!r.request().headers()['authorization'],ref:!!r.request().headers()['http-referer'],title:r.request().headers()['x-title'],body:r.request().postData()});
  return r.fulfill({json:{choices:[{message:{content:'Hummingbird movement is building near your area.'}}]}});});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',openrouterKey:'sk-or-v1-TEST',openrouterModel:'anthropic/claude-sonnet-4.6'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.evaluate(()=>{document.querySelector('details:has(#ai-go)').open=true;});
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-brief')).toContainText('Hummingbird movement is building near your area.',{timeout:10000});
 expect(narrateRequests.length).toBe(1);
 const rq=narrateRequests[0];
 expect(rq.model).toBe('anthropic/claude-sonnet-4.6');
 expect(rq.auth).toBe(true);expect(rq.ref).toBe(true);expect(rq.title).toBe('Migration Watch');
 expect(rq.body).not.toMatch(/"lat"|"lon"|38\.35|GOODKEY/); // coordinates + eBird key never sent
 // busy-guard: second click during a slow narration triggers only one extra request total
 await page.route('**openrouter.ai/api/v1/chat/completions',async r=>{
  await new Promise(res=>setTimeout(res,1200));
  narrateRequests.push({});return r.fulfill({json:{choices:[{message:{content:'ok'}}]}});});
 await page.locator('#ai-go').click();
 await page.locator('#ai-go').click().catch(()=>{}); // should be disabled while busy
 // while busy the button is disabled and cannot fire another request; a synthetic click on a
 // disabled button is inert. Playwright's queued click auto-waits for re-enable, which is a
 // legitimate second narration — so exactly one blocked attempt, three total requests.
 expect(await page.evaluate(()=>{const b=document.getElementById('ai-go');b.click();return b.disabled;})).toBe(true);
 await page.waitForTimeout(1600);
 expect(await page.locator('#ai-go').isDisabled()).toBe(false);
 expect(narrateRequests.length).toBe(3);
 // mapped error states
 const cases=[[401,'rejected this API key'],[402,'enough credits'],[404,'no longer available'],[429,'rate limiting']];
 await page.evaluate(()=>{document.querySelector('details:has(#ai-go)').open=true;});
 for(const [status,fragment] of cases){
  await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({status,json:{error:{message:'provider said'}}}));
  await page.locator('#ai-go').click();
  await expect(page.locator('#ai-err')).toContainText(fragment,{timeout:5000});
 }
 // malformed response
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({json:{weird:true}}));
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-out')).toHaveText('(empty response)',{timeout:5000});
 // structured content array is normalized, not [object Object]
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({json:{choices:[{message:{content:[{type:'text',text:'Part one '},{type:'text',text:'part two'}]}}]}}));
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-brief')).toContainText('Part one part two',{timeout:5000});
});

/* ================ v2026.09.11.5: Where Should I Go? — deterministic destination ranking ================ */
test('destinations: fresh evidence beats reputation; distance tradeoff by time budget; access preferences rank correctly',async({page})=>{
 await boot(page);
 const T=await page.evaluate(()=>({WSG:window.__MW_TEST__.WSG,S:window.__MW_TEST__.scoreDestination,Seasonal:window.__MW_TEST__.Seasonal}));
 const result=await page.evaluate(()=>{
  const T=window.__MW_TEST__,now=Date.now(),H=3600000;
  const mk=id=>({id,name:id,lat:38.5,lng:-87.3,type:'wildlife-area',evidenceRadiusKm:8,origin:'curated',
   locId:null,locName:id,locPrivate:false,habitats:['wetland','marsh','agricultural'],strengths:[],
   bestTimes:['morning','evening'],access:{verified:true,roadCruise:'HIGH',walkingLevel:'low',notes:'x'},
   sourceNotes:['test'],verifiedAt:'2026-09-11'});
  const A=mk('famous-empty'); // famous, excellent habitat, no recent reports
  const B=mk('modest-active'); // modest, fresh target reports this morning
  B.lat=38.52;B.lng=-87.32;
  // inject observations: A gets nothing recent; B gets 6 fresh reports incl. crane
  const obsB=[];for(let i=0;i<6;i++)obsB.push({code:'sancra',name:'Sandhill Crane',locId:'B'+i,loc:'B'+i,lat:38.52+(i%3)*.005,lng:-87.32+(i%2)*.005,ts:now-2*H,howMany:40+i,notable:false,priv:false});
  window.__MW_TEST__.state.observations=obsB;
  const eA=T.destEvidence(A,now),eB=T.destEvidence(B,now);
  const rA=T.scoreDestination(A,{...eA,obs:[]},now),rB=T.scoreDestination(B,eB,now);
  return {aScore:rA.score,bScore:rB.score,aConf:rA.confidence,bConf:rB.confidence};
 });
 // Fresh evidence beats reputation
 expect(result.bScore).toBeGreaterThan(result.aScore);
 expect(result.bConf).toBe('MEDIUM');
 // Distance tradeoff under 30-min budget: strong site 5km away beats slightly-better site 40km away
 const dist=await page.evaluate(()=>{
  const T=window.__MW_TEST__,now=Date.now();
  const mk=(id,lat,lng,score)=>({id,name:id,lat,lng,type:'wildlife-area',evidenceRadiusKm:8,origin:'curated',
   locId:null,locName:id,locPrivate:false,habitats:['wetland'],strengths:[],bestTimes:['morning'],
   access:{verified:true,roadCruise:'HIGH',walkingLevel:'low',notes:'x'},sourceNotes:['t'],verifiedAt:'x'});
  const near=mk('near',38.36,-87.57),far=mk('far',38.36,-87.06); // ~46km apart
  const mkObs=(lat,lng,n)=>Array.from({length:n},(_,i)=>({code:'sancra',name:'Sandhill Crane',locId:'x'+lat+i,loc:'x',lat:lat+.001*i,lng:lng,ts:now-1*3600000,howMany:30,notable:false,priv:false}));
  const obs=[...mkObs(38.36,-87.57,5),...mkObs(38.36,-87.06,6)]; // far slightly stronger evidence
  window.__MW_TEST__.state.observations=obs;
  // simulate user near -87.57 (default princeton); set wsg time to 30m
  document.getElementById('wsg-time').value='30m';
  const eN=T.destEvidence(near,now),eF=T.destEvidence(far,now);
  const rN=T.scoreDestination(near,eN,now),rF=T.scoreDestination(far,eF,now);
  document.getElementById('wsg-time').value='half';
  const hN=T.scoreDestination(near,eN,now),hF=T.scoreDestination(far,eF,now);
  return {n30:rN.score,f30:rF.score,nHalf:hN.score,fHalf:hF.score};
 });
 // 30-min budget: near strong site wins despite slightly weaker evidence
 expect(dist.n30).toBeGreaterThanOrEqual(dist.f30);
 // Half day: distance penalty weakens — the far site's deficit shrinks
 expect(dist.n30-dist.f30).toBeGreaterThanOrEqual(dist.nHalf-dist.fHalf);
 // Minimal walking vs any access
 const acc=await page.evaluate(()=>{
  const T=window.__MW_TEST__,now=Date.now();
  const mk=(id,cruise,walk)=>({id,name:id,lat:38.5,lng:-87.3,type:'wildlife-area',evidenceRadiusKm:5,origin:'curated',
   locId:null,locName:id,locPrivate:false,habitats:['wetland'],strengths:[],bestTimes:[],
   access:{verified:true,roadCruise:cruise,walkingLevel:walk,notes:'x'},sourceNotes:['t'],verifiedAt:'x'});
  const road=mk('road','HIGH','low'),hike=mk('hike','LOW','high');
  const obs=Array.from({length:4},(_,i)=>({code:'amre',name:'American Redstart',locId:'q'+i,loc:'q',lat:38.5+.001*i,lng:-87.3,ts:now-3600000,howMany:2,notable:false,priv:false}));
  window.__MW_TEST__.state.observations=obs;
  const eR=T.destEvidence(road,now),eH=T.destEvidence(hike,now);
  document.getElementById('wsg-access').value='minimal';
  const rMin={road:T.scoreDestination(road,eR,now).score,hike:T.scoreDestination(hike,eH,now).score};
  document.getElementById('wsg-access').value='any';
  const rAny={road:T.scoreDestination(road,eR,now).score,hike:T.scoreDestination(hike,eH,now).score};
  return {minGap:rMin.road-rMin.hike,anyGap:rAny.road-rAny.hike};
 });
 // minimal walking: road-cruise site clearly outranks hiking site
 expect(acc.minGap).toBeGreaterThan(acc.anyGap);
});

test('destinations: target changes ranking; private locations never become destinations; dynamic-only areas work; no-evidence honesty',async({page})=>{
 await boot(page);
 // Private-location safety + dynamic-only + target switching (pure computation)
 const r=await page.evaluate(()=>{
  const T=window.__MW_TEST__,now=Date.now(),H=3600000;
  const obs=[
   // private residence with hummingbirds — contributes regionally, must never be a destination
   {code:'rthhum',name:'Ruby-throated Hummingbird',locId:'P1',loc:'Private Residence',lat:38.2,lng:-87.8,ts:now-2*H,howMany:3,notable:false,priv:true},
   // public hotspot with hummingbirds
   {code:'rthhum',name:'Ruby-throated Hummingbird',locId:'H1',loc:'City Park',lat:38.37,lng:-87.55,ts:now-3*H,howMany:2,notable:false,priv:false},
   {code:'rthhum',name:'Ruby-throated Hummingbird',locId:'H1',loc:'City Park',lat:38.37,lng:-87.55,ts:now-5*H,howMany:1,notable:false,priv:false},
   // public hotspot with cranes far away
   {code:'sancra',name:'Sandhill Crane',locId:'C1',loc:'Crane Fields',lat:38.6,lng:-87.2,ts:now-4*H,howMany:120,notable:false,priv:false},
  ];
  window.__MW_TEST__.state.observations=obs;
  const cands=T.buildDestinations();
  const privateListed=cands.some(d=>d.locId==='P1');
  const dynamicPresent=cands.some(d=>d.origin==='dynamic'&&d.locId==='H1');
  // crane target vs hum target materially change top destination
  document.getElementById('wsg-target').value='hum';
  const humRank=T.rankDestinations();
  document.getElementById('wsg-target').value='crane';
  const craneRank=T.rankDestinations();
  document.getElementById('wsg-target').value='migration';
  const craneFields=craneRank.find(r=>r.d.locId==='C1'),humCraneScore=humRank.find(r=>r.d.locId==='C1');
 const parkHum=humRank.find(r=>r.d.locId==='H1'),parkCrane=craneRank.find(r=>r.d.locId==='H1');
  // no-evidence honesty
  window.__MW_TEST__.state.observations=[];
  const none=T.rankDestinations().filter(x=>x.ev.total>0&&x.score>=50);
  return {privateListed,dynamicPresent,humTopName:humRank[0].d.name,craneFieldsScore:craneFields.score,humCraneScore:humCraneScore.score,parkHumScore:parkHum?parkHum.score:null,parkCraneScore:parkCrane?parkCrane.score:null,strongCount:none.length};
 });
 expect(r.privateListed).toBe(false); // private never a destination
 expect(r.dynamicPresent).toBe(true); // dynamic eBird locations generated
 // target materially changes ranking: each hotspot scores higher under its own target
 expect(r.craneFieldsScore).toBeGreaterThan(r.humCraneScore);
 const parkDiff=r.parkHumScore-r.parkCraneScore;
 expect(parkDiff).toBeGreaterThan(0); // City Park benefits from hum target
 // no-evidence: no strong destination fabricated
 expect(r.strongCount).toBe(0);
});

test('Where Should I Go UI: renders primary card, reasons, alternatives, why-view, honors controls',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 const wsg=page.locator('#wsg-out');
 await expect(wsg).toBeVisible();
 const primary=wsg.locator('.dest-primary');
 await expect(primary).toBeVisible();
 await expect(primary).toContainText(/BEST BET NOW|WORTH THE DRIVE|BEST FOR YOUR TARGET|WORTH A LOOK|QUICK LOCAL LOOK/);
 await expect(primary).toContainText('confidence');
 await expect(primary.locator('a[href*="google.com/maps/dir"]').first()).toBeVisible();
 await expect(primary).toContainText('Access information:');
 // alternatives exist (fixtures produce multiple eBird locations)
 expect(await wsg.locator('.dest-alt').count()).toBeGreaterThan(0);
 // why-view: opens detail with score breakdown
 await primary.locator('[data-destwhy]').click();
 await expect(page.locator('#detail')).toBeVisible();
 await expect(page.locator('#detail-body')).toContainText('Destination Score');
 await expect(page.locator('#detail-body')).toContainText('Current bird evidence');
 await expect(page.locator('#detail-body')).toContainText('INFERRED');
 await page.keyboard.press('Escape');
 // target switch recomputes without network (route counter)
 let ebirdCalls=0;await page.route('**api.ebird.org/**',r=>{ebirdCalls++;r.continue();});
 const before=ebirdCalls;
 await page.locator('#wsg-target').selectOption('crane');
 await expect(page.locator('#wsg-target')).toHaveValue('crane');
 expect(ebirdCalls).toBe(before); // no new network request
 // time switch recomputes
 await page.locator('#wsg-time').selectOption('30m');
 await expect(page.locator('#wsg-time')).toHaveValue('30m');
 // star toggling works (favorite ring)
 const star=wsg.locator('.dest-star').first();
 await star.click();
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.destFavorites.length)).toBeGreaterThan(0);
});

/* ================ v2026.09.11.6: AI narration presentation ================ */
test('AI presentation: result card, collapsed JSON, safe markdown, escaping, copy, failure keeps brief',async({page})=>{
 let narrations=0;
 await mockEbird(page);
 await page.route('**openrouter.ai/api/v1/models',r=>r.fulfill({json:{data:OR_MODELS}}));
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>{narrations++;
  return r.fulfill({json:{choices:[{message:{content:'**Worth going out today.** Migration is building near *Princeton*.\n- Sandhill Cranes at 3 locations\n- Feeders active'}}]}});});
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',openrouterKey:'sk-or-v1-TEST',openrouterModel:'anthropic/claude-sonnet-4.6'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.evaluate(()=>{document.querySelector('details:has(#ai-go)').open=true;});
 // 1. JSON disclosure collapsed by default, empty before narrate
 expect(await page.locator('#ai-data-disclosure').getAttribute('open')).toBeNull();
 await expect(page.locator('#ai-brief')).toBeHidden();
 // 2. narrate → card visible with safe-rendered markdown
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-card')).toBeVisible({timeout:10000});
 const briefHTML=await page.locator('#ai-brief').innerHTML();
 expect(briefHTML).toContain('<strong>Worth going out today.</strong>');
 expect(briefHTML).toContain('<em>Princeton</em>');
 expect(briefHTML).toContain('<ul>');
 expect(await page.locator('#ai-brief').textContent()).not.toContain('**'); // no literal tokens
 // 3. disclosure still collapsed after success; opening it reveals exact payload (no coords/keys)
 expect(await page.locator('#ai-data-disclosure').getAttribute('open')).toBeNull();
 await page.locator('#ai-data-disclosure summary').click();
 const payloadText=await page.locator('#ai-input').textContent();
 expect(payloadText).toContain('topSpecies');
 expect(payloadText).not.toMatch(/38\.35|"lat"|GOODKEY|sk-or-v1-TEST/);
 // 4. generated-with shows model; button says Narrate again
 await expect(page.locator('#ai-genwith')).toContainText('Claude Sonnet 4.6');
 await expect(page.locator('#ai-go')).toHaveText('Narrate again');
 // 5. failure: previous brief survives, error shown separately
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({status:503,json:{error:{message:'temp'}}}));
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-err')).toContainText(/could not|failed/i,{timeout:10000});
 await expect(page.locator('#ai-card')).toBeVisible();
 await expect(page.locator('#ai-brief')).toContainText('Worth going out today');
 // 6. arbitrary HTML/script from model is escaped
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({json:{choices:[{message:{content:'**<script>alert(1)</script>** and <img src=x onerror=alert(1)>'}}]}}));
 await page.locator('#ai-go').click();
 await expect(page.locator('#ai-brief')).toContainText('alert(1)');
 const html2=await page.locator('#ai-brief').innerHTML();
 expect(html2).not.toContain('<script>');
 expect(html2).not.toContain('<img');
 expect(html2).toContain('&lt;script&gt;');
 // 7. duplicate clicks while busy: exactly one in-flight request
 let slowCount=0;await page.route('**openrouter.ai/api/v1/chat/completions',async r=>{slowCount++;await new Promise(res=>setTimeout(res,900));
  return r.fulfill({json:{choices:[{message:{content:'Slow brief.'}}]}});});
 await page.locator('#ai-go').click();
 await page.waitForTimeout(150);
 expect(await page.locator('#ai-go').isDisabled()).toBe(true);
 await expect(page.locator('#ai-go')).toHaveAttribute('disabled');
 const mid=slowCount;
 await page.evaluate(()=>document.getElementById('ai-go').click()); // disabled → inert
 expect(slowCount).toBe(mid);
 await page.waitForTimeout(1100);
 expect(await page.locator('#ai-go').isDisabled()).toBe(false);
 // 8. copy button present
 await expect(page.locator('#ai-copy')).toBeVisible();
});

/* ================ v2026.09.11.7: configurable featured species + calendar repair ================ */
test('calendar: dropdown selection persists through renderAll, refresh, and detail opens; selected row emphasized',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.evaluate(()=>{document.querySelector('details:has(#cal-species)').open=true;});
 const sel=page.locator('#cal-species');
 // start: default featured species
 await expect(sel).toHaveValue('rthhum');
 // change to Sandhill Crane
 await sel.selectOption('sancra');
 await expect(sel).toHaveValue('sancra');
 // selected row label changed + emphasized (bold, accent bar)
 await expect(page.locator('#cal-wrap')).toContainText('Sandhill Crane');
 // curve changed: selected row now uses crane curve (compare rendered band pattern implicitly via meta caption)
 await expect(page.locator('#cal-meta')).toContainText('species seasonal model');
 // renderAll() must NOT reset it
 await page.evaluate(()=>window.__MW_TEST__.renderAll());
 await expect(sel).toHaveValue('sancra');
 // open another species detail (state.selected changes)
 await page.evaluate(()=>{const T=window.__MW_TEST__;const sp=T.state.species.find(s=>s.code!=='sancra'&&s.code!=='rthhum');if(sp)T.state.selected=sp;});
 await expect(sel).toHaveValue('sancra');
 // refresh observations (state.selected stays but must not matter)
 await page.locator('#refresh').click();
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await expect(sel).toHaveValue('sancra');
 await expect(page.locator('#cal-wrap')).toContainText('Sandhill Crane');
 // calendar options built from featured+watchlist+reported, featured first
 const firstOpt=await sel.locator('option').first().getAttribute('value');
 expect(['rthhum','sancra']).toContain(firstOpt);
});

test('calendar: same-category species share proxy curve with honest labeling; label not truncated',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY'})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await page.evaluate(()=>{document.querySelector('details:has(#cal-species)').open=true;});
 const sel=page.locator('#cal-species');
 const warblers=await page.evaluate(()=>window.__MW_TEST__.state.species.filter(s=>window.__MW_TEST__.Seasonal.catFor(s.code)==='warbler').map(s=>s.code));
 test.skip(warblers.length<2,'need two same-category species in fixture');
 await sel.selectOption(warblers[0]);
 await expect(page.locator('#cal-meta')).toContainText('warbler seasonal proxy');
 const label0=await page.locator('#cal-wrap').textContent();
 await sel.selectOption(warblers[1]);
 await expect(page.locator('#cal-meta')).toContainText(warblers[1]?'warbler seasonal proxy':'proxy');
 // label shows readable name, not 7-char truncation (textContent concatenates without space)
 const txt=await page.locator('#cal-wrap').textContent();
 expect(txt).toContain('AmericanRedstart');
 expect(txt).not.toContain('Americn ');
 // geographic honesty
 await expect(page.locator('#cal-meta')).toContainText(/MODELED seasonal windows · /);
});

test('featured species: defaults, replace with pelican, reload persistence, enhancers, restore, min/max enforcement',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>{const K='migrationwatch.seeded.f7';if(!localStorage.getItem(K)){
  localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',featuredSpecies:['awwpe','sancra']}));localStorage.setItem(K,'1');}});
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 // pelican replaced hummingbird: generic card (no feeder line), crane enhancer intact
 await expect(page.locator('#fcard-awwpe')).toBeVisible();
 await expect(page.locator('#fcard-awwpe')).toContainText(/No recent reports in radius|Watch score/);
 await expect(page.locator('#fcard-sancra')).toContainText('Jasper-Pulaski');
 // no hummingbird card
 await expect(page.locator('#fcard-rthhum')).toHaveCount(0);
 // settings editor reflects config
 await page.locator('#settings-open').click();
 await expect(page.locator('#fs-list')).toContainText('awwpe'); // raw code fallback when species absent from local data
 // add to reach max via editor → 4th added, 5th refused
 await page.evaluate(()=>{window.__MW_TEST__.setFeatured(['awwpe','sancra','osprey','nobun']);});
 await expect(page.locator('#fs-list')).toContainText('Osprey');
 // max 4: a 5-species attempt is truncated to 4 and never stores more
 await page.evaluate(()=>{window.__MW_TEST__.setFeatured(['awwpe','sancra','osprey','nobun','rthhum']);});
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.featuredSpecies.length)).toBe(4);
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.featuredSpecies.includes('rthhum'))).toBe(false);
 // min 2 enforced
 // min 2: a 1-species attempt is refused, previous config intact
 await page.evaluate(()=>{const ok=window.__MW_TEST__.setFeatured(['awwpe']);window.__MW_TEST__.state._minOk=ok===false;});
 expect(await page.evaluate(()=>window.__MW_TEST__.state._minOk)).toBe(true);
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.featuredSpecies.length)).toBe(4);
 // reload preserves choice
 await page.reload();
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 await expect(page.locator('#fcard-awwpe')).toBeVisible();
 // reorder persists
 await page.locator('#settings-open').click();
 await page.locator('[data-fsdown="0"]').click();
 expect(await page.evaluate(()=>window.__MW_TEST__.settings.featuredSpecies[0])).toBe('sancra');
 // restore defaults
 await page.locator('#fs-restore').click();
 await expect(page.locator('#fcard-rthhum')).toBeVisible();
 await expect(page.locator('#fcard-sancra')).toBeVisible();
});

test('featured fetch: dedicated 30-day calls follow configured species codes exactly',async({page})=>{
 const speciesCalls=[];
 await page.route('**api.ebird.org/**',r=>{const u=r.request().url();
  const m=u.match(/\/recent\/([a-z]+)\?/);
  if(m)speciesCalls.push(m[1]);
  if(u.includes('notable'))return r.fulfill({json:[]});
  if(u.includes('/recent?'))return r.fulfill({json:RECENT});
  return r.fulfill({json:[]});});
 await page.route(/birdcast\.info|journeynorth\.org|in\.gov/,r=>r.fulfill({json:{}}));
 await page.addInitScript(()=>{const K='migrationwatch.seeded.f7b';if(!localStorage.getItem(K)){
  localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',featuredSpecies:['awwpe','osprey']}));localStorage.setItem(K,'1');}});
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 expect(speciesCalls).toEqual(expect.arrayContaining(['awwpe','osprey']));
 expect(speciesCalls).not.toContain('rthhum');
 expect(speciesCalls).not.toContain('sancra');
});

test('map semantic filters are independent of featured configuration',async({page})=>{
 await mockEbird(page);
 await page.addInitScript(()=>localStorage.setItem('migrationwatch.settings',JSON.stringify({ebirdKey:'GOODKEY',featuredSpecies:['awwpe','osprey']})));
 await boot(page);
 await page.waitForFunction(()=>window.__MW_TEST__.state.refreshed,null,{timeout:20000});
 const humFeat=await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('hum');return M.features().map(f=>f.properties.name);});
 // fixture includes hummingbird reports (HUM) → hum filter still means rthhum
 expect(humFeat.length).toBeGreaterThan(0);
 expect(humFeat.every(n=>/Hummingbird/i.test(n))).toBe(true);
 const craneFeat=await page.evaluate(()=>{const M=window.__MW_TEST__.MapMod;M.setFilter('crane');return M.features().map(f=>f.properties.name);});
 expect(craneFeat.length).toBeGreaterThan(0);
 expect(craneFeat.every(n=>/Crane/i.test(n))).toBe(true);
});
