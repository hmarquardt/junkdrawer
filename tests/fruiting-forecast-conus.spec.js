const {test,expect}=require('@playwright/test');
const path=require('path');
const {spawn}=require('child_process');
test.use({channel:'chrome'});
function weatherPayload(lat = 39.1653, lon = -86.5264) {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dates = [];
  for (let i = -30; i <= 7; i++) dates.push(new Date(day.getTime() + i * 86400000).toISOString().slice(0, 10));
  const hours = [];
  for (let i = -30 * 24; i <= 7 * 24; i++) hours.push(new Date(day.getTime() + i * 3600000).toISOString().slice(0, 13) + ':00');
  return {
    latitude: lat, longitude: lon, elevation: 235, timezone: 'America/Indiana/Indianapolis',
    daily: {
      time: dates,
      precipitation_sum: dates.map((_, i) => i > 20 && i < 29 ? 0.18 : (i === 29 ? 0.65 : 0)),
      temperature_2m_max: dates.map(() => 78), temperature_2m_min: dates.map(() => 60),
      et0_fao_evapotranspiration: dates.map(() => 0.12)
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map(() => 69), relative_humidity_2m: hours.map(() => 78),
      dew_point_2m: hours.map(() => 62), precipitation: hours.map(() => 0),
      soil_temperature_0cm: hours.map(() => 66), soil_moisture_0_to_1cm: hours.map(() => 0.29),
      vapour_pressure_deficit: hours.map(() => 0.65), wind_speed_10m: hours.map(() => 5)
    }
  };
}

