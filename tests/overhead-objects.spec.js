const {test,expect}=require('@playwright/test');
const path=require('path');
const fs=require('fs');
const http=require('http');
test.use({channel:'chrome'});
test.setTimeout(120000);
const now=Date.parse('2026-09-07T18:00Z');
const iss={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const start=Date.parse('2026-09-06T00:00Z')/1000;
const hourly={time:Array.from({length:264},(_,i)=>start+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:12,cloud_cover_low:5,cloud_cover_mid:0,cloud_cover_high:7,visibility:30000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:20}))hourly[key]=Array(264).fill(value);
const TERRA_SATCAT=[{OBJECT_NAME:'TERRA',OBJECT_ID:'1999-068A',NORAD_CAT_ID:25994,OBJECT_TYPE:'PAY',OPS_STATUS_CODE:'X',OWNER:'US',
  LAUNCH_DATE:'1999-12-18',LAUNCH_SITE:'AFWTR',DECAY_DATE:'',PERIOD:98.55,INCLINATION:97.94,APOGEE:691,PERIGEE:688}];
const TERRA_WIKIDATA={head:{vars:[]},results:{bindings:[
  {item:{value:'http://www.wikidata.org/entity/Q584697'},norad:{value:'25994'},cospar:{value:'1999-068A'},
   itemLabel:{value:'Terra'},itemDescription:{value:'NASA climate research satellite'},
   operatorLabel:{value:'National Aeronautics and Space Administration'},operatorShort:{value:'NASA'},
   launch:{value:'1999-12-18T00:00:00Z'},website:{value:'https://terra.nasa.gov/'},
   article:{value:'https://en.wikipedia.org/wiki/Terra_(satellite)'},typeLabel:{value:'Earth observation satellite'}},
  {item:{value:'http://www.wikidata.org/entity/Q584697'},norad:{value:'25994'},cospar:{value:'1999-068A'},
   itemLabel:{value:'Terra'},typeLabel:{value:'artificial satellite of the Earth'}}]}};
