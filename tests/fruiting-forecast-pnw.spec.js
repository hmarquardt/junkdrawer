const {test,expect}=require('@playwright/test');
require('./fruiting-local-manifest.cjs')(test);
const path=require('path');
const {spawn}=require('child_process');
test.use({channel:'chrome'});
function weatherPayload(lat=45.52,lon=-122.68){
  const now=new Date();const day=new Date(now.getFullYear(),now.getMonth(),now.getDate());const dates=[];const hours=[];
  for(let i=-30;i<=7;i++)dates.push(new Date(day.getTime()+i*86400000).toISOString().slice(0,10));
  for(let i=-30*24;i<=7*24;i++)hours.push(new Date(day.getTime()+i*3600000).toISOString().slice(0,13)+':00');
  return {latitude:lat,longitude:lon,elevation:220,timezone:'America/Los_Angeles',daily:{time:dates,
    precipitation_sum:dates.map((_,i)=>i>16&&i<29?0.22:0),temperature_2m_max:dates.map(()=>58),temperature_2m_min:dates.map(()=>44),
    et0_fao_evapotranspiration:dates.map(()=>0.05)},hourly:{time:hours,temperature_2m:hours.map(()=>52),relative_humidity_2m:hours.map(()=>88),
    dew_point_2m:hours.map(()=>49),precipitation:hours.map(()=>0),soil_temperature_0cm:hours.map(()=>55),soil_moisture_0_to_1cm:hours.map(()=>0.38),
    vapour_pressure_deficit:hours.map(()=>0.25),wind_speed_10m:hours.map(()=>5)}};
}
async function open(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{const u=new URL(r.request().url());const lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);const rows=lat.map((v,i)=>weatherPayload(v,lon[i]));return r.fulfill({json:rows.length===1?rows[0]:rows})});
  await page.goto('file://'+path.resolve('fruiting-forecast.html'));
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  return errors;
}
// Deterministic PNW scoring: every input is explicit, no live weather.
async function pnwScore(page,params){
  return page.evaluate(({id,month,elevationM,habitat,rain14,wetDays14,daysSinceRain,recharge14,soilTemp})=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(45.52,-122.68)).find(x=>x.id===id);
    const zone={point:{searchRadius:25},elevation:elevationM,habitat,
      metrics:{rain14,rain7:rain14*.7,rain10:rain14*.9,rain30:rain14*1.6,recharge14,daysSinceRain,wetDays14,
        soilMoisture:.34,soilTemp,airTemp:54,humidity:86,vpd:.3,wind:5,et07:.35}};
    const s=t.scoreSpecies(sp,zone,null,new Date(2026,month-1,15));
    return {score:s.score,band:s.band,confidence:s.confidence,components:s.components,missing:s.missing,reason:s.reason,seasonGate:s.seasonGate,availableWeight:s.availableWeight,totalWeight:s.totalWeight};
  },params);
}
const pnwConifer={available:true,sampleCells:24,forest:{cover:.78,deciduous:0,open:.02,canopy:.82,evergreen:.78,dominantClass:'douglas_fir'},
  hosts:{hemlockSitkaSpruce:.72,douglasFir:.81,lodgepolePine:.12,ponderosaPine:0,spruceFir:.08,firSpruceMountainHemlock:.2,mappedCoverage:.95},
  soil:{},terrain:{elevationMedianFt:2500},access:{},confidence:{cellCoverage:1,hostQuality:.65,soilCoverage:.92}};
const pnwNoHemlock={...pnwConifer,hosts:{hemlockSitkaSpruce:0,douglasFir:.4,lodgepolePine:.1,ponderosaPine:0,spruceFir:0,firSpruceMountainHemlock:.1,mappedCoverage:.9}};
const pnwOpen={available:true,sampleCells:24,forest:{cover:.05,deciduous:0,open:.86,canopy:.04,evergreen:.05,dominantClass:'grassland_herbaceous'},
  hosts:{hemlockSitkaSpruce:0,douglasFir:0,lodgepolePine:0,ponderosaPine:0,spruceFir:0,firSpruceMountainHemlock:0,mappedCoverage:.9},
  soil:{},terrain:{elevationMedianFt:400},access:{},confidence:{cellCoverage:1,hostQuality:.65,soilCoverage:.5}};

