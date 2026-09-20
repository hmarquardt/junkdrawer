// Deterministic deployed-browser launch matrix for Fruiting Forecast.
// Mutable weather/observation calls are mocked; app, manifest, R2 Parquet,
// DuckDB-Wasm, cache, regional biology, rendering and access evidence are real.
const {chromium}=require('playwright');
const fs=require('fs');

const APP='https://hmarquardt.github.io/junkdrawer/fruiting-forecast.html';
const R2='https://data.hanksjunkdrawer.com/';
const PROFILES=[
  ['pnw',47.6,-123.5],['california',38.5,-122.7],['sierraNevada',37.7,-119.5],
  ['interiorMountains',44.2,-115.5],['southernRockies',39.48,-106.05],['madrean',35.5,-111.5],
  ['northernForests',46.5,-89.5],['hardwood',38.3553,-87.5675],['appalachians',36.5,-83.2],
  ['southeast',31.5,-83.5],['plains',38.5,-100.5],['coldBasins',46.8,-119.2],['warmDesert',33.5,-112.1],
];

function daySeries(){const a=[];for(let i=-30;i<=7;i++){const d=new Date();d.setUTCDate(d.getUTCDate()+i);a.push(d.toISOString().slice(0,10))}return a}
function hourSeries(){const a=[];for(let i=-30*24;i<=7*24;i++){const d=new Date();d.setUTCHours(d.getUTCHours()+i,0,0,0);a.push(d.toISOString().slice(0,13)+':00')}return a}