async function open(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{const u=new URL(r.request().url());const lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);const rows=lat.map((v,i)=>({...weatherPayload(v,lon[i]),elevation:3000}));return r.fulfill({json:rows.length===1?rows[0]:rows})});
  await page.goto('file://'+path.resolve('fruiting-forecast.html'));
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  return errors;
}
const places=[['Indiana',38.3553,-87.5675,'hardwood'],['Colorado',39.48,-106.05,'southernRockies'],['PNW',47.6,-123.5,'pnw'],['California',38.5,-122.7,'california'],['Great Lakes',46.5,-89.5,'northernForests'],['Southeast',31.5,-83.5,'southeast'],['Plains',38.5,-100.5,'plains'],['Sonoran Desert',33.5,-112.1,'warmDesert'],['Columbia Plateau',46.8,-119.2,'coldBasins']];
for(const [name,lat,lon,expected] of places)test(name+' resolves using EPA polygons',async({page})=>{const errors=await open(page);const result=await page.evaluate(([lat,lon])=>{const t=__FRUITING_FORECAST_BIO_TEST__,b=t.resolveBiology(lat,lon);return {b,ids:t.regionalSpecies(b).map(s=>s.id)}},[lat,lon]);expect(result.b.profileId).toBe(expected);expect(result.b.ecoregionCode).toBeTruthy();if(expected==='southernRockies')expect(result.ids).toEqual(['porcini','chanterelleRoseocanus','morelNatural','morelBurn']);if(expected==='pnw')expect(result.ids).toEqual(['chanterelleFormosus','chanterelleSubalbidus','matsutakeMurrillianum','craterelleNeotubaeformis','morelBurn']);if(expected==='northernForests')expect(result.ids).toEqual(['morel','chanterelle','chicken','maitake','oyster','puffball','hericium']);if(expected==='southeast')expect(result.ids).toEqual(['chanterelleLateritius','honeyRingless','morel','chicken','oyster','maitake','puffball','hericium']);if(expected==='california')expect(result.ids).toEqual(['chanterelleCalifornicus','craterellusCalicornucopioides','lactariusRubidus','morel']);if(!['hardwood','southernRockies','pnw','northernForests','southeast','california'].includes(expected))expect(result.ids).toEqual([]);expect(errors).toEqual([])});
test('Colorado analysis and unsupported geography never expose Midwest scores',async({page})=>{
 const errors=await open(page);
 for(const [coords,count] of [['38.3553, -87.5675',7],['39.48, -106.05',4],['33.5, -112.1',0]]){
 await page.locator('#locationInput').fill(coords);await page.locator('#analyzeBtn').click();await expect(page.locator('#status')).toContainText('Analysis ready');await expect(page.locator('.rank-card')).toHaveCount(count);
 if(count===4){await expect(page.locator('#rankedList')).toContainText('Porcini');await expect(page.locator('#topBet')).toContainText('Southern Rockies');await expect(page.locator('#detailContent')).toContainText('Not calibrated');await page.screenshot({path:'/private/tmp/ff-colorado.png',fullPage:true})}
 // The Sonoran point is modeled sparse (Warm Deserts), not unsupported.
 if(!count)await expect(page.locator('#topBet')).toContainText('Modeled · sparse');
 }
 expect(errors).toEqual([]);
});
test('regional score is deterministic, elevation matters and missing physiology stays missing',async({page})=>{
 const errors=await open(page);const r=await page.evaluate(()=>{const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__,sp=b.regionalSpecies(b.resolveBiology(39.48,-106.05))[0],zone={point:{searchRadius:25},metrics:{rain7:2,soilTemp:65,airTemp:65,soilMoisture:.3},elevation:3000};const score=e=>t.scoreSpecies(sp,{...zone,elevation:e},null,new Date(2026,7,15));return {high:score(3000),low:score(1200),missing:score(null),repeat:score(3000)}});
 expect(r.high).toEqual(r.repeat);expect(r.high.score).toBeGreaterThan(r.low.score);expect(r.high.components.moisture).toBeNull();expect(r.high.components.temperature).toBeNull();expect(r.missing.components.elevation).toBeNull();expect(r.high.confidence.label).not.toBe('High');expect(errors).toEqual([]);
});
test('coverage excludes placeholders and honors explicit verified-empty semantics',async({page})=>{await open(page);expect(await page.evaluate(()=>{const t=__FRUITING_FORECAST_CACHE_TEST__;return [t.layerStatus({url:'empty',properties:0},'properties'),t.layerUsable({url:'empty',properties:0},'properties'),t.layerStatus({status:'VERIFIED_EMPTY',properties:0},'properties'),t.layerUsable({url:'bad',status:'FAILED'},'properties')]})).toEqual(['UNBUILT',false,'VERIFIED_EMPTY',false])});
test('byte cache invalidates by version and falls back when IndexedDB fails',async({page})=>{
 await open(page);let requests=0;await page.route('**/cache-fixture.parquet',r=>{requests++;return r.fulfill({body:Buffer.from([1,2,3])})});
 const run=(version,broken=false)=>page.evaluate(async({version,broken})=>{const s=__FRUITING_FORECAST_TEST__.getState();s.gis.manifest={datasetVersion:version};if(broken)s.db={transaction(){throw new Error('storage denied')}};return Array.from(new Uint8Array(await __FRUITING_FORECAST_CACHE_TEST__.gisAssetBytes('n39_w107~habitat',{url:'cache-fixture.parquet',bytes:3},false)))},{version,broken});
 expect(await run('v1')).toEqual([1,2,3]);await run('v1');expect(requests).toBe(1);await run('v2');expect(requests).toBe(2);await run('v3',true);expect(requests).toBe(3);
});
test('failed collecting rules retain named public-land geometry',async({page})=>{
 const errors=await open(page);
 await page.route('**/rules-outage.json',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.route('**/fixture.parquet',r=>r.fulfill({body:Buffer.from([1,2,3])}));
 const result=await page.evaluate(async()=>{
 const t=__FRUITING_FORECAST_TEST__,s=t.getState();
 const manifest={schemaVersion:4,datasetVersion:'fixture',collectingRules:{url:'rules-outage.json'},tiles:[{id:'n38_w088',bbox:[-88,38,-87,39],habitat:{status:'UNBUILT'},publicLands:{status:'PARTIAL',properties:1,url:'fixture.parquet'}}]};
 await new Promise((resolve,reject)=>{const tx=s.db.transaction('cache','readwrite');tx.objectStore('cache').put({key:'gis-manifest',savedAt:Date.now(),value:manifest});tx.oncomplete=resolve;tx.onerror=reject});
 s.gis.persistent=true;s.gis.duckdb={registerFileBuffer:async()=>{}};
 s.gis.conn={query:async sql=>({toArray:()=>sql.includes('property_id IS NOT NULL')?[{property_id:'test',property_name:'Test public land',manager:'Unresearched agency',property_type:'Protected Area',ownership_class:'PUBLIC',access_class:'PUBLIC',geometry_json:JSON.stringify({type:'Polygon',coordinates:[[[-87.6,38.3],[-87.5,38.3],[-87.5,38.4],[-87.6,38.4],[-87.6,38.3]]]}),min_lon:-87.6,min_lat:38.3,max_lon:-87.5,max_lat:38.4,center_lat:38.35,center_lon:-87.55}]:[]})};
 const out=await t.HabitatProvider.fetch([{id:'center',lat:38.35,lon:-87.55}],{lat:38.35,lon:-87.55},25,null,false);
 return {count:out._properties.length,status:out._properties[0]?.rule.collectingStatus,habitat:out.center,rules:out._rules};
 });
 expect(result.count).toBe(1);expect(result.status).toBe('UNKNOWN_VERIFY');expect(result.habitat).toBeNull();expect(result.rules.error).toContain('503');expect(errors).toEqual([]);
});
test('cross-tile aggregation keeps distinct properties and deduplicates the same unit',async({page})=>{
 const errors=await open(page);
 await page.route('**/co-pl.parquet',r=>r.fulfill({body:Buffer.from([1])}));
 await page.route('**/nm-pl.parquet',r=>r.fulfill({body:Buffer.from([1])}));
 await page.route('**/tile-fire.parquet',r=>r.fulfill({body:Buffer.from([1])}));
 const result=await page.evaluate(async()=>{
  const t=__FRUITING_FORECAST_TEST__,h=__FRUITING_FORECAST_HUNTABILITY_TEST__,s=t.getState();
  const mk=(id,name,state,conf,lon,lat)=>({property_id:id,property_name:name,manager:'Forest Service',property_type:'National Forest',ownership_class:'PUBLIC',access_class:'PUBLIC',state_name:state,state_code:state,jurisdiction_confidence:conf,geometry_json:JSON.stringify({type:'Polygon',coordinates:[[[lon-.1,lat-.1],[lon+.1,lat-.1],[lon+.1,lat+.1],[lon-.1,lat+.1],[lon-.1,lat-.1]]]}),min_lon:lon-.1,min_lat:lat-.1,max_lon:lon+.1,max_lat:lat+.1,center_lat:lat,center_lon:lon});
  const coRows=[mk('p1','Twin Lakes','CO','authoritative',-105.5,37.5),mk('p2','Shared Unit','CO','authoritative',-105.4,37.4)];
  const nmRows=[mk('p3','Twin Lakes','NM','authoritative',-105.5,36.9),mk('p2','Shared Unit','CO','authoritative',-105.4,37.4)];
  const geom=JSON.stringify({type:'Polygon',coordinates:[[[-105.6,36.9],[-105.3,36.9],[-105.3,37.1],[-105.6,37.1],[-105.6,36.9]]]});
  const fire=[{perimeter_id:'COFIREx',fire_name:'Shared Fire',fire_year:2018,severity:null,geometry_json:geom,min_lon:-105.6,min_lat:36.9,max_lon:-105.3,max_lat:37.1,source_id:'MTBS',source_url:'https://www.mtbs.gov/x',retrieved_at:'2026-09-15'}];
  s.gis.persistent=true;s.gis.duckdb={registerFileBuffer:async()=>{}};
  s.gis.conn={query:async sql=>{
    if(sql.includes('property_id IS NOT NULL'))return {toArray:()=>sql.includes('n37_w106_pl')?coRows:nmRows};
    if(sql.includes('perimeter_id IS NOT NULL'))return {toArray:()=>sql.includes('n37_w106_fire')?fire:fire.slice(0,1)};
    return {toArray:()=>[]};
  }};
  const tiles=[
    {id:'n37_w106',bbox:[-106,37,-105,38],publicLands:{status:'AVAILABLE',url:'co-pl.parquet',properties:2},fireHistory:{status:'AVAILABLE',url:'tile-fire.parquet',perimeters:1}},
    {id:'n36_w106',bbox:[-106,36,-105,37],publicLands:{status:'AVAILABLE',url:'nm-pl.parquet',properties:2},fireHistory:{status:'AVAILABLE',url:'tile-fire.parquet',perimeters:1}}];
  const props=await h.publicLandRows(s.gis.conn,{schemaVersion:4,tiles:[]},{lat:37.2,lon:-105.5},60,null,false,tiles);
  const fireOut=await h.fireRows(s.gis.conn,null,tiles);
  return {props:props.map(p=>({name:p.name,state:p.stateCode,id:p.id})),fire:fireOut.perimeters.map(f=>f.perimeterId)};
 });
 // Same name in two states is two legitimate properties; one unit across tiles is one record.
 expect(result.props.filter(p=>p.name==='Twin Lakes').length).toBe(2);
 expect(result.props.filter(p=>p.name==='Shared Unit').length).toBe(1);
 expect(result.fire.filter(id=>id==='COFIREx').length).toBe(1);
 expect(result.fire).toEqual(expect.arrayContaining(['COFIREx']));
 expect(errors).toEqual([]);
});
test('historical plausibility and disturbance contracts never turn missing evidence into absence',async({page})=>{
 await open(page);const r=await page.evaluate(()=>{const t=__FRUITING_FORECAST_BIO_TEST__;return {missing:t.historicalPlausibility(null),sparse:t.historicalPlausibility({status:'AVAILABLE',records:0,distinctYears:0}),repeated:t.historicalPlausibility({status:'AVAILABLE',records:10,distinctYears:3}),fire:t.disturbanceEvidence(null),known:t.disturbanceEvidence({status:'AVAILABLE',fireYear:2025,sourceUrl:'https://example.gov/fire'},new Date(2026,7,1))}});
 expect(r.missing.penalty).toBe(0);expect(r.sparse.penalty).toBe(0);expect(r.repeated.supportsPresence).toBe(true);expect(r.fire).toBeNull();expect(r.known.yearsSinceFire).toBe(1);expect(r.known.severity).toBeNull();
});
test('unsupported taxa return no score and regional selections are available explicitly',async({page})=>{
 await open(page);await expect(page.locator('#speciesSelect option[value="porcini"]')).toHaveCount(1);
 expect(await page.evaluate(()=>__FRUITING_FORECAST_TEST__.scoreSpecies({id:'unmodeled',applicability:'UNSUPPORTED'}).score)).toBeNull();
});

// Southern Rockies regional model cases: deterministic, no live services.
async function coloradoScore(page,{id,month,elevationM,habitat,rain14,wetDays14,daysSinceRain}){
  return page.evaluate(({id,month,elevationM,habitat,rain14,wetDays14,daysSinceRain})=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(39.48,-106.05)).find(x=>x.id===id);
    const zone={point:{searchRadius:25},elevation:elevationM,habitat,
      metrics:{rain14,rain7:rain14*.7,rain10:rain14*.9,daysSinceRain,wetDays14,soilMoisture:.25,soilTemp:64,airTemp:66,humidity:70,vpd:.7,wind:5,et07:.6}};
    const s=t.scoreSpecies(sp,zone,null,new Date(2026,month-1,15));
    return {score:s.score,band:s.band,confidence:s.confidence,components:s.components,missing:s.missing,evidenceGap:s.evidenceGap,reason:s.reason};
  },{id,month,elevationM,habitat,rain14,wetDays14,daysSinceRain});
}
const coniferHabitat={available:true,sampleCells:24,forest:{cover:.62,canopy:null,dominantClass:'lodgepole_pine'},hosts:{spruceFir:0,firSpruceMountainHemlock:.5,lodgepolePine:.4,ponderosaPine:.1,douglasFir:0,aspenBirch:0,mappedCoverage:.9},soil:{},terrain:{elevationMedianFt:10000},access:{},confidence:{cellCoverage:1,hostQuality:.65,soilCoverage:0}};
const deciduousHabitat={available:true,sampleCells:24,forest:{cover:.62,canopy:null,dominantClass:'oak_hickory'},hosts:{oakHickory:.85,beechMaple:.1,elmAshCottonwood:.05,spruceFir:0,firSpruceMountainHemlock:0,lodgepolePine:0,mappedCoverage:.9},soil:{},terrain:{elevationMedianFt:10000},access:{},confidence:{cellCoverage:1,hostQuality:.65,soilCoverage:0}};