test('Pacific Northwest Maritime resolves with sourced targets and modern taxonomy',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const bio=b.resolveBiology(45.52,-122.68);
    const species=b.regionalSpecies(bio);
    return {bio,ids:species.map(s=>s.id),names:species.map(s=>s.scientific),inats:species.map(s=>s.inat),
      maturity:species.map(s=>s.maturity),matsutakeTaxon:b.profiles.pnw.targets.matsutakeMurrillianum.provenance.taxon,
      craterelleTaxon:b.profiles.pnw.targets.craterelleNeotubaeformis.provenance.taxon,
      western:b.profiles.pnw.targets.matsutakeMurrillianum.provenance.hosts};
  });
  expect(r.bio.profileId).toBe('pnw');
  expect(r.bio.maturity).toBe('PROVISIONAL');
  expect(['1','2','3','4']).toContain(r.bio.ecoregionCode);
  expect(r.ids).toEqual(['chanterelleFormosus','chanterelleSubalbidus','matsutakeMurrillianum','craterelleNeotubaeformis','morelBurn']);
  expect(r.names).toContain('Tricholoma murrillianum');
  expect(r.names.join(' ')).not.toContain('magnivelare');
  expect(r.matsutakeTaxon).toContain('murrillianum');
  expect(r.matsutakeTaxon).toContain('magnivelare');
  expect(r.craterelleTaxon).toContain('neotubaeformis');
  expect(r.inats).toEqual([120443,54132,521711,1677906,null]);
  for(const m of r.maturity)expect(m).toBe('PROVISIONAL');
  expect(errors).toEqual([]);
});

test('Pacific golden chanterelle answers autumn wet-up, conifer habitat and season',async({page})=>{
  const errors=await open(page);
  const wet=await pnwScore(page,{id:'chanterelleFormosus',month:10,elevationM:400,habitat:pnwConifer,rain14:3.2,wetDays14:11,daysSinceRain:2,recharge14:2.4,soilTemp:52});
  const dry=await pnwScore(page,{id:'chanterelleFormosus',month:10,elevationM:400,habitat:pnwConifer,rain14:0.1,wetDays14:0,daysSinceRain:30,recharge14:-0.9,soilTemp:60});
  const openGround=await pnwScore(page,{id:'chanterelleFormosus',month:10,elevationM:400,habitat:pnwOpen,rain14:3.2,wetDays14:11,daysSinceRain:2,recharge14:2.4,soilTemp:52});
  const winter=await pnwScore(page,{id:'chanterelleFormosus',month:1,elevationM:400,habitat:pnwConifer,rain14:6,wetDays14:14,daysSinceRain:1,recharge14:1.5,soilTemp:45});
  expect(wet.components.habitat).toBeGreaterThan(60);
  expect(wet.components.transition).toBeGreaterThan(70);
  expect(wet.components.season).toBe(100);
  expect(dry.components.transition).toBeLessThan(40);
  expect(wet.score).toBeGreaterThan(dry.score);
  expect(wet.score).toBeGreaterThan(openGround.score);
  expect(openGround.components.habitat).toBeLessThan(wet.components.habitat);
  // January is outside this target's published midsummer-to-late-fall window.
  expect(winter.score).toBe(0);
  // Temperature is deliberately unscored for this target rather than invented.
  expect(wet.components.temperature).toBeUndefined();
  expect(errors).toEqual([]);
});

