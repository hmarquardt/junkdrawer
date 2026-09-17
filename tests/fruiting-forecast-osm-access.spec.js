const {test,expect}=require('@playwright/test');
require('./fruiting-local-manifest.cjs')(test);
const {spawn}=require('child_process');
const fs=require('fs');
const port=19000+(process.pid%5000), base=`http://127.0.0.1:${port}`;
let server;
test.use({channel:'chrome',viewport:{width:1440,height:950}});
test.beforeAll(async()=>{
  server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{stdio:'ignore'});
  for(let i=0;i<50;i++){try{await new Promise((resolve,reject)=>require('http').get(base,r=>{r.resume();resolve()}).on('error',reject));return}catch{await new Promise(r=>setTimeout(r,100))}}
  throw Error('Server did not start');
});
test.afterAll(()=>server?.kill());
async function open(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text())});
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
  await page.goto(base+'/fruiting-forecast.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_ACCESS_TEST__);
  return errors;
}
test('modern starts require mapped eligible evidence; centroid and arbitrary roads never qualify',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const a=__FRUITING_FORECAST_ACCESS_TEST__;
    const point={accessId:'osm:node:1',name:'Mapped trailhead',type:'TRAILHEAD',sourceUrl:'https://www.openstreetmap.org/node/1',locationMethod:'osm-node',confidence:'HIGH',evidenceGrade:'HIGH',startEligible:true,lat:39.5,lon:-105.5};
    const rejected=[{...point,evidenceGrade:'RESTRICTED'}, {...point,startEligible:false}, {...point,type:'ROAD'}, {...point,type:'GATE'}, {...point,restriction:'access=private'}];
    return {start:a.suggestedStart([point,...rejected]),bad:rejected.map(p=>a.suggestedStart([p])),empty:a.suggestedStart([]),missing:a.accessEvidence([])};
  });
  expect(r.start.accessId).toBe('osm:node:1');
  expect(r.bad).toEqual([null,null,null,null,null]);
  expect(r.empty).toBeNull();expect(r.missing.status).toBe('UNMAPPED');
  expect(r.missing.confidenceFactor).toBeLessThan(1);
  expect(errors).toEqual([]);
});
test('tile-edge duplicate area, trailhead, road/gate references preserve identity and ambiguity',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const a=__FRUITING_FORECAST_ACCESS_TEST__;
    const raw={access_id:'osm:way:100',property_ids_json:'["forest"]',name:'Mapped Parking',type:'PARKING',evidence_grade:'HIGH',start_eligible:true,lat:39.5,lon:-106,road_id:'osm:way:200',source_url:'https://www.openstreetmap.org/way/100',location_method:'mapped-area-representative-point'};
    const left=a.accessRow(raw),right=a.accessRow({...raw,property_ids_json:'["preserve"]'});
    const merged=a.dedupeAccess([left,right]);
    const restricted=a.dedupeAccess([a.accessRow(raw),a.accessRow({...raw,evidence_grade:'RESTRICTED',start_eligible:false,restriction:'access=private'})]);
    return {merged,restricted,start:a.suggestedStart(restricted)};
  });
  expect(r.merged).toHaveLength(1);expect(r.merged[0].propertyIds).toEqual(['forest','preserve']);
  expect(r.restricted).toHaveLength(1);expect(r.start).toBeNull();
  expect(errors).toEqual([]);
});
test('Huntability uses access independently from collecting and never overwhelms biology',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const a=__FRUITING_FORECAST_ACCESS_TEST__,h=__FRUITING_FORECAST_HUNTABILITY_TEST__;
    const prop={name:'National Forest',ownershipClass:'PUBLIC',accessPoints:[]};
    const rule={collectingStatus:'UNKNOWN_VERIFY'};
    const unknown=h.huntability(prop,rule);
    const point={type:'TRAILHEAD',name:'Real start',accessId:'osm:node:1',lat:39.5,lon:-105.5,sourceUrl:'https://www.openstreetmap.org/node/1',locationMethod:'osm-node',evidenceGrade:'HIGH',confidence:'HIGH',startEligible:true};
    const good=h.huntability({...prop,accessPoints:[point]},rule);
    const restricted=h.huntability({...prop,accessPoints:[{...point,evidenceGrade:'RESTRICTED',startEligible:false}]},rule);
    const prohibited=h.huntability({...prop,accessPoints:[point]},{collectingStatus:'PROHIBITED'});
    const ownershipOnly=h.huntability({...prop,ownershipClass:'LIKELY_PUBLIC'},rule);
    return {unknown,good,restricted,prohibited,ownershipOnly,permission:rule.collectingStatus,
      poor:a.recommendedScore(10,good),strong:a.recommendedScore(80,unknown)};
  });
  expect(r.good.score).toBeGreaterThan(r.unknown.score);
  expect(r.unknown.components.physicalAccess).toBeNull();
  expect(r.ownershipOnly.score).toBe(r.unknown.score);
  expect(r.permission).toBe('UNKNOWN_VERIFY');
  expect(r.restricted.score).toBeLessThan(r.good.score);
  expect(r.prohibited.score).toBeLessThanOrEqual(8);
  expect(r.prohibited.actionability).toBe('NOT_ACTIONABLE');
  expect(r.poor).toBeLessThanOrEqual(10);expect(r.strong).toBeGreaterThan(r.poor);
  expect(errors).toEqual([]);
});
test('DuckDB-Wasm reads mixed modern and legacy access schemas and caches tile bytes',async({page})=>{
  test.setTimeout(180000);const errors=await open(page);let transfers=0;
  page.on('request',r=>{if(/\/ap\/.*\.parquet/.test(r.url()))transfers++});
  const r=await page.evaluate(async()=>{
    const t=__FRUITING_FORECAST_TEST__,a=__FRUITING_FORECAST_ACCESS_TEST__,s=t.getState(),conn=await t.initDuckDB();
    const m=await t.gisManifest(true),tiles=['n39_w106','n44_w124','n38_w087'].map(id=>m.tiles.find(t=>t.id===id));
    const names=[];
    for(const tile of tiles){const bytes=await fetch('data/fruiting-forecast/'+tile.accessPoints.url).then(r=>r.arrayBuffer());const name=tile.id+'_mixed';names.push(name);await s.gis.duckdb.registerFileBuffer(name,new Uint8Array(bytes))}
    const sql="SELECT count(*) n,count(evidence_grade) modern FROM read_parquet(["+names.map(n=>"'"+n+"'").join(',')+"],union_by_name=true)";
    const union=(await conn.query(sql)).toArray().map(r=>({n:Number(r.n),modern:Number(r.modern)}));
    const results=[];
    for(const tile of tiles){const loc={lat:(tile.bbox[1]+tile.bbox[3])/2,lon:(tile.bbox[0]+tile.bbox[2])/2};
      const before=s.gis.bytes,rows=await a.accessPointRows(conn,m,loc,60,false,null,[tile,tile]);const after=s.gis.bytes;
      const cached=await a.accessPointRows(conn,m,loc,60,false,null,[tile]);
      results.push({id:tile.id,count:rows.length,unique:new Set(rows.map(r=>r.accessId)).size,repeat:cached.length,firstBytes:after-before,cachedBytes:s.gis.bytes-after,eligible:rows.filter(r=>r.startEligible).length});
    }
    return {union,results};
  });
  expect(r.union[0].n).toBeGreaterThan(r.union[0].modern);expect(r.union[0].modern).toBeGreaterThan(0);
  for(const item of r.results){expect(item.count).toBe(item.unique);expect(item.repeat).toBe(item.count);expect(item.count).toBeGreaterThan(0);expect(item.firstBytes).toBeGreaterThan(0);expect(item.cachedBytes).toBe(0)}
  expect(transfers).toBe(6); // three direct union inputs plus three cache misses; duplicate tile entries cause no transfers
  console.log('ACCESS_BROWSER_TRANSFER '+JSON.stringify(r));
  expect(errors).toEqual([]);
});
for(const [label,lat,lon,tid] of [['colorado',39.55,-105.7,'n39_w106'],['oregon',44.5,-123.6,'n44_w124']]){
  test(`real ${label} canary: property associations, independent rules, mapped starts and manual QA screenshots`,async({page})=>{
    test.setTimeout(180000);const errors=await open(page);
    const r=await page.evaluate(async({lat,lon,tid,label})=>{
      const t=__FRUITING_FORECAST_TEST__,h=__FRUITING_FORECAST_HUNTABILITY_TEST__,s=t.getState();
      const loc={lat,lon},points=t.zonePoints(lat,lon,50,'standard'),started=performance.now();
      const ev=await t.HabitatProvider.fetch(points,loc,50,null,false);
      const good=ev._properties.find(p=>p.suggestedStart&&/National Forest/i.test(p.name))||ev._properties.find(p=>p.suggestedStart);
      const poor=ev._properties.find(p=>!p.suggestedStart&&p.accessPoints.length===0);
      const restricted=ev._properties.find(p=>!p.suggestedStart&&p.accessPoints.some(a=>a.restriction&&a.restriction.includes('private')))||ev._properties.find(p=>p.accessPoints.some(a=>a.evidenceGrade==='RESTRICTED'));
      window.__accessQA={good,poor,restricted,loc,ev};
      window.__renderAccessQA=function(which){
        const p=window.__accessQA[which];if(!p)return false;
        const bio=__FRUITING_FORECAST_BIO_TEST__.resolveBiology(lat,lon),species=__FRUITING_FORECAST_BIO_TEST__.regionalSpecies(bio),sp=species[0];
        const score={speciesId:sp.id,score:55,confidence:{label:'Low'},components:{},band:'Good'};
        // Display fixture score is explicitly not a biological validation; GIS is real.
        const c={...p,topSpeciesId:sp.id,scores:[score],biologicalOpportunity:55,recommendedHuntScore:__FRUITING_FORECAST_ACCESS_TEST__.recommendedScore(55,p.huntability),weatherZoneId:'center'};
        s.analysis={location:loc,zones:[{id:'center',name:'Access QA sector',point:{lat,lon},scores:[score]}],candidates:[c],speciesConfiguration:species};
        s.gis.properties=ev._properties;s.selectedSpecies=sp.id;s.selectedProperty=p.id;s.selectedZone='center';
        document.getElementById('results').hidden=false;document.getElementById('emptyState').hidden=true;
        h.renderHuntable();h.renderMap();h.renderDetail();if(p.suggestedStart){const start=p.suggestedStart;if(!s.layers.some(l=>l.getLatLng&&Math.abs(l.getLatLng().lat-start.lat)<1e-9&&Math.abs(l.getLatLng().lng-start.lon)<1e-9))throw Error('Suggested start marker missing');}return true;
      };
      const brief=p=>p&&({id:p.id,name:p.name,rule:p.rule.collectingStatus,access:p.huntability.accessEvidence,start:p.suggestedStart,points:p.accessPoints.length});
      return {good:brief(good),poor:brief(poor),restricted:brief(restricted),count:ev._access.count,elapsed:performance.now()-started,tiles:s.gis.tiles.map(t=>t.id),logs:s.logs.filter(x=>x.message==='Access evidence loaded')};
    },{lat,lon,tid,label});
    expect(r.tiles).toContain(tid);expect(r.count).toBeGreaterThan(0);expect(r.good).toBeTruthy();expect(r.poor).toBeTruthy();expect(r.restricted).toBeTruthy();
    expect(r.good.start.accessId).toMatch(/^osm:(node|way|relation):\d+$/);expect(r.good.start.startEligible).toBe(true);
    expect(r.poor.start).toBeNull();expect(r.poor.access.status).toBe('UNMAPPED');
    for(const which of ['good','poor','restricted']){
      expect(await page.evaluate(which=>window.__renderAccessQA(which),which)).toBe(true);
      await page.screenshot({path:`/tmp/ff-access-${label}-${which}.png`,fullPage:true});
      if(which==='restricted')await expect(page.locator('#detailContent')).toContainText('Restriction:');
      if(which==='poor')await expect(page.locator('#detailContent')).toContainText('does not mean the property is inaccessible');
    }
    fs.writeFileSync(`/tmp/ff-access-${label}-browser-qa.json`,JSON.stringify(r,null,2));
    await page.evaluate(()=>window.__renderAccessQA('good'));
    await expect(page.locator('#huntableList')).toContainText(r.good.name);
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:`/tmp/ff-access-${label}-mobile.png`,fullPage:true});
    fs.writeFileSync(`/tmp/ff-access-${label}-browser-qa.json`,JSON.stringify(r,null,2));
    console.log('ACCESS_CANARY '+JSON.stringify(r));expect(errors).toEqual([]);
  });
}