test('Southern Rockies porcini uses real habitat and elevation evidence, not elevation alone',async({page})=>{
  const errors=await open(page);
  const ideal=await coloradoScore(page,{id:'porcini',month:8,elevationM:3000,habitat:coniferHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const low=await coloradoScore(page,{id:'porcini',month:8,elevationM:1300,habitat:coniferHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const wrongHabitat=await coloradoScore(page,{id:'porcini',month:8,elevationM:3000,habitat:deciduousHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const offSeason=await coloradoScore(page,{id:'porcini',month:2,elevationM:3000,habitat:coniferHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const dry=await coloradoScore(page,{id:'porcini',month:8,elevationM:3000,habitat:coniferHabitat,rain14:.02,wetDays14:0,daysSinceRain:25});
  expect(ideal.components.habitat).toBeGreaterThan(wrongHabitat.components.habitat);
  expect(ideal.score).toBeGreaterThan(wrongHabitat.score);
  expect(ideal.score).toBeGreaterThan(low.score);
  expect(ideal.score).toBeGreaterThan(dry.score);
  expect(offSeason.score).toBe(0);
  expect(ideal.components.elevation).toBeGreaterThan(low.components.elevation);
  expect(ideal.missing).toContain('temperature');
  expect(ideal.components.temperature).toBeNull();
  expect(ideal.confidence.label).not.toBe('High');
  expect(errors).toEqual([]);
});

test('missing host, weather and fire evidence omit components instead of scoring zero',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(39.48,-106.05)).find(x=>x.id==='porcini');
    const zone={point:{searchRadius:25},elevation:3000,habitat:null,metrics:{rain14:1.2,wetDays14:5,daysSinceRain:3,soilMoisture:.25,soilTemp:64,airTemp:66}};
    return t.scoreSpecies(sp,zone,null,new Date(2026,7,15));
  });
  expect(r.components.habitat).toBeNull();
  expect(r.components.habitat).not.toBe(0);
  expect(r.missing).toContain('habitat');
  expect(r.confidence.score).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test('Southern Rockies chanterelle and natural morel answer season and habitat cases',async({page})=>{
  const errors=await open(page);
  const chanterelle=await coloradoScore(page,{id:'chanterelleRoseocanus',month:8,elevationM:2900,habitat:coniferHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const chanterelleDeciduous=await coloradoScore(page,{id:'chanterelleRoseocanus',month:8,elevationM:2900,habitat:deciduousHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const chanterelleLow=await coloradoScore(page,{id:'chanterelleRoseocanus',month:8,elevationM:1400,habitat:coniferHabitat,rain14:1.2,wetDays14:5,daysSinceRain:3});
  const natural=await coloradoScore(page,{id:'morelNatural',month:6,elevationM:2600,habitat:coniferHabitat,rain14:1,wetDays14:4,daysSinceRain:4});
  const naturalOffSeason=await coloradoScore(page,{id:'morelNatural',month:9,elevationM:2600,habitat:coniferHabitat,rain14:1,wetDays14:4,daysSinceRain:4});
  expect(chanterelle.components.habitat).toBeGreaterThan(chanterelleDeciduous.components.habitat);
  expect(chanterelle.score).toBeGreaterThan(chanterelleDeciduous.score);
  expect(chanterelle.score).toBeGreaterThan(chanterelleLow.score);
  expect(natural.score).toBeGreaterThan(0);
  expect(naturalOffSeason.score).toBe(0);
  expect(natural.evidenceGap).toBeNull();
  expect(natural.components.disturbance).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Colorado never ranks the seven eastern targets and Indiana behavior is unchanged',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    return {co:b.regionalSpecies(b.resolveBiology(39.48,-106.05)).map(s=>s.id),
            indiana:b.regionalSpecies(b.resolveBiology(38.3553,-87.5675)).map(s=>s.id)};
  });
  for(const eastern of ['morel','chanterelle','chicken','maitake','oyster','puffball','lobster'])expect(r.co).not.toContain(eastern);
  expect(r.co).toHaveLength(4);
  expect(r.indiana).toHaveLength(7);
  expect(r.indiana).toEqual(expect.arrayContaining(['morel','chanterelle','chicken']));
  expect(errors).toEqual([]);
});

test('burn morels decline to forecast without burn evidence and score real fire evidence when present',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(39.48,-106.05)).find(x=>x.id==='morelBurn');
    const base={point:{searchRadius:25},elevation:2600,habitat:null,metrics:{rain14:1,rain7:.7,rain10:.9,daysSinceRain:4,wetDays14:4,soilMoisture:.25,soilTemp:64,airTemp:66}};
    const perimeter={perimeterId:'p1',fireYear:2024,bbox:[-106,40,-105.5,40.5],geometry:{type:'Polygon',coordinates:[[[-106,40],[-105.5,40],[-105.5,40.5],[-106,40.5],[-106,40]]]}};
    const far={perimeterId:'p2',fireYear:2024,bbox:[-100,38,-99,39],geometry:{type:'Polygon',coordinates:[[[-100,38],[-99,38],[-99,39],[-100,39],[-100,38]]]}};
    return {
      unavailable:t.scoreSpecies(sp,{...base,disturbance:{status:'UNAVAILABLE',reason:'Fire history layer is not published for this area'}},null,new Date(2026,5,15)),
      noMatch:t.scoreSpecies(sp,{...base,disturbance:{status:'MAP_AVAILABLE_NO_MATCH',mappedPerimeters:4,reason:'No mapped large fire applies to this sector'}},null,new Date(2026,5,15)),
      oneYear:t.scoreSpecies(sp,{...base,disturbance:{status:'AVAILABLE',fireYear:2025,perimeterId:'CO-test',name:'Test fire',severity:null,sourceUrl:'https://www.mtbs.gov/x',distanceMi:0}},null,new Date(2026,5,15)),
      fiveYears:t.scoreSpecies(sp,{...base,disturbance:{status:'AVAILABLE',fireYear:2021,perimeterId:'old',severity:null,sourceUrl:'https://www.mtbs.gov/x',distanceMi:2}},null,new Date(2026,5,15)),
      burn:b.burnResponseScore(b.morelBurnResponse,{status:'AVAILABLE',fireYear:2025,severity:null},new Date(2026,5,15)),
      inside:b.zoneDisturbance({status:'AVAILABLE',perimeters:[perimeter]},{lat:40.2,lon:-105.7},8,new Date(2026,5,15)),
      distant:b.zoneDisturbance({status:'AVAILABLE',perimeters:[far]},{lat:40.2,lon:-105.7},8,new Date(2026,5,15)),
      nonePublished:b.zoneDisturbance({status:'UNAVAILABLE',reason:'No fire-history layer is published for this area'},{lat:40.2,lon:-105.7},8,new Date(2026,5,15))
    };
  });
  expect(r.burn).toBe(100);
  expect(r.unavailable.components.disturbance).toBeNull();
  expect(r.unavailable.band).toBe('Fire evidence unavailable');
  expect(r.unavailable.score).toBeLessThanOrEqual(25);
  expect(r.unavailable.evidenceGap).toContain('not published');
  expect(r.noMatch.score).toBeLessThanOrEqual(25);
  expect(r.noMatch.evidenceGap).toContain('No mapped large fire');
  expect(r.oneYear.components.disturbance).toBe(100);
  expect(r.oneYear.score).toBeGreaterThan(r.unavailable.score);
  expect(r.oneYear.band).not.toBe('Fire evidence unavailable');
  expect(r.fiveYears.components.disturbance).toBe(0);
  expect(r.inside.perimeterId).toBe('p1');
  expect(r.inside.distanceMi).toBe(0);
  expect(r.distant.status).toBe('MAP_AVAILABLE_NO_MATCH');
  expect(r.nonePublished.status).toBe('UNAVAILABLE');
  expect(errors).toEqual([]);
});

test('collecting rules cannot leak across a state line',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const h=window.__FRUITING_FORECAST_HUNTABILITY_TEST__,b=window.__FRUITING_FORECAST_BIO_TEST__;
    const rules={verifiedAt:'2026-09-01',rules:[
      {id:'indiana-state-forest',jurisdiction:{state:'IN'},scope:{managerContains:'State Department of Natural Resources',propertyType:'State Forest'},collectingStatus:'ALLOWED_WITH_LIMITS',sourceUrl:'https://example.gov/in'},
      {id:'global-note',scope:{propertyType:'National Forest'},collectingStatus:'PERMIT_REQUIRED',sourceUrl:'https://example.gov/global'}]};
    const colorado={name:'Colorado State Forest',manager:'Colorado State Department of Natural Resources',propertyType:'State Forest',ownershipClass:'PUBLIC',stateCode:'CO',stateName:'Colorado',center:{lat:40.3,lon:-105.6}};
    const indiana={name:'Pike State Forest',manager:'Indiana State Department of Natural Resources',propertyType:'State Forest',ownershipClass:'PUBLIC',center:{lat:38.35,lon:-87.57}};
    const unknownState={name:'Unlisted Place',manager:'State Department of Natural Resources',propertyType:'State Forest',ownershipClass:'PUBLIC',center:{lat:null,lon:null}};
    const globalOnly={name:'Unnamed Tract',manager:'Bureau of Land Management',propertyType:'National Forest',ownershipClass:'PUBLIC',center:{lat:40.3,lon:-105.6}};
    return {
      colorado:h.resolveCollectingRule(colorado,rules).collectingStatus,
      coloradoJurisdiction:h.resolveCollectingRule(colorado,rules).jurisdiction,
      indiana:h.resolveCollectingRule(indiana,rules).id,
      indianaStatus:h.resolveCollectingRule(indiana,rules).collectingStatus,
      indianaJurisdiction:h.resolveCollectingRule(indiana,rules).jurisdiction,
      unknown:h.resolveCollectingRule(unknownState,rules).collectingStatus,
      global:h.resolveCollectingRule(globalOnly,rules).collectingStatus,
      ruleMatchIndiana:h.ruleMatches(rules.rules[0],indiana,{code:'IN'}),
      ruleMatchColorado:h.ruleMatches(rules.rules[0],colorado,{code:'CO'}),
      derivedColorado:b.stateAt(-105.6,40.3).code,
      derivedIndiana:b.stateAt(-87.57,38.35).code,
      propertyJurisdiction:b.propertyJurisdiction(indiana).code,
      lookupMethod:b.propertyJurisdiction(indiana).method
    };
  });
  expect(r.colorado).toBe('UNKNOWN_VERIFY');
  expect(r.coloradoJurisdiction.code).toBe('CO');
  expect(r.indiana).toBe('indiana-state-forest');
  expect(r.indianaStatus).toBe('ALLOWED_WITH_LIMITS');
  expect(r.indianaJurisdiction.code).toBe('IN');
  expect(r.unknown).toBe('UNKNOWN_VERIFY');
  expect(r.global).toBe('PERMIT_REQUIRED');
  expect(r.ruleMatchIndiana).toBe(true);
  expect(r.ruleMatchColorado).toBe(false);
  expect(r.derivedColorado).toBe('CO');
  expect(r.derivedIndiana).toBe('IN');
  expect(r.propertyJurisdiction).toBe('IN');
  expect(r.lookupMethod).toBe('Census state boundary lookup');
  expect(errors).toEqual([]);
});

