const {test,expect}=require('@playwright/test');
const path=require('path');
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
const places=[['Indiana',38.3553,-87.5675,'hardwood'],['Colorado',39.48,-106.05,'southernRockies'],['PNW',47.6,-123.5,'pnw'],['California',38.5,-122.7,'california'],['Great Lakes',46.5,-89.5,'northernForests'],['Southeast',31.5,-83.5,'southeast'],['Plains',38.5,-100.5,'plains'],['Southwest',33.5,-112.1,'southwest']];
for(const [name,lat,lon,expected] of places)test(name+' resolves using EPA polygons',async({page})=>{const errors=await open(page);const result=await page.evaluate(([lat,lon])=>{const t=__FRUITING_FORECAST_BIO_TEST__,b=t.resolveBiology(lat,lon);return {b,ids:t.regionalSpecies(b).map(s=>s.id)}},[lat,lon]);expect(result.b.profileId).toBe(expected);expect(result.b.ecoregionCode).toBeTruthy();if(expected==='southernRockies')expect(result.ids).toEqual(['porcini']);if(!['hardwood','southernRockies'].includes(expected))expect(result.ids).toEqual([]);expect(errors).toEqual([])});
test('Colorado analysis and unsupported geography never expose Midwest scores',async({page})=>{
 const errors=await open(page);
 for(const [coords,count] of [['38.3553, -87.5675',7],['39.48, -106.05',1],['33.5, -112.1',0]]){
 await page.locator('#locationInput').fill(coords);await page.locator('#analyzeBtn').click();await expect(page.locator('#status')).toContainText('Analysis ready');await expect(page.locator('.rank-card')).toHaveCount(count);
 if(count===1){await expect(page.locator('#topBet')).toContainText('Porcini');await expect(page.locator('#detailContent')).toContainText('Not calibrated');await page.screenshot({path:'/private/tmp/ff-colorado.png',fullPage:true})}
 if(!count)await expect(page.locator('#topBet')).toContainText('Unsupported');
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
test('historical plausibility and disturbance contracts never turn missing evidence into absence',async({page})=>{
 await open(page);const r=await page.evaluate(()=>{const t=__FRUITING_FORECAST_BIO_TEST__;return {missing:t.historicalPlausibility(null),sparse:t.historicalPlausibility({status:'AVAILABLE',records:0,distinctYears:0}),repeated:t.historicalPlausibility({status:'AVAILABLE',records:10,distinctYears:3}),fire:t.disturbanceEvidence(null),known:t.disturbanceEvidence({status:'AVAILABLE',fireYear:2025,sourceUrl:'https://example.gov/fire'},new Date(2026,7,1))}});
 expect(r.missing.penalty).toBe(0);expect(r.sparse.penalty).toBe(0);expect(r.repeated.supportsPresence).toBe(true);expect(r.fire).toBeNull();expect(r.known.yearsSinceFire).toBe(1);expect(r.known.severity).toBeNull();
});
test('unsupported taxa return no score and regional selections are available explicitly',async({page})=>{
 await open(page);await expect(page.locator('#speciesSelect option[value="porcini"]')).toHaveCount(1);
 expect(await page.evaluate(()=>__FRUITING_FORECAST_TEST__.scoreSpecies({id:'unmodeled',applicability:'UNSUPPORTED'}).score)).toBeNull();
});
