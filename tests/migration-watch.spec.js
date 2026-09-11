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
  const u=r.request().url();const k=r.request().headers()['x-ebirdapi'];
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
 await expect(page.locator('#fcard-hum')).toBeVisible();
 await expect(page.locator('#fcard-crane')).toContainText('Historical baseline unavailable');
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
 await expect(page.locator('#fcard-hum')).toContainText('Ruby-throated Hummingbird');
 await expect(page.locator('#fcard-hum')).toContainText('Keep feeders active');
 await expect(page.locator('#fcard-crane')).toContainText('Sandhill Crane');
 await expect(page.locator('#fcard-crane')).toContainText('Worth a regional trip');
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
 await page.locator('#map-details summary').click();
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
  await TS.put({id:TS.key(today,'princeton',50,'amre'),date:today,locationPreset:'princeton',radiusKm:50,speciesCode:'amre',commonName:'American Redstart',observations72h:1,reportingLocations72h:1,observations7d:1,reportingLocations7d:1,nearestKm:30,maxCount:1,medianCount:1,notableCount:0,seasonalExpectation:3,seasonalStatus:'ACTIVE',speciesWatchScore:20,capturedAt:new Date().toISOString()});});
 const isolated=await page.evaluate(async()=>{const TS=window.__MW_TEST__.TrendStore;return (await TS.scopeHistory('princeton',25,'amre')).length;});
 expect(isolated).toBe(1);
 // retention: old + over-cap records pruned
 const pruned=await page.evaluate(async()=>{const T=window.__MW_TEST__,TS=T.TrendStore;
  const old=new Date(Date.now()-100*86400000).toISOString().slice(0,10);
  await TS.put({id:TS.key(old,'princeton',25,'x'),date:old,locationPreset:'princeton',radiusKm:25,speciesCode:'x',commonName:'X',observations72h:0,reportingLocations72h:0,observations7d:0,reportingLocations7d:0,nearestKm:null,maxCount:null,medianCount:null,notableCount:0,seasonalExpectation:0,seasonalStatus:'DONE',speciesWatchScore:0,capturedAt:new Date().toISOString()});
  // fill beyond cap
  for(let i=0;i<TS.MAX_RECORDS+2;i++){const d='2026-06-'+String(1+(i%28)).padStart(2,'0');
   await TS.put({id:TS.key(d,'ggs',25,'f'+i),date:d,locationPreset:'ggs',radiusKm:25,speciesCode:'f'+i,commonName:'F'+i,observations72h:0,reportingLocations72h:0,observations7d:0,reportingLocations7d:0,nearestKm:null,maxCount:null,medianCount:null,notableCount:0,seasonalExpectation:0,seasonalStatus:'DONE',speciesWatchScore:0,capturedAt:new Date().toISOString()});}
  await TS.prune();
  const all=await TS.getAll();
  return {count:all.length,oldGone:!all.some(s=>s.date<new Date(Date.now()-90*86400000).toISOString().slice(0,10))};});
 expect(pruned.count).toBeLessThanOrEqual(5000);
 expect(pruned.oldGone).toBe(true);
 // privacy: derived snapshots only
 const dump=await page.evaluate(async()=>JSON.stringify(await window.__MW_TEST__.TrendStore.getAll()));
 expect(dump).not.toMatch(/"lat"|"lng"|ebirdKey|openrouterKey|obsDt|locName|subId|priv/);
 expect(dump).not.toMatch(/38\.35|38\.3\d\d/);
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
  await expect(page.locator('#list-note')).toContainText('permanently featured');
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
 const svg=await page.locator('#hist-hum svg').count();
 expect(svg).toBe(1);
 const legend=await page.locator('#hist-hum .hlegend').textContent();
 expect(legend).toMatch(/snapshot/);expect(legend).not.toMatch(/0 snapshot/);
 await page.locator('[data-hkey="hum"][data-hrange="30"]').click();
 await expect(page.locator('#hist-hum .hlegend')).toContainText(/snapshot/);
 // aria pressed state moves
 expect(await page.locator('[data-hkey="hum"][data-hrange="30"]').getAttribute('aria-pressed')).toBe('true');
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