test('white chanterelle is an independent earlier-season target',async({page})=>{
  const errors=await open(page);
  const august=await pnwScore(page,{id:'chanterelleSubalbidus',month:8,elevationM:350,habitat:pnwConifer,rain14:1.8,wetDays14:8,daysSinceRain:3,recharge14:0.8,soilTemp:56});
  const november=await pnwScore(page,{id:'chanterelleSubalbidus',month:11,elevationM:350,habitat:pnwConifer,rain14:1.8,wetDays14:8,daysSinceRain:3,recharge14:0.8,soilTemp:48});
  const goldenNovember=await pnwScore(page,{id:'chanterelleFormosus',month:11,elevationM:350,habitat:pnwConifer,rain14:1.8,wetDays14:8,daysSinceRain:3,recharge14:0.8,soilTemp:48});
  const goldenAugust=await pnwScore(page,{id:'chanterelleFormosus',month:8,elevationM:350,habitat:pnwConifer,rain14:1.8,wetDays14:8,daysSinceRain:3,recharge14:0.8,soilTemp:56});
  expect(august.components.season).toBe(100);
  expect(november.components.season).toBe(22);
  expect(august.score).toBeGreaterThan(november.score);
  // The two chanterelles keep independent calendars rather than one shared model.
  expect(goldenNovember.components.season).toBe(100);
  expect(goldenAugust.components.season).toBe(22);
  expect(errors).toEqual([]);
});

test('western matsutake uses modern taxonomy, conifer hosts, autumn cooling and elevation',async({page})=>{
  const errors=await open(page);
  const base={id:'matsutakeMurrillianum',month:10,elevationM:900,habitat:pnwConifer,rain14:2.4,wetDays14:9,daysSinceRain:3,recharge14:1.6,soilTemp:58};
  const good=await pnwScore(page,base);
  const openGround=await pnwScore(page,{...base,habitat:pnwOpen});
  const noHemlock=await pnwScore(page,{...base,habitat:pnwNoHemlock});
  const offSeason=await pnwScore(page,{...base,month:2});
  const hot=await pnwScore(page,{...base,soilTemp:78});
  const cold=await pnwScore(page,{...base,soilTemp:38});
  const high=await pnwScore(page,{...base,elevationM:3000});
  const noHabitat=await pnwScore(page,{...base,habitat:null});
  expect(good.components.habitat).toBeGreaterThan(60);
  expect(good.score).toBeGreaterThan(openGround.score);
  expect(good.score).toBeGreaterThan(noHemlock.score);
  expect(offSeason.score).toBe(0);
  expect(good.components.temperature).toBe(100);
  expect(hot.components.temperature).toBeLessThan(good.components.temperature);
  expect(cold.components.temperature).toBeLessThan(good.components.temperature);
  expect(good.components.elevation).toBe(100);
  expect(high.components.elevation).toBeLessThan(50);
  expect(noHabitat.components.habitat).toBeNull();
  expect(noHabitat.missing).toContain('habitat');
  expect(noHabitat.confidence.score).toBeLessThan(good.confidence.score);
  expect(errors).toEqual([]);
});

test('winter craterelle follows hemlock, keeps a winter window and states its missing debris evidence',async({page})=>{
  const errors=await open(page);
  const base={id:'craterelleNeotubaeformis',month:1,elevationM:300,habitat:pnwConifer,rain14:5.5,wetDays14:13,daysSinceRain:1,recharge14:1.2,soilTemp:42};
  const hemlock=await pnwScore(page,base);
  const noHemlock=await pnwScore(page,{...base,habitat:pnwNoHemlock});
  const goldenJanuary=await pnwScore(page,{...base,id:'chanterelleFormosus'});
  expect(hemlock.components.season).toBe(100);
  expect(hemlock.components.habitat).toBeGreaterThan(noHemlock.components.habitat);
  expect(hemlock.score).toBeGreaterThan(noHemlock.score);
  // The winter window is real: the golden chanterelle scores zero in January, this doesn't.
  expect(goldenJanuary.score).toBe(0);
  expect(hemlock.score).toBeGreaterThan(0);
  // Published coarse-woody-debris drivers are unavailable and are stated, not substituted.
  expect(hemlock.reason).toContain('coarse woody debris');
  expect(hemlock.confidence.label).not.toBe('High');
  expect(errors).toEqual([]);
});