async function boot(page,{offline=false,url}={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',r=>r.fulfill({json:offline?{error:'Unavailable'}:[iss]}));
  await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:offline?{error:'Unavailable'}:{timezone:'America/Chicago',hourly}}));
  await page.goto(url||`file://${path.resolve('overhead.html')}`);
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
  return errors;
}
test('object identity enrichment: weekly identity, About this object, Starlink sharing, failures, cache and themes',async({page})=>{
  const errors=await boot(page);
  const requests=[];
  // Later routes win over the boot catch-all: real-shaped SATCAT and Wikidata fixtures.
  await page.route('**/satcat/records.php*',r=>{requests.push(r.request().url());
    const norad=new URL(r.request().url()).searchParams.get('CATNR');
    r.fulfill({json:norad==='25994'?TERRA_SATCAT:[]});});
  await page.route('**query.wikidata.org/**',r=>{requests.push(r.request().url());
    r.fulfill({json:decodeURIComponent(r.request().url()).includes('25994')?TERRA_WIKIDATA:{head:{vars:[]},results:{bindings:[]}}});});
  const {pass}=require('./overhead-weekly.cjs');
  const seed=pass(now+3600000);
  // Two seeded events: the Terra pass wins the week, so it drives both surfaces at once.
  await page.evaluate(seed=>{
    const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
    const make=(night,score,name,norad)=>{const t=s.nights[night].start+3600000,delta=t-seed.start;const p=structuredClone(seed);
      Object.assign(p,{id:'obj-'+night,name,norad,score,start:t,end:t+342000,rise:t-60000,set:t+400000});
      for(const k of ['entry','exit','peak','orbitalPeak'])p[k].t+=delta;p.path.forEach(x=>x.t+=delta);return p;};
    s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));
    s.results[0]=[make(0,70,'NOAA 20','43013')];s.results[1]=[make(1,96,'TERRA','25994')];
    s.day=0;s.view='tonight';__OVERHEAD_TEST__.render();
  },seed);
  // Weekly card: compact one-line identity only.
  await expect(page.locator('#weekly-identity')).toHaveText('NASA Earth-observation satellite');
  await expect(page.locator('#weekly-card')).toContainText('TERRA');
  await expect(page.locator('#weekly-card')).not.toContainText('climate research');
  // Event dialog: the existing dialog gains an About this object section.
  await page.locator('#weekly-open').click();
  await expect(page.locator('#event-dialog')).toBeVisible();
  const about=page.locator('#object-about');
  await expect(about).toContainText('ABOUT THIS OBJECT');
  await expect(about).toContainText('Terra');
  await expect(about).toContainText('NASA · Earth observation');
  await expect(about).toContainText('climate research satellite');
  await expect(about).toContainText('Launched Dec 18, 1999');
  await expect(about).toContainText('NORAD 25994 · COSPAR 1999-068A');
  await expect(about.locator('a')).toContainText('Learn more ↗');
  await expect(about.locator('a')).toHaveAttribute('href','https://en.wikipedia.org/wiki/Terra_(satellite)');
  await expect(about.locator('a')).toHaveAttribute('rel','noopener');
  // Ranking and scoring text are untouched.
  await expect(page.locator('#detail-content')).toContainText('Why this score');
  const before=await page.locator('#detail-content').textContent();
  // Starlink: one shared record, no per-satellite mission lookups.
  const shared=await page.evaluate(async()=>{
    const T=window.__OVERHEAD_TEST__,before=T.objectEnricher.stats.requests;
    const satellite={norad:'70001',name:'STARLINK-70001',groups:['starlink'],train:null};
    const group={norad:'train-2026-210',name:'Starlink train 2026-210',groups:['trains'],train:{cohortId:'2026-210'}};
    const one=await T.objectEnricher.resolve(T.requestFor(satellite));
    for(let i=0;i<50;i++)await T.objectEnricher.resolve(T.requestFor({norad:String(70002+i),name:'STARLINK-'+(70002+i),groups:['starlink'],train:null}));
    const train=await T.objectEnricher.resolve(T.requestFor(group));
    return {requests:T.objectEnricher.stats.requests-before,satellite:{key:one.key,operator:one.operator,compact:T.objects.compactIdentity(one)},
      train:{key:train.key,category:train.categoryLabel,compact:T.objects.compactIdentity(train)}};
  });
  expect(shared.requests).toBe(0);
  expect(shared.satellite).toEqual({key:'starlink:object',operator:'SpaceX',compact:'SpaceX Starlink broadband satellite'});
  expect(shared.train).toEqual({key:'starlink:train',category:'Recently launched Starlink group',compact:'SpaceX recently launched Starlink group'});
  // Cache: clearing the in-memory map refills from the separate metadata store without a refetch.
  const cache=await page.evaluate(async()=>{
    const T=window.__OVERHEAD_TEST__,before=[...T.objectMeta.values()].filter(m=>m.norad==='25994');
    const stored=before.map(m=>({cached:m.cached,level:m.level,description:m.description}));
    T.objectMeta.clear();T.renderObjectAbout();
    await new Promise(resolve=>{T.enrichObjects([T.state.selected]);const check=()=>T.objectMeta.size?resolve():setTimeout(check,20);check();});
    const restored=[...T.objectMeta.values()].find(m=>m.norad==='25994');
    return {stored,restored:{cached:restored.cached,operator:restored.operator,fetchedAt:restored.fetchedAt},
      requests:T.objectEnricher.stats.requests,db:'overhead-object-meta'};
  });
  expect(cache.stored).toEqual([{cached:false,level:'full',description:'NASA climate research satellite.'}]);
  expect(cache.restored.cached).toBe(true);
  expect(cache.restored.operator).toBe('NASA');
  // One SATCAT + one Wikidata call for Terra, ever; the selected NOAA pass is the other object.
  expect(requests.filter(url=>decodeURIComponent(url).includes('25994')).length).toBe(2);
  expect(cache.requests).toBe(4);
  await expect(about).toContainText('NASA · Earth observation');
  // Provenance stays in diagnostics, not in the public UI.
  await expect(about).not.toContainText('Wikidata');
  await page.keyboard.press('Escape');
  await page.locator('#diagnostics summary').click();
  const diag=await page.locator('#diagnostic-output').textContent();
  expect(diag).toContain('objectMetadata');
  expect(diag).toContain('"descriptionSource": "Wikidata"');
  expect(diag).toContain('"identitySource": "CelesTrak SATCAT"');
  expect(diag).toContain('overhead-object-meta');
  // Privacy: metadata requests carry identifiers, never observer coordinates.
  expect(requests.length).toBeGreaterThan(0);
  for(const url of requests)expect(decodeURIComponent(url)).not.toMatch(/38\.3553|87\.5675|lat|lon|Princeton|America%2FChicago/i);
  // Failure: both metadata sources down — the event, the dialog and the ranking survive.
  await page.unroute('**/satcat/records.php*');await page.unroute('**query.wikidata.org/**');
  await page.route('**/satcat/records.php*',r=>{requests.push(r.request().url());r.fulfill({status:500,body:'unavailable'});});
  await page.route('**query.wikidata.org/**',r=>{requests.push(r.request().url());r.fulfill({status:503,body:'unavailable'});});
  await page.evaluate(()=>{
    const T=window.__OVERHEAD_TEST__,s=T.state;
    const unknown=structuredClone(s.results[1][0]);
    Object.assign(unknown,{id:'obj-unknown',norad:'99999',name:'OBJECT 99999',groups:[],train:null});
    s.results[2]=[unknown];T.showEvent('obj-unknown',unknown);
  });
  await expect(page.locator('#object-about')).toContainText('OBJECT 99999');
  await expect(page.locator('#object-about')).toContainText('No additional mission information is available');
  await expect(page.locator('#object-about')).not.toContainText(/HTTP|500|503|undefined/);
  await expect(page.locator('#detail-content')).toContainText('Why this score');
  await expect(page.locator('.weekly-grade')).toHaveText('96 · Excellent');
  await expect(page.locator('#weekly-card')).toContainText('TERRA');
  expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.weekly.winner.pass.id)).toBe('obj-1');
  // Long organization names and long descriptions wrap instead of overflowing.
  await page.evaluate(()=>{
    const T=window.__OVERHEAD_TEST__,key=T.objectKey(T.state.selected);
    T.objectMeta.set(key,{...T.objectMeta.get(key),key,name:'INTERNATIONAL SPACE SCIENCE INSTITUTE EXPERIMENT PLATFORM',
      operator:'National Aeronautics and Space Administration Goddard Space Flight Center Earth Sciences Division',
      category:'Earth observation',link:'https://en.wikipedia.org/wiki/Terra_(satellite)',linkLabel:'Wikipedia',
      launchDate:'1999-12-18',launchSite:'Vandenberg, California',status:'Extended mission',norad:'25994',cospar:'1999-068A',level:'full',
      description:'A deliberately long mission description used to verify that the object identity block wraps naturally on narrow screens without horizontal overflow or clipped text in either theme.'});
    T.renderObjectAbout();
  });
  for(const width of [390,768,1024,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['dark','light']){
      await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      const box=await page.locator('#object-about').boundingBox();
      expect(box.width).toBeLessThanOrEqual(width);
      expect(await page.locator('#object-about').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      expect(await page.locator('#object-about a').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(12);
      await page.screenshot({path:'/private/tmp/overhead-object-'+theme+'-'+width+'.png'});
    }
  }
  // Fresh page: the metadata store is reused (no refetch after reload).
  await page.setViewportSize({width:1280,height:1000});
  const reloadRequests=[];
  await page.route('**/satcat/records.php*',r=>{reloadRequests.push(r.request().url());r.fulfill({json:TERRA_SATCAT});});
  await page.route('**query.wikidata.org/**',r=>{reloadRequests.push(r.request().url());r.fulfill({json:TERRA_WIKIDATA});});
  await page.reload();await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
  await page.evaluate(seed=>{
    const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
    const t=s.nights[1].start+3600000,delta=t-seed.start;const p=structuredClone(seed);
    Object.assign(p,{id:'obj-1',name:'TERRA',norad:'25994',score:96,start:t,end:t+342000,rise:t-60000,set:t+400000});
    for(const k of ['entry','exit','peak','orbitalPeak'])p[k].t+=delta;p.path.forEach(x=>x.t+=delta);
    s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));s.results[1]=[p];__OVERHEAD_TEST__.render();
  },seed);
  await expect(page.locator('#weekly-identity')).toHaveText('NASA Earth-observation satellite');
  expect(reloadRequests.length).toBe(0);
  expect(errors).toEqual([]);
});
test('object metadata never blocks orbital calculation, maps, trains or weather',async({page})=>{
  const errors=await boot(page);
  // Every metadata source is unavailable for the whole run.
  await page.route('**/satcat/records.php*',r=>r.abort());
  await page.route('**query.wikidata.org/**',r=>r.fulfill({status:500,body:'unavailable'}));
  const {pass}=require('./overhead-weekly.cjs');
  const seed=pass(now+3600000);
  await page.evaluate(seed=>{
    const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
    const t=s.nights[1].start+3600000,delta=t-seed.start;const p=structuredClone(seed);
    Object.assign(p,{id:'obj-1',name:'UNKNOWN 42424',norad:'42424',score:96,start:t,end:t+342000,rise:t-60000,set:t+400000});
    for(const k of ['entry','exit','peak','orbitalPeak'])p[k].t+=delta;p.path.forEach(x=>x.t+=delta);
    s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));s.results[1]=[p];__OVERHEAD_TEST__.render();
  },seed);
  await expect(page.locator('.weekly-grade')).toHaveText('96 · Excellent');
  await expect(page.locator('#weekly-identity')).toBeHidden();
  await page.locator('#weekly-open').click();
  await expect(page.locator('#object-about')).toContainText('No additional mission information is available');
  await expect(page.locator('#detail-content svg')).toBeVisible();
  await page.locator('#map-open').click();
  await page.waitForFunction(()=>__OVERHEAD_TEST__.getMap()?.getLayer('pass'),null,{timeout:30000});
  expect(await page.evaluate(()=>__OVERHEAD_TEST__.getMap().getSource('pass')._data.geometry.coordinates.length)).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  // Real propagation still works: no metadata dependency anywhere in the pipeline.
  await page.locator('#diagnostics summary').click();
  const diag=await page.locator('#diagnostic-output').textContent();
  expect(diag).toContain('"objectsCalculated"');
  expect(diag).toContain('objectMetadata');
  expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.weekly.winner.pass.norad)).toBe('42424');
  expect(errors).toEqual([]);
});