(async()=>{
  const outPath=process.argv[2]; if(!outPath)throw Error('usage: node tools/fruiting_launch_qa.js <out.json>');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const consoleErrors=[],pageErrors=[],failedRequests=[],allRequests=[];
  let parquetRequests=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,300))});
  page.on('pageerror',e=>pageErrors.push(String(e).slice(0,300)));
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()&&r.failure().errorText}));
  page.on('request',r=>{allRequests.push(r.url());if(r.url().startsWith(R2)&&r.url().endsWith('.parquet'))parquetRequests.push(r.url())});
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('https://geocoding-api.open-meteo.com/v1/search**',r=>r.fulfill({json:{results:[{name:'Salida',admin1:'Colorado',country_code:'US',latitude:38.5347,longitude:-105.9989}]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{
    const u=new URL(r.request().url()),lats=u.searchParams.get('latitude').split(',').map(Number),lons=u.searchParams.get('longitude').split(',').map(Number),days=daySeries(),hours=hourSeries();
    const rows=lats.map((lat,i)=>({latitude:lat,longitude:lons[i],elevation:1200,timezone:'America/Denver',daily:{time:days,precipitation_sum:days.map(()=>1.5),temperature_2m_max:days.map(()=>22),temperature_2m_min:days.map(()=>9),et0_fao_evapotranspiration:days.map(()=>.15)},hourly:{time:hours,temperature_2m:hours.map(()=>15),relative_humidity_2m:hours.map(()=>70),dew_point_2m:hours.map(()=>8),precipitation:hours.map(()=>.04),soil_temperature_0cm:hours.map(()=>12),soil_moisture_0_to_1cm:hours.map(()=>.25),vapour_pressure_deficit:hours.map(()=>.5),wind_speed_10m:hours.map(()=>6)}}));
    return r.fulfill({json:rows.length===1?rows[0]:rows});
  });
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  const navStarted=Date.now(); await page.goto(APP,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.__FRUITING_FORECAST_BIO_TEST__,null,{timeout:90000});
  const firstLoadMs=Date.now()-navStarted;
  const deployment=await page.evaluate(async()=>{const m=await __FRUITING_FORECAST_TEST__.gisManifest(false);return {appVersion:document.querySelector('[data-deploy-version]').dataset.deployVersion,modelVersion:document.getElementById('modelVersion').textContent,datasetVersion:m.datasetVersion,tiles:m.tiles.length,assetBaseUrl:m.assetBaseUrl}});
  await page.locator('#radiusSelect').selectOption('10'); await page.locator('#depthSelect').selectOption('quick');

  async function run(label,lat,lon,focus='best',specific=null){
    await page.locator('#locationInput').fill(`${lat}, ${lon}`); await page.locator('#focusSelect').selectOption(focus); if(specific)await page.locator('#speciesSelect').selectOption(specific);
    const before=parquetRequests.length,started=Date.now(); await page.locator('#analyzeBtn').click();
    await page.waitForFunction(()=>!document.getElementById('analyzeBtn').disabled&&/Analysis ready/.test(document.getElementById('status').textContent),null,{timeout:180000});
    const elapsedMs=Date.now()-started,cold=parquetRequests.length-before;
    const state=await page.evaluate(label=>{const s=__FRUITING_FORECAST_TEST__.getState(),a=s.analysis,b=__FRUITING_FORECAST_BIO_TEST__,props=s.gis.properties||[],starts=props.filter(p=>p.suggestedStart).map(p=>({propertyId:p.id,start:p.suggestedStart,associated:p.suggestedStart.propertyId===p.id||(p.suggestedStart.propertyIds||[]).includes(p.id)})),violations=starts.filter(x=>{const z=x.start;return z.startEligible!==true||!!z.restriction||!['HIGH','MEDIUM'].includes(z.evidenceGrade)||!Number.isFinite(z.lat)||!Number.isFinite(z.lon)||!/^osm:(node|way|relation):\d+$/.test(z.accessId||'')||!/^https:\/\/(?:www\.)?(?:osm\.org|openstreetmap\.org)\/(?:node|way|relation)\/\d+$/.test(z.sourceUrl||'')||!z.source||!['osm-node','mapped-area-representative-point'].includes(z.locationMethod)||!x.associated});return {label,ecoregion:{code:a.biology.ecoregionCode,name:a.biology.ecoregionName},profile:a.biology.profileId,profileName:a.biology.profileName,maturity:a.biology.maturity,targetCount:b.regionalSpecies(a.biology).length,rankedCount:a.ranked.length,topState:document.getElementById('topBet').textContent.trim(),gisStatus:a.gis.status,tileCount:a.gis.tiles.length,tiles:a.gis.tiles,habitatZones:a.zones.filter(z=>z.habitat&&z.habitat.available).length,publicProperties:a.gis.publicProperties,accessEvidence:a.gis.accessPointCount,fireStatus:a.gis.fireStatus,ruleStatuses:Array.from(new Set(props.map(p=>p.rule&&p.rule.collectingStatus).filter(Boolean))).sort(),suggestedStartsChecked:starts.length,suggestedStartViolations:violations.slice(0,10),filterState:a.filterState}},label);
    const warmBefore=parquetRequests.length,warmStarted=Date.now(); await page.locator('#analyzeBtn').click(); await page.waitForFunction(()=>!document.getElementById('analyzeBtn').disabled&&/Analysis ready/.test(document.getElementById('status').textContent),null,{timeout:180000});
    return {...state,coldParquetRequests:cold,warmParquetRequests:parquetRequests.length-warmBefore,coldAnalysisMs:elapsedMs,warmAnalysisMs:Date.now()-warmStarted};
  }

  const profiles=[]; for(const [id,lat,lon] of PROFILES){const row=await run(id,lat,lon);profiles.push(row);console.log(id,row.profile,row.coldParquetRequests,row.warmParquetRequests,row.coldAnalysisMs)}

  // Persisted filters: a valid beginner analysis elsewhere, followed by Salida without changing focus.
  const beginnerSource=await run('persisted-beginner-source',38.3553,-87.5675,'beginner');
  const salidaBeginner=await run('salida-beginner',38.5347,-105.9989,'beginner');
  const salidaBest=await run('salida-best',38.5347,-105.9989,'best');
  const salidaAll=await run('salida-all',38.5347,-105.9989,'all');
  const salidaSpecific=await run('salida-specific-mismatch',38.5347,-105.9989,'specific','morel');

  const boundaries=await page.evaluate(()=>{const t=__FRUITING_FORECAST_TEST__,b=__FRUITING_FORECAST_BIO_TEST__;return [[45,-122.5,100],[35.5,-111.5,100]].map(([lat,lon,radius])=>{const zones=t.zonePoints(lat,lon,radius,'standard').map(p=>{const bio=b.resolveBiology(p.lat,p.lon);return {zone:p.id,profile:bio.profileId,species:b.regionalSpecies(bio).map(s=>s.id)}});return {center:[lat,lon],profiles:Array.from(new Set(zones.map(z=>z.profile))),speciesUnion:Array.from(new Set(zones.flatMap(z=>z.species))).sort(),zones}})});
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>({width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,focusVisible:!!document.getElementById('focusSelect').offsetParent,locationVisible:!!document.getElementById('locationInput').offsetParent,topVisible:!!document.getElementById('topBet').offsetParent,mapHeight:document.getElementById('map').getBoundingClientRect().height,buttons:[...document.querySelectorAll('#topBet button')].map(b=>({text:b.textContent.trim(),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}));
  const accessibility=await page.evaluate(()=>({locationLabel:!!document.getElementById('locationInput').closest('label'),focusLabel:!!document.getElementById('focusSelect').closest('label'),radiusLabel:!!document.getElementById('radiusSelect').closest('label'),analyzeName:document.getElementById('analyzeBtn').textContent.trim(),statusLive:document.getElementById('status').getAttribute('aria-live'),dialogs:[...document.querySelectorAll('dialog')].every(d=>d.querySelector('[data-close][aria-label]'))}));
  const unexpectedRequests=allRequests.filter(u=>u.endsWith('.parquet')&&!u.startsWith(R2));
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),application:APP,mutableInputs:'Open-Meteo forecast, iNaturalist and Salida geocoding were deterministically intercepted; app/manifest/R2/DuckDB were deployed production.',deployment,firstLoadMs,profiles,filterStateMatrix:{beginnerSource,salidaBeginner,salidaBest,salidaAll,salidaSpecific},boundaries,mobile,accessibility,network:{r2ParquetRequests:parquetRequests.length,unexpectedParquetOrigins:unexpectedRequests,manifestRequests:allRequests.filter(u=>/manifest\.json/.test(u)),failedRequests:failedRequests.filter(x=>!x.url.includes('/api/analytics/'))},consoleErrors,pageErrors,suggestedStartTotals:{checked:profiles.reduce((n,p)=>n+p.suggestedStartsChecked,0),violations:profiles.reduce((n,p)=>n+p.suggestedStartViolations.length,0)},verdictChecks:{profilesResolved:profiles.filter((p,i)=>p.profile===PROFILES[i][0]).length,sparseTruthful:profiles.filter(p=>p.maturity==='MODELED_SPARSE').every(p=>/Modeled · sparse/.test(p.topState)&&!/Unsupported/.test(p.topState)),warmCacheAdditionalParquet:profiles.reduce((n,p)=>n+p.warmParquetRequests,0),salidaFilterTruthful:/forecast data/.test(salidaBeginner.topState)&&!/Unsupported|No model|No data/i.test(salidaBeginner.topState),specificMismatchTruthful:/isn’t modeled/.test(salidaSpecific.topState)&&!/Unsupported|No model|No data/i.test(salidaSpecific.topState)}};
  fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n'); await browser.close();
  if(deployment.appVersion!=='2026.09.20.3'||deployment.datasetVersion!=='content-db0f839a4352ef82'||deployment.tiles!==922||report.verdictChecks.profilesResolved!==13||report.verdictChecks.warmCacheAdditionalParquet!==0||report.suggestedStartTotals.violations||consoleErrors.length||pageErrors.length||unexpectedRequests.length)process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