test('a radius crossing an ecological boundary scores every sector with its own regional profile',async({page})=>{
  const errors=await open(page);
  await page.locator('#radiusSelect').selectOption('100');
  await page.locator('#locationInput').fill('37.5, -104.0');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready');
  const r=await page.evaluate(()=>{
    const a=window.__FRUITING_FORECAST_TEST__.getState().analysis;
    const zone=(id)=>(a.zones.find(z=>z.id===id)||{scores:[]});
    return {center:a.biology.profileId,zoneProfiles:Object.keys(a.zoneBiology).map(k=>[k,a.zoneBiology[k].profileId]),
      sectorBiologyCount:a.sectorBiologyCount,targets:a.speciesConfiguration.map(x=>x.id),
      ranked:a.ranked.map(x=>x.speciesId),
      westScores:zone('z270').scores.map(s=>s.speciesId),eastScores:zone('z90').scores.map(s=>s.speciesId),
      meta:document.querySelector('#analysisMeta').textContent};
  });
  expect(r.center).toBe('plains');
  expect(r.zoneProfiles.find(x=>x[0]==='z270')[1]).toBe('southernRockies');
  expect(r.sectorBiologyCount).toBe(2);
  expect(r.targets).toEqual(['porcini','chanterelleRoseocanus','morelNatural','morelBurn']);
  expect(r.ranked).toEqual(expect.arrayContaining(['porcini','chanterelleRoseocanus']));
  expect(r.westScores).toEqual(expect.arrayContaining(['porcini','chanterelleRoseocanus']));
  expect(r.eastScores).toEqual([]);
  expect(r.meta).toContain('2 regional models across sectors');
  expect(errors).toEqual([]);
});