test('partial metadata-source failure keeps verified identity and stays out of the public UI',async({page})=>{
  const errors=await boot(page);
  // SATCAT answers; Wikidata is down. Verified identity must survive, with a diagnostics-only warning.
  await page.route('**/satcat/records.php*',r=>r.fulfill({json:TERRA_SATCAT}));
  await page.route('**query.wikidata.org/**',r=>r.fulfill({status:503,body:'unavailable'}));
  const {pass}=require('./overhead-weekly.cjs');
  const seed=pass(now+3600000);
  await page.evaluate(seed=>{
    const s=__OVERHEAD_TEST__.state;s.worker?.terminate();s.busy=false;s.loading=false;
    const t=s.nights[1].start+3600000,delta=t-seed.start;const p=structuredClone(seed);
    Object.assign(p,{id:'obj-1',name:'TERRA',norad:'25994',score:96,start:t,end:t+342000,rise:t-60000,set:t+400000});
    for(const k of ['entry','exit','peak','orbitalPeak'])p[k].t+=delta;p.path.forEach(x=>x.t+=delta);
    s.results=Object.fromEntries(s.nights.map((_,i)=>[i,[]]));s.results[1]=[p];__OVERHEAD_TEST__.render();
  },seed);
  await page.locator('#weekly-open').click();
  const about=page.locator('#object-about');
  await expect(about).toContainText('ABOUT THIS OBJECT');
  await expect(about).toContainText('Terra');
  await expect(about).toContainText('Launched Dec 18, 1999');
  await expect(about).toContainText('NORAD 25994 · COSPAR 1999-068A');
  // No public error: no HTTP status, no stack, no "unavailable" wording for a partial failure.
  await expect(about).not.toContainText(/HTTP|503|unavailable|undefined/);
  await expect(page.locator('#status')).not.toContainText(/503|Wikidata/);
  await page.keyboard.press('Escape');
  const stats=await page.evaluate(()=>{const s=__OVERHEAD_TEST__.objectEnricher.stats;
    return {requests:s.requests,objectFailures:s.objectFailures,failures:s.failures,sourceWarnings:s.sourceWarnings,
      lastError:s.lastError,lastWarning:s.lastWarning,meta:[...__OVERHEAD_TEST__.objectMeta.values()].map(m=>({level:m.level,warning:m.warning,error:m.error}))};});
  expect(stats.objectFailures).toBe(0);
  expect(stats.failures).toBe(0);
  expect(stats.sourceWarnings).toBeGreaterThan(0);
  expect(stats.lastError).toBe(null);
  expect(stats.lastWarning).toMatch(/Wikidata/);
  expect(stats.meta.some(m=>m.level==='identity'&&m.warning&&/Wikidata/.test(m.warning)&&m.error===null)).toBe(true);
  await page.locator('#diagnostics summary').click();
  const diag=await page.locator('#diagnostic-output').textContent();
  expect(diag).toContain('"sourceWarnings"');
  expect(diag).toContain('"lastWarning": "Wikidata');
  expect(diag).toContain('"objectFailures": 0');
  expect(errors).toEqual([]);
});

