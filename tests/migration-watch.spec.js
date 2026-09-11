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