test('PNW biology never leaks into neighboring unsupported profiles',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const at=(lat,lon)=>{const bio=b.resolveBiology(lat,lon);return {profileId:bio.profileId,ids:b.regionalSpecies(bio).map(s=>s.id)}};
    return {pnw:at(45.52,-122.68),indiana:at(38.3553,-87.5675),colorado:at(39.48,-106.05),
      interiorOregon:at(44.0,-120.5),california:at(38.5,-122.7),plains:at(38.5,-100.5)};
  });
  expect(r.pnw.ids).toHaveLength(5);
  expect(r.indiana.ids).toHaveLength(7);
  expect(r.colorado.ids).toEqual(['porcini','chanterelleRoseocanus','morelNatural','morelBurn']);
  // Eastern Cascades now belongs to the modeled interior profile: it receives
  // exactly the interior targets and never PNW biology.
  expect(r.interiorOregon.profileId).toBe('interiorMountains');
  expect(r.interiorOregon.ids).toEqual(['morelBurn','matsutakeMurrillianum']);
  // California is now modeled: it receives its own targets and never PNW ids.
  expect(r.california.profileId).toBe('california');
  expect(r.california.ids).toEqual(['chanterelleCalifornicus','craterellusCalicornucopioides','lactariusRubidus','morel']);
  // plains is now modeled: morelAmericana + giantPuffball, never PNW ids
  expect(r.plains.profileId).toBe('plains');
  expect(r.plains.ids).toEqual(['morelAmericana','giantPuffball']);
  expect(r.plains.ids).not.toContain('chanterelleFormosus');
  // Southern Rockies targets stay out of the Pacific Northwest and vice versa.
  expect(r.pnw.ids).not.toContain('porcini');
  expect(r.pnw.ids).not.toContain('chanterelleRoseocanus');
  expect(r.indiana.ids).not.toContain('chanterelleFormosus');
  expect(errors).toEqual([]);
});

test('a radius crossing the PNW boundary scores every sector with its own profile',async({page})=>{
  const errors=await open(page);
  await page.locator('#radiusSelect').selectOption('100');
  await page.locator('#locationInput').fill('45.0, -122.5');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready');
  const r=await page.evaluate(()=>{
    const a=window.__FRUITING_FORECAST_TEST__.getState().analysis;
    const zone=(id)=>(a.zones.find(z=>z.id===id)||{scores:[]});
    const zoneIds=Object.keys(a.zoneBiology);
    const profiles=zoneIds.map(k=>[k,a.zoneBiology[k].profileId]);
    const zoneScores={};
    for(const k of zoneIds)zoneScores[k]={profileId:a.zoneBiology[k].profileId,scores:zone(k).scores.map(s=>s.speciesId)};
    return {center:a.biology.profileId,profiles,sectorBiologyCount:a.sectorBiologyCount,
      targets:a.speciesConfiguration.map(x=>x.id),
      zoneScores,
      meta:document.querySelector('#analysisMeta').textContent};
  });
  expect(r.center).toBe('pnw');
  expect(r.sectorBiologyCount).toBeGreaterThanOrEqual(2);
  expect(r.profiles.map(p=>p[1])).toContain('pnw');
  expect(r.profiles.map(p=>p[1])).not.toEqual(r.profiles.map(()=>'pnw'));
  expect(r.targets).toEqual(['chanterelleFormosus','chanterelleSubalbidus','matsutakeMurrillianum','craterelleNeotubaeformis','morelBurn']);
  const pnwZones=Object.entries(r.zoneScores).filter(([,v])=>v.profileId==='pnw');
  expect(pnwZones.length).toBeGreaterThan(0);
  for(const [,z] of pnwZones)expect(z.scores).toEqual(expect.arrayContaining(['chanterelleFormosus','matsutakeMurrillianum','craterelleNeotubaeformis']));
  // Unsupported sectors score nothing rather than inheriting PNW target sets;
  // modeled non-PNW sectors (Eastern Cascades -> interiorMountains) score only
  // their own interior targets.
  for(const [,z] of Object.entries(r.zoneScores)){
    if(z.profileId==='pnw')continue;
    if(z.profileId==='interiorMountains'){
      expect(z.scores).toEqual(expect.arrayContaining(['morelBurn','matsutakeMurrillianum']));
      expect(z.scores).not.toContain('chanterelleFormosus');
      expect(z.scores).not.toContain('porcini');
    }else{
      expect(z.scores).toEqual([]);
    }
  }
  expect(r.meta).toContain('regional models across sectors');
  expect(errors).toEqual([]);
});