test('metadata module unavailable leaves Overhead fully functional',async({page,browser})=>{
  // Serve the real app but make overhead-objects.js disappear (404), as a failed load would.
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://local').pathname.slice(1);
    if(file==='overhead-objects.js'){res.writeHead(404);res.end('not found');return;}
    if(!['overhead.html','overhead-engine.js','overhead-weekly.js','overhead-lifecycle.js','overhead-trains.js','overhead-worker.js','analytics-lite.js',
      'vendor/overhead/satellite-6.0.1.min.js','vendor/overhead/suncalc-1.9.0.js'].includes(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');
    res.end(fs.readFileSync(path.resolve(file)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|overhead-objects\.js/.test(m.text()))errors.push(m.text());});
    await page.clock.setFixedTime(new Date(now));
    await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
    await page.route('**celestrak.org/**',r=>r.fulfill({json:[iss]}));
    await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
    await page.goto('http://127.0.0.1:'+server.address().port+'/overhead.html');
    await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
    // The module is genuinely absent, and the app says so only in diagnostics.
    expect(await page.evaluate(()=>window.OverheadObjects)).toBe(undefined);
    expect(await page.evaluate(()=>__OVERHEAD_TEST__.metadataAvailable)).toBe(false);
    // Orbital calculation, weather, weekly ranking and Train Watch all work.
    expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.poolCount)).toBeGreaterThan(0);
    await expect(page.locator('.event').first()).toBeVisible();
    await expect(page.locator('#night-score')).not.toHaveText('—');
    expect(await page.evaluate(()=>!!__OVERHEAD_TEST__.state.weekly.winner)).toBe(true);
    expect(await page.evaluate(()=>Array.isArray(__OVERHEAD_TEST__.state.trainCohorts))).toBe(true);
    await expect(page.locator('#conditions')).not.toBeEmpty();
    // Weekly card and event dialog work, with no About-this-object content.
    await expect(page.locator('#weekly-open')).toBeVisible();
    await expect(page.locator('#weekly-identity')).toBeHidden();
    await page.locator('#weekly-open').click();
    await expect(page.locator('#event-dialog')).toBeVisible();
    await expect(page.locator('#detail-title')).not.toBeEmpty();
    await expect(page.locator('#detail-content svg')).toBeVisible();
    await expect(page.locator('#detail-content')).toContainText('Why this score');
    await expect(page.locator('#object-about')).toBeHidden();
    await expect(page.locator('#object-about')).toBeEmpty();
    await page.keyboard.press('Escape');
    // Navigation and the other views still render.
    await page.getByRole('tab',{name:'NEXT 7 DAYS'}).click();
    await expect(page.locator('#week button')).toHaveCount(7);
    await page.getByRole('tab',{name:'ABOUT'}).click();
    await expect(page.locator('#about')).toBeVisible();
    await page.getByRole('tab',{name:'TONIGHT',exact:true}).click();
    // Diagnostics report the optional feature as unavailable, in plain language.
    await page.locator('#diagnostics summary').click();
    const diag=await page.locator('#diagnostic-output').textContent();
    expect(diag).toContain('Metadata enrichment unavailable');
    expect(diag).toContain('Pass predictions are unaffected');
    expect(diag).toContain('"available": false');
    expect(diag).not.toMatch(/stack|undefined is not|Cannot read/i);
    expect(errors).toEqual([]);
  }finally{await new Promise(r=>server.close(r));}
});