// End-to-end artifact checks for the real published Colorado tiles: normalized source ->
// publisher -> manifest -> browser fetch. Parquet field content is asserted by
// tests/test_fruiting_bulk_adapters.py because DuckDB-Wasm is not guaranteed offline.
const artifactPort=8800+(process.pid%600);
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
const COLORADO_TILES=['n37_w106','n37_w107','n37_w108','n38_w106','n38_w107','n38_w108','n39_w106','n39_w107','n39_w108','n40_w106','n40_w107'];
const NEW_MEXICO_TILES=['n36_w107','n36_w106','n35_w106'];
// Bounded PNW production release, derived from pinned EPA Level III geometry by
// tools/fruiting_pnw_release.py (core >= 50% PNW share, halo 25-50% four-connected,
// state share >= 25%). Oregon: Coast Range, western Cascades, Willamette/foothills,
// Mt Hood boundary, southern Cascades/coast. Washington: Olympics, Puget lowlands,
// western Cascades, lower Columbia (two shared tiles), northwest Washington.
const PNW_OREGON_TILES=['n42_w123','n42_w125','n43_w123','n43_w124','n43_w125','n44_w122','n44_w123','n44_w124','n45_w122','n45_w123','n45_w124'];
const PNW_WASHINGTON_TILES=['n45_w122','n45_w123','n46_w122','n46_w123','n46_w124','n47_w122','n47_w123','n47_w124','n47_w125','n48_w123'];
const PNW_TILES=[...new Set([...PNW_OREGON_TILES,...PNW_WASHINGTON_TILES])];
// Wet westside/ocean tiles where the pinned MTBS service maps no >=1000-acre fire.
const PNW_OCEAN_TILES=['n43_w125','n46_w123','n46_w124','n47_w123','n47_w125','n48_w123'];
const ACCESS_TILES=['n39_w106','n40_w106',...PNW_TILES];
// Revision-13 Southwest canaries (madrean monsoon + modeled-sparse basins/deserts).
const SOUTHWEST_CANARY_TILES=['n35_w111','n46_w119','n33_w112'];
const RELEASE_TILES=[...NEW_MEXICO_TILES,...COLORADO_TILES,...PNW_TILES,...SOUTHWEST_CANARY_TILES].sort();
// Revision-10 national canaries (Northern Forests + Southeast vertical stack).
const NATIONAL_CANARY_TILES=['n45_w085','n45_w070','n30_w084','n32_w084'];
// Revision-11 interior canaries (Northern Rockies / Interior Mountains).
const INTERIOR_CANARY_TILES=['n47_w116','n44_w115','n43_w110'];
// Revision-12 California canaries (Mediterranean + Sierra Nevada).
const CALIFORNIA_CANARY_TILES=['n38_w122','n36_w121','n39_w121','n36_w119'];
test('bounded Southern Rockies release declares complete habitat with real soil and matching digests',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__);
  const result=await page.evaluate(async(RELEASE_TILES)=>{
    const t=window.__FRUITING_FORECAST_TEST__;
    const manifest=await t.gisManifest(true);
    const digest=async(url,baseline)=>{
      const response=await fetch('data/fruiting-forecast/'+url);
      const buffer=await response.arrayBuffer();
      const value=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
      return {status:response.status,bytes:buffer.byteLength,matches:value===baseline};
    };
    const release={};
    for(const id of RELEASE_TILES){
      const tile=(manifest.tiles||[]).find(x=>x.id===id);
      if(!tile){release[id]={missing:true};continue}
      release[id]={missing:false,bbox:tile.bbox,habitat:{status:tile.habitat.status,cells:tile.habitat.cells,components:tile.habitat.components,required:tile.habitat.requiredComponents,units:tile.habitat.units,unbuilt:tile.habitat.unbuilt,sources:(tile.habitat.sources||[]).map(x=>x.id)},publicLands:{status:tile.publicLands.status,properties:tile.publicLands.properties},fire:{status:tile.fireHistory.status,perimeters:tile.fireHistory.perimeters},access:{status:tile.accessPoints.status}};
    }
    const tiles={};
    for(const id of ['n40_w106','n37_w107']){ // representative digest checks
      const tile=(manifest.tiles||[]).find(x=>x.id===id);
      tiles[id]={habitat:await digest(tile.habitat.url,tile.habitat.sha256),publicLands:await digest(tile.publicLands.url,tile.publicLands.sha256),fire:await digest(tile.fireHistory.url,tile.fireHistory.sha256)};
    }
    const westernCounts=await t.aboutManifestCounts(manifest);
    return {release,tiles,westernCounts,summary:manifest.summary.layers.habitat,coverageTiles:manifest.summary.coverageTiles};
  },RELEASE_TILES);
  expect(result.coverageTiles).toEqual([...RELEASE_TILES,...NATIONAL_CANARY_TILES,...INTERIOR_CANARY_TILES,...CALIFORNIA_CANARY_TILES].sort());
  for(const id of RELEASE_TILES){
    const tile=result.release[id];
    expect(tile.missing).toBe(false);
    expect(tile.habitat.status).toBe('AVAILABLE');
    expect(tile.habitat.cells).toBe(400);
    expect(tile.habitat.units.elevation_ft).toBe('feet');
    expect(tile.habitat.units.canopy).toContain('fraction');
    // Real NRCS soil joins canopy and land cover: all five components are present.
    expect(tile.habitat.components.soil).toBe('AVAILABLE');
    expect(tile.habitat.components.canopy).toBe('AVAILABLE');
    expect(tile.habitat.components.landCover).toBe('AVAILABLE');
    expect(tile.habitat.unbuilt).toEqual(ACCESS_TILES.includes(id)?[]:['access']);
    expect(tile.habitat.sources).toContain('ssurgo_sda');
    expect(tile.publicLands.status).toBe('AVAILABLE');
    expect(tile.publicLands.properties).toBeGreaterThan(0);
    // The ocean-heavy southern coast tile declares an explicit verified empty
    // for fire; every other release tile carries mapped MTBS perimeters.
    if(PNW_OCEAN_TILES.includes(id)){
      expect(tile.fire.status).toBe('VERIFIED_EMPTY');
      expect(tile.fire.perimeters).toBe(0);
    }else{
      expect(tile.fire.status).toBe('AVAILABLE');
      expect(tile.fire.perimeters).toBeGreaterThan(0);
    }
    expect(tile.access.status).toBe(ACCESS_TILES.includes(id)?'AVAILABLE':'UNBUILT');
  }
  for(const id of ['n40_w106','n37_w107']){
    for(const layer of ['habitat','publicLands','fire']){
      expect(result.tiles[id][layer].status).toBe(200);
      expect(result.tiles[id][layer].matches).toBe(true);
    }
  }
  expect(result.summary.components.canopy.AVAILABLE).toBeGreaterThanOrEqual(RELEASE_TILES.length);
  expect(result.summary.components.soil.AVAILABLE).toBeGreaterThanOrEqual(RELEASE_TILES.length);
  expect(result.summary.components.soil.UNBUILT).toBe(0);
  expect(result.westernCounts.habitatComplete).toBeGreaterThanOrEqual(RELEASE_TILES.length);
  expect(errors).toEqual([]);
});
test('release summary derives bounded PNW production coverage without conflating dimensions',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__);
  const result=await page.evaluate(async(TILE_SET)=>{
    const t=window.__FRUITING_FORECAST_TEST__;
    const manifest=await t.gisManifest(true);
    const s=manifest.summary;
    return {coverageTiles:s.coverageTiles,publishedTiles:s.publishedTiles,profiles:s.ecologicalProfiles,states:s.states,
      habitat:s.layers.habitat,access:s.layers.access,fire:s.layers.fire,publicLand:s.layers['public-land'],
      pnwTiles:(manifest.tiles||[]).filter(x=>TILE_SET.includes(x.id))
        .map(x=>({id:x.id,habitat:x.habitat.status,pl:x.publicLands.status,fire:x.fireHistory.status,access:x.accessPoints.status,cells:x.habitat.cells,components:x.habitat.components}))};
  }, [...PNW_TILES,...INTERIOR_CANARY_TILES,...CALIFORNIA_CANARY_TILES]);
  // Derived dimensions, not hand-maintained numbers: 47 complete release tiles
  // (14 SR + 19 PNW + 4 + 3 + 4 + 3 canary sets through revision 13).
  expect(result.coverageTiles.length).toBe(47);
  expect(result.profiles.sierraNevada).toBe(4);
  expect(result.profiles.pnw).toBe(21); // 19 + the Klamath reassignment (78) now addressing two more published-tile bboxes
  expect(result.profiles.northernForests).toBe(2);
  // Profile counts are the documented bbox-approximate addressing dimension:
  // published-tile bboxes that touch interiorMountains ecoregion bboxes.
  expect(result.profiles.interiorMountains).toBe(14); // +1: the Columbia Plateau canary bbox touches Blue Mountains
  expect(result.states.MI).toBeGreaterThanOrEqual(1);
  expect(result.states.ME).toBeGreaterThanOrEqual(1);
  expect(result.states.FL).toBeGreaterThanOrEqual(1);
  expect(result.states.ID).toBeGreaterThanOrEqual(2);
  expect(result.states.WY).toBeGreaterThanOrEqual(1);
  expect(result.states.OR).toBeGreaterThanOrEqual(14);
  expect(result.states.WA).toBeGreaterThanOrEqual(11);
  expect(result.habitat.available).toBe(47);
  expect(result.publicLand.available).toBe(47);
  expect(result.access.available).toBe(35); // 32 + the three Southwest canaries
  expect(result.fire.verifiedEmpty).toBe(9); // wet westside/ocean/madrean-basin tiles declare it explicitly
  expect(result.fire.available).toBe(38);
  for(const tile of result.pnwTiles){
    expect(tile.habitat).toBe('AVAILABLE');
    expect(tile.cells).toBe(400);
    expect(Object.values(tile.components)).toEqual(['AVAILABLE','AVAILABLE','AVAILABLE','AVAILABLE','AVAILABLE']);
    expect(tile.pl).toBe('AVAILABLE');
    expect(tile.access).toBe('AVAILABLE');
    expect(['AVAILABLE','VERIFIED_EMPTY']).toContain(tile.fire);
  }
  expect(result.pnwTiles.filter(t=>t.fire==='VERIFIED_EMPTY').map(t=>t.id).sort())
    .toEqual([...PNW_OCEAN_TILES].sort());
  expect(errors).toEqual([]);
});
test('both western tiles and a legacy eastern tile load together in DuckDB-Wasm',async({page})=>{
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
    // Wide schema first on purpose: this is the mixed-schema case the app must survive.
    const urls=['n40_w106','n39_w106','n37_w088'].map(id=>pick(id).habitat.url);
    const names=[];
    for(let i=0;i<urls.length;i++){
      const response=await fetch('data/fruiting-forecast/'+urls[i]);
      names.push('f'+i);
      await s.gis.duckdb.registerFileBuffer('f'+i,new Uint8Array(await response.arrayBuffer()));
    }
    const list=names.map(n=>"'"+n+"'").join(',');
    const conv=r=>r.toArray().map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v])));
    const union=conv(await conn.query('SELECT count(*) n, count(canopy) canopy, sum(evergreen) evergreen, sum(wetland) wetland FROM read_parquet(['+list+'], union_by_name=true)'));
    let mixedWithout=null;
    try{await conn.query('SELECT * FROM read_parquet(['+list+'])')}catch(e){mixedWithout=e.message}
    const western=conv(await conn.query('SELECT count(*) n, count(canopy) canopy, sum(evergreen) evergreen, count(drainage_class) drainage, count(awc_25_cm) awc FROM read_parquet(['+names.slice(0,2).map(n=>"'"+n+"'").join(',')+'])'));
    const classesFor=async name=>conv(await conn.query("SELECT string_agg(DISTINCT land_class, ',' ORDER BY land_class) classes FROM read_parquet('"+name+"')"));
    const soilFor=async name=>conv(await conn.query("SELECT string_agg(DISTINCT drainage_class, ',' ORDER BY drainage_class) classes FROM read_parquet('"+name+"')"));
    const classes={n40:await classesFor(names[0]),n39:await classesFor(names[1])};
    const soil={n40:await soilFor(names[0]),n39:await soilFor(names[1])};
    return {union,western,classes,soil,mixedWithout};
  });
  expect(result.union[0].n).toBe(1000); // 400 + 400 western + 200 legacy
  expect(result.union[0].canopy).toBe(1000); // legacy tiles also carry sampled canopy
  expect(result.union[0].evergreen).toBeGreaterThan(300); // western land-cover evidence survives the union
  expect(result.mixedWithout).toBeTruthy(); // documents why union_by_name is required
  expect(result.western[0].n).toBe(800);
  expect(result.western[0].canopy).toBe(800);
  expect(result.western[0].evergreen).toBeGreaterThan(300);
  // The legacy tile contributes no evergreen evidence (NULL, not 0) to the union.
  expect(result.union[0].evergreen).toBe(result.western[0].evergreen);
  const classSets={n40:result.classes.n40[0].classes,n39:result.classes.n39[0].classes};
  expect(classSets.n40).toBeTruthy();
  expect(classSets.n39).toBeTruthy();
  expect(classSets.n40).not.toBe(classSets.n39);
  // Real SSURGO soil evidence reaches DuckDB-Wasm and differs between the tiles.
  expect(result.western[0].drainage).toBeGreaterThan(600);
  expect(result.western[0].awc).toBeGreaterThan(600);
  expect(result.soil.n40[0].classes).toBeTruthy();
  expect(result.soil.n39[0].classes).toBeTruthy();
  expect(result.soil.n40[0].classes).not.toBe(result.soil.n39[0].classes);
});
test('real cross-tile public-land and MTBS identities survive DuckDB reads',async({page})=>{
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
    const load=async(url,name)=>{const r=await fetch('data/fruiting-forecast/'+url);await s.gis.duckdb.registerFileBuffer(name,new Uint8Array(await r.arrayBuffer()));return "'"+name+"'"};
    const conv=r=>r.toArray().map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v])));
    const coPl=await load(pick('n37_w107').publicLands.url,'co_pl');
    const nmPl=await load(pick('n36_w107').publicLands.url,'nm_pl');
    const pl=conv(await conn.query('SELECT count(*) n, count(DISTINCT property_id) ids FROM read_parquet(['+coPl+','+nmPl+'], union_by_name=true)'));
    const sharedProperties=conv(await conn.query('SELECT count(*) shared FROM (SELECT property_id FROM read_parquet('+coPl+') INTERSECT SELECT property_id FROM read_parquet('+nmPl+'))'));
    const coFire=await load(pick('n37_w107').fireHistory.url,'co_fire');
    const nmFire=await load(pick('n36_w107').fireHistory.url,'nm_fire');
    const fire=conv(await conn.query('SELECT count(*) n, count(DISTINCT perimeter_id) ids FROM read_parquet(['+coFire+','+nmFire+'])'));
    const sharedPerimeters=conv(await conn.query('SELECT count(*) shared FROM (SELECT perimeter_id FROM read_parquet('+coFire+') INTERSECT SELECT perimeter_id FROM read_parquet('+nmFire+'))'));
    const ambiguous=conv(await conn.query('SELECT jurisdiction_confidence confidence, count(*) n FROM read_parquet(['+coPl+','+nmPl+'], union_by_name=true) GROUP BY 1 ORDER BY 2 DESC'));
    return {pl,sharedProperties,fire,sharedPerimeters,ambiguous};
  });
  // A unit clipped into both tiles keeps one identity, so rows exceed distinct ids.
  expect(result.pl[0].n).toBeGreaterThan(result.pl[0].ids);
  expect(result.sharedProperties[0].shared).toBeGreaterThan(0);
  expect(result.fire[0].n).toBeGreaterThanOrEqual(result.fire[0].ids);
  expect(result.sharedPerimeters[0].shared).toBeGreaterThan(0);
  const confidence=Object.fromEntries(result.ambiguous.map(r=>[r.confidence,r.n]));
  expect(confidence.authoritative).toBeGreaterThan(100);
  expect(confidence['ambiguous-near-boundary']).toBeGreaterThan(0);
});
test('interstate search loads both states, isolates jurisdiction and follows ecology',async({page})=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{const u=new URL(r.request().url());const lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);const rows=lat.map((v,i)=>weatherPayload(v,lon[i]));return r.fulfill({json:rows.length===1?rows[0]:rows})});
  const gisRequests=[];
  page.on('response',r=>{const u=r.url();if(u.includes('data/fruiting-forecast/'))gisRequests.push(u.split('data/fruiting-forecast/')[1].split('?')[0])});
  await page.goto(`http://127.0.0.1:${artifactPort}/fruiting-forecast.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.locator('#radiusSelect').selectOption('50');
  await page.locator('#locationInput').fill('36.90, -105.25');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:200000});
  const result=await page.evaluate(()=>{
    const t=window.__FRUITING_FORECAST_TEST__,s=t.getState(),a=s.analysis;
    const h=window.__FRUITING_FORECAST_HUNTABILITY_TEST__;
    const properties=s.gis.properties.map(p=>({name:p.name,state:p.stateCode,confidence:p.jurisdictionConfidence,status:p.rule.collectingStatus}));
    const zoneConsistency=a.zones.every(z=>{
      const allowed=(a.zoneBiology[z.id]||{}).speciesIds||[];
      return z.scores.every(sc=>allowed.includes(sc.speciesId));
    });
    // Fixture rules isolate jurisdictions even though no CO/NM rules are published yet.
    const rules={verifiedAt:'2026-09-01',rules:[
      {id:'co-rule',jurisdiction:{state:'CO'},scope:{managerContains:'Forest Service'},collectingStatus:'ALLOWED_WITH_LIMITS',sourceUrl:'https://example.gov/co'},
      {id:'nm-rule',jurisdiction:{state:'NM'},scope:{managerContains:'Forest Service'},collectingStatus:'PERMIT_REQUIRED',sourceUrl:'https://example.gov/nm'}]};
    const prop=(state,confidence)=>({name:'Carson National Forest',manager:'Forest Service',propertyType:'National Forest',ownershipClass:'PUBLIC',stateCode:state,jurisdictionConfidence:confidence});
    const isolation={
      co:h.resolveCollectingRule(prop('CO','authoritative'),rules).collectingStatus,
      nm:h.resolveCollectingRule(prop('NM','authoritative'),rules).collectingStatus,
      ambiguous:h.resolveCollectingRule(prop(null,'ambiguous-near-boundary'),rules).collectingStatus,
      unresolved:h.resolveCollectingRule(prop(null,'unresolved'),rules).collectingStatus};
    return {tiles:s.gis.tiles.map(x=>x.id),properties,profile:a.biology.profileId,targets:a.speciesConfiguration.map(x=>x.id),
      sectorBiologyCount:a.sectorBiologyCount,zoneConsistency,isolation,
      zoneProfiles:Object.keys(a.zoneBiology).map(k=>a.zoneBiology[k].profileId).filter((v,i,arr)=>arr.indexOf(v)===i)};
  });
  expect(result.tiles).toEqual(expect.arrayContaining(['n37_w106','n36_w106']));
  expect(result.profile).toBe('southernRockies');
  // The radius may cross into madrean sectors (code 22/23 NM border), in which
  // case the configuration carries that sector's targets too.
  expect(result.targets).toEqual(expect.arrayContaining(['porcini','chanterelleRoseocanus','morelNatural','morelBurn']));
  expect(result.targets).not.toContain('chanterelleFormosus');
  expect(result.sectorBiologyCount).toBeGreaterThanOrEqual(2);
  expect(result.zoneConsistency).toBe(true);
  expect(gisRequests.some(p=>p.startsWith('habitat/n37_w106'))).toBe(true);
  expect(gisRequests.some(p=>p.startsWith('habitat/n36_w106'))).toBe(true);
  // Lazy loading: no published tile outside the search box is fetched.
  expect(gisRequests.some(p=>p.startsWith('habitat/n40_w107')||p.startsWith('habitat/n37_w108'))).toBe(false);
  const states=new Set(result.properties.map(p=>p.state).filter(Boolean));
  expect(states.has('CO')).toBe(true);
  expect(states.has('NM')).toBe(true);
  // Published rules are Indiana-only, so nothing here inherits a state-scoped rule.
  expect(result.properties.every(p=>p.status==='UNKNOWN_VERIFY')).toBe(true);
  expect(result.properties.filter(p=>p.confidence!=='authoritative').every(p=>p.state===null)).toBe(true);
  // Fixture rules never leak across the line, and ambiguous jurisdiction matches none.
  expect(result.isolation.co).toBe('ALLOWED_WITH_LIMITS');
  expect(result.isolation.nm).toBe('PERMIT_REQUIRED');
  expect(result.isolation.ambiguous).toBe('UNKNOWN_VERIFY');
  expect(result.isolation.unresolved).toBe('UNKNOWN_VERIFY');
  expect(result.zoneProfiles.length).toBeGreaterThan(1);
  expect(result.zoneProfiles).toContain('southernRockies');
  expect(errors).toEqual([]);
});
test('canopy and land cover reach scoreHabitat without replacing host evidence',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const t=__FRUITING_FORECAST_TEST__,b=__FRUITING_FORECAST_BIO_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(39.48,-106.05)).find(x=>x.id==='porcini');
    const base={available:true,sampleCells:24,soil:{},terrain:{elevationMedianFt:10000},access:{},confidence:{cellCoverage:1,hostQuality:.65,soilCoverage:0}};
    const conifer={...base,forest:{cover:.62,deciduous:0,open:.05,canopy:.55,dominantClass:'evergreen_forest'},hosts:{spruceFir:0,firSpruceMountainHemlock:.6,lodgepolePine:.4,ponderosaPine:0,douglasFir:0,aspenBirch:0,mappedCoverage:.9}};
    const openGround={...base,forest:{cover:.06,deciduous:0,open:.82,canopy:.04,dominantClass:'grassland_herbaceous'},hosts:{spruceFir:0,firSpruceMountainHemlock:0,lodgepolePine:0,ponderosaPine:0,douglasFir:0,aspenBirch:0,mappedCoverage:.9}};
    const wrongHosts={...base,forest:{cover:.62,deciduous:0,open:.05,canopy:.55,dominantClass:'evergreen_forest'},hosts:{spruceFir:0,firSpruceMountainHemlock:0,lodgepolePine:0,ponderosaPine:0,douglasFir:0,aspenBirch:0,mappedCoverage:.9}};
    const noCanopy={...base,forest:{cover:.62,deciduous:null,open:null,canopy:null,dominantClass:'evergreen_forest'},hosts:conifer.hosts};
    return {conifer:t.scoreHabitat(sp,conifer),open:t.scoreHabitat(sp,openGround),wrongHosts:t.scoreHabitat(sp,wrongHosts),noCanopy:t.scoreHabitat(sp,noCanopy),legacyShape:t.scoreHabitat(sp,{available:true,sampleCells:8,forest:{cover:.62,deciduous:null,open:null},hosts:{spruceFir:.5,firSpruceMountainHemlock:.5,mappedCoverage:.8},soil:{},terrain:{},access:{},confidence:{cellCoverage:.9,hostQuality:.65,soilCoverage:0}})};
  });
  expect(r.conifer.parts.canopy).toBeGreaterThan(60);
  expect(r.conifer.parts.host).toBeGreaterThan(20);
  // Canopy and land cover do not substitute for mapped host evidence.
  expect(r.conifer.parts.host).toBeGreaterThan(r.wrongHosts.parts.host);
  expect(r.conifer.score).toBeGreaterThan(r.wrongHosts.score);
  expect(r.open.parts.canopy).toBeLessThan(30);
  expect(r.open.score).toBeLessThan(r.conifer.score);
  // Missing canopy is omitted evidence that lowers available weight, never a zero.
  expect(r.noCanopy.parts.canopy).toBeNull();
  expect(r.noCanopy.availableWeight).toBeLessThan(r.conifer.availableWeight);
  // A legacy-shaped habitat object (no evergreen/canopy keys) still scores on forest + host.
  expect(r.legacyShape.parts.canopy).toBeNull();
  expect(r.legacyShape.parts.forest).toBeGreaterThan(70);
  expect(r.legacyShape.score).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test('habitat completeness is explicit and never implied by a published file',async({page})=>{
  await open(page);
  const r=await page.evaluate(()=>{
    const t=__FRUITING_FORECAST_TEST__;
    const manifest={datasetVersion:'fixture',tiles:[
      {id:'complete',habitat:{status:'AVAILABLE',url:'a.parquet',components:{forestType:'AVAILABLE',elevation:'AVAILABLE',landCover:'AVAILABLE',canopy:'AVAILABLE',soil:'UNBUILT'}}},
      {id:'legacy',habitat:{status:'PARTIAL',url:'b.parquet'}},
      {id:'file-only',url:'c.parquet'},
      {id:'empty',habitat:{status:'VERIFIED_EMPTY'}}
    ]};
    return t.aboutManifestCounts(manifest);
  });
  expect(r.habitat).toBe(3);
  expect(r.habitatComplete).toBe(1);
  expect(r.components.canopy.AVAILABLE).toBe(1);
  expect(r.components.canopy.UNBUILT).toBe(0);
  expect(r.components.soil.UNBUILT).toBe(1);
});