// End-to-end checks for the published Pacific Northwest canary tiles: normalized
// source -> publisher -> manifest -> browser fetch. Field content is asserted by
// tests/test_fruiting_bulk_adapters.py; these tests verify the hosted artifacts.
const artifactPort=8900+(process.pid%500);
let artifactServer;
test.beforeAll(async()=>{
  artifactServer=spawn('python3',['-m','http.server',String(artifactPort),'--bind','127.0.0.1'],{cwd:process.cwd(),stdio:'ignore'});
  for(let i=0;i<40;i++){
    try{await new Promise((resolve,reject)=>require('http').get(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,r=>{r.resume();resolve()}).on('error',reject));return}
    catch{await new Promise(r=>setTimeout(r,100))}
  }
  throw new Error('Static artifact server did not start');
});
test.afterAll(()=>{if(artifactServer)artifactServer.kill()});
test('PNW canary tiles publish five-component habitat with Oregon soil and match manifest digests',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__);
  const result=await page.evaluate(async()=>{
    const t=window.__FRUITING_FORECAST_TEST__;
    const manifest=await t.gisManifest(true);
    const digest=async(url,baseline)=>{
      const response=await fetch('data/fruiting-forecast/'+url);
      const buffer=await response.arrayBuffer();
      const value=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
      return {status:response.status,bytes:buffer.byteLength,matches:value===baseline};
    };
    const tiles={};
    for(const id of ['n44_w124','n43_w123']){
      const tile=(manifest.tiles||[]).find(x=>x.id===id);
      if(!tile){tiles[id]={missing:true};continue}
      const soil=(tile.habitat.sources||[]).find(s=>s.id==='ssurgo_sda')||{};
      tiles[id]={missing:false,bbox:tile.bbox,habitat:{status:tile.habitat.status,cells:tile.habitat.cells,components:tile.habitat.components,units:tile.habitat.units,soilState:soil.state,soilInclusion:soil.inclusion,surveyVintage:soil.surveyVintage,unbuilt:tile.habitat.unbuilt,fetch:await digest(tile.habitat.url,tile.habitat.sha256)},publicLands:{status:tile.publicLands.status,properties:tile.publicLands.properties,fetch:await digest(tile.publicLands.url,tile.publicLands.sha256)},fire:{status:tile.fireHistory.status,perimeters:tile.fireHistory.perimeters,fetch:await digest(tile.fireHistory.url,tile.fireHistory.sha256)},access:tile.accessPoints.status};
    }
    return {tiles,coverage:manifest.summary.coverageTiles,profiles:manifest.summary.ecologicalProfiles,states:manifest.summary.states};
  });
  for(const id of ['n44_w124','n43_w123']){
    const tile=result.tiles[id];
    expect(tile.missing).toBe(false);
    expect(tile.habitat.status).toBe('AVAILABLE');
    expect(tile.habitat.cells).toBe(400);
    expect(tile.habitat.components).toEqual({forestType:'AVAILABLE',elevation:'AVAILABLE',landCover:'AVAILABLE',canopy:'AVAILABLE',soil:'AVAILABLE'});
    expect(tile.habitat.units.elevation_ft).toBe('feet');
    expect(tile.habitat.soilState).toBe('OR');
    expect(tile.habitat.soilInclusion).toBe('requested');
    expect(String(tile.habitat.surveyVintage)).toMatch(/^202[5-6]-/);
    expect(tile.habitat.unbuilt).toEqual(['n39_w106','n40_w106','n44_w124','n43_w123'].includes(id)?[]:['access']);
    expect(tile.publicLands.status).toBe('AVAILABLE');
    expect(tile.publicLands.properties).toBeGreaterThan(0);
    expect(tile.fire.status).toBe('AVAILABLE');
    expect(tile.fire.perimeters).toBeGreaterThan(0);
    expect(tile.access).toBe('AVAILABLE');
    for(const layer of ['habitat','publicLands','fire']){
      expect(tile[layer].fetch.status).toBe(200);
      expect(tile[layer].fetch.matches).toBe(true);
    }
  }
  expect(result.coverage).toEqual(expect.arrayContaining(['n44_w124','n43_w123']));
  expect(result.profiles.pnw).toBeGreaterThanOrEqual(2);
  expect(result.states.OR).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
test('PNW tiles load beside earlier western and legacy tiles despite the new hemlock column',async({page})=>{
  test.setTimeout(180000);
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__);
  const result=await page.evaluate(async()=>{
    const t=window.__FRUITING_FORECAST_TEST__,s=t.getState();
    const conn=await t.initDuckDB();
    const manifest=await t.gisManifest(true);
    const pick=id=>(manifest.tiles||[]).find(x=>x.id===id);
    // Newest wider schema first: this is the mixed-schema case the app must survive.
    const urls=['n44_w124','n39_w106','n37_w107'].map(id=>pick(id).habitat.url);
    const names=[];
    for(let i=0;i<urls.length;i++){
      const response=await fetch('data/fruiting-forecast/'+urls[i]);
      names.push('f'+i);
      await s.gis.duckdb.registerFileBuffer('f'+i,new Uint8Array(await response.arrayBuffer()));
    }
    const list=names.map(n=>"'"+n+"'").join(',');
    const conv=r=>r.toArray().map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v])));
    const union=conv(await conn.query('SELECT count(*) n, count(canopy) canopy, sum(hemlock_sitka_spruce_signal) hemlock, sum(douglas_fir_signal) douglas FROM read_parquet(['+list+'], union_by_name=true)'));
    let mixedWithout=null;
    try{await conn.query('SELECT * FROM read_parquet(['+list+'])')}catch(e){mixedWithout=e.message}
    const pnw=conv(await conn.query("SELECT count(*) n, sum(hemlock_sitka_spruce_signal) hemlock, sum(douglas_fir_signal) douglas, sum(fir_spruce_mountain_hemlock_signal) fir FROM read_parquet('"+names[0]+"')"));
    return {union,mixedWithout,pnw};
  });
  expect(result.union[0].n).toBe(1200); // three 400-cell tiles
  expect(result.union[0].douglas).toBeGreaterThan(result.pnw[0].douglas); // the southern-Rockies tiles contribute too
  // The hemlock/Sitka-spruce signal exists only in the PNW tile; older tiles read NULL.
  expect(result.union[0].hemlock).toBe(result.pnw[0].hemlock);
  // Current DuckDB reads differing schemas by name even without union_by_name; the
  // app still requests union_by_name explicitly and the union must load fully.
  expect(result.union[0].n).toBe(1200);
  expect(result.pnw[0].n).toBe(400);
  expect(result.pnw[0].douglas).toBeGreaterThan(200); // Douglas-fir dominates the mapped Coast Range tile
});
test('a real PNW search loads the canary tile and ranks Pacific Northwest targets',async({page})=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{const u=new URL(r.request().url());const lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);const rows=lat.map((v,i)=>weatherPayload(v,lon[i]));return r.fulfill({json:rows.length===1?rows[0]:rows})});
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.locator('#radiusSelect').selectOption('25');
  await page.locator('#locationInput').fill('44.60, -123.50');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:200000});
  const r=await page.evaluate(()=>{
    const a=window.__FRUITING_FORECAST_TEST__.getState().analysis;
    return {profile:a.biology.profileId,ranked:a.ranked.map(x=>[x.speciesId,x.score,x.band]),tiles:a.gis.tiles,gis:a.gis.status,
      topReason:a.ranked[0]?a.ranked[0].reason:null,sectors:a.zones.length};
  });
  expect(r.profile).toBe('pnw');
  expect(r.tiles).toEqual(expect.arrayContaining(['n44_w124']));
  expect(r.gis).toBe('enhanced');
  expect(r.ranked.map(x=>x[0])).toEqual(expect.arrayContaining(['chanterelleFormosus','chanterelleSubalbidus','matsutakeMurrillianum','craterelleNeotubaeformis','morelBurn']));
  expect(r.ranked.map(x=>x[0])).not.toContain('porcini');
  expect(errors).toEqual([]);
});
test('a Columbia cross-state search loads both states, dedupes access and reuses the cache warm',async({page})=>{
  test.setTimeout(300000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let parquetRequests=0;
  page.on('request',r=>{if(/data\/fruiting-forecast\/(habitat|pl|ap|fire)\/.*\.parquet/.test(r.url()))parquetRequests++});
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{const u=new URL(r.request().url());const lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);const rows=lat.map((v,i)=>weatherPayload(v,lon[i]));return r.fulfill({json:rows.length===1?rows[0]:rows})});
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.locator('#radiusSelect').selectOption('50');
  await page.locator('#locationInput').fill('45.63, -122.65');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:200000});
  const cold=parquetRequests;
  const r=await page.evaluate(()=>{
    const t=window.__FRUITING_FORECAST_TEST__,s=t.getState();
    const shared=(s.gis.manifest? (s.gis.manifest.tiles||[]).find(x=>x.id==='n45_w123'):null);
    const soilStates=shared? [...new Set((shared.habitat.sources||[]).filter(x=>x.id==='ssurgo_sda').map(x=>x.state))] : [];
    const a=s.analysis,props=s.gis.properties||[];
    const stateOf=c=>{const p=props.find(g=>g.id===c.id);return p&&p.stateCode||null};
    const accessRows=(a.candidates||[]).flatMap(c=>c.accessPoints||[]);
    return {profile:a.biology.profileId,tiles:s.gis.tiles.map(x=>x.id),gis:a.gis.status,
      ranked:a.ranked.map(x=>x.speciesId),species:a.ranked.length,
      orProperties:(a.candidates||[]).filter(c=>stateOf(c)==='OR').length,
      waProperties:(a.candidates||[]).filter(c=>stateOf(c)==='WA').length,
      jurisdictions:[...new Set((a.candidates||[]).map(c=>c.rule.collectingStatus))],
      accessUnique:new Set(accessRows.map(x=>x.accessId)).size,
      accessRows:accessRows.length,
      starts:(a.candidates||[]).filter(c=>c.suggestedStart).slice(0,5).map(c=>({property:c.name,state:stateOf(c),start:c.suggestedStart.name,grade:c.suggestedStart.evidenceGrade||c.suggestedStart.confidence,accessId:c.suggestedStart.accessId})),
      soilStates};
  });
  const warmBefore=parquetRequests;
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:200000});
  const warmRequests=parquetRequests-warmBefore;
  console.log('PNW_COLUMBIA '+JSON.stringify({...r,coldRequests:cold,warmRequests}));
  expect(r.profile).toBe('pnw');
  expect(r.tiles).toEqual(expect.arrayContaining(['n45_w123','n45_w122','n44_w123']));
  expect(r.tiles.some(id=>id.startsWith('n46_'))).toBe(true); // Washington row loads
  expect(r.gis).toBe('enhanced');
  expect(r.ranked).toEqual(expect.arrayContaining(['chanterelleFormosus','chanterelleSubalbidus','matsutakeMurrillianum','craterelleNeotubaeformis','morelBurn']));
  expect(r.ranked).not.toContain('porcini'); // ecological, not administrative selection
  // Per-property access views may repeat evidence shared through an ambiguous
  // property association; map pins deduplicate by stable accessId, so repeats
  // stay few and the same feature is never published twice across tiles.
  expect(r.accessRows).toBeGreaterThan(500);
  expect(r.accessRows - r.accessUnique).toBeLessThan(20);
  expect(r.soilStates).toEqual(expect.arrayContaining(['OR','WA'])); // shared tile composes both soils
  expect(r.jurisdictions).toEqual(['UNKNOWN_VERIFY']); // no invented rules on either side
  expect(warmRequests).toBe(0); // warm repeat fetches zero GIS bytes
  expect(errors).toEqual([]);
});
