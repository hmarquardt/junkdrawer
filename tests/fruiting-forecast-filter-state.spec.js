const {test,expect}=require('@playwright/test');
require('./fruiting-local-manifest.cjs')(test);
const path=require('path');
const fs=require('fs');

test.use({channel:'chrome'});

function dates(){const out=[];for(let i=-30;i<=7;i++)out.push(new Date(2026,7,i+10).toISOString().slice(0,10));return out}
function hours(){const out=[];for(let i=-30*24;i<=7*24;i++)out.push(new Date(2026,7,10,i).toISOString().slice(0,13)+':00');return out}

async function open(page){
  const consoleErrors=[],pageErrors=[];
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('ERR_FAILED')&&!m.text().includes('Failed to load resource'))consoleErrors.push(m.text())});
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.route('https://geocoding-api.open-meteo.com/v1/search**',r=>r.fulfill({json:{results:[{name:'Salida',admin1:'Colorado',country_code:'US',latitude:38.5347,longitude:-105.9989}]}}));
  await page.route('https://api.open-meteo.com/v1/forecast**',r=>{
    const u=new URL(r.request().url()),lat=u.searchParams.get('latitude').split(',').map(Number),lon=u.searchParams.get('longitude').split(',').map(Number);
    const rows=lat.map((v,i)=>({latitude:v,longitude:lon[i],elevation:2400,timezone:'America/Denver',daily:{time:dates(),precipitation_sum:dates().map(()=>2),temperature_2m_max:dates().map(()=>24),temperature_2m_min:dates().map(()=>9),et0_fao_evapotranspiration:dates().map(()=>.15)},hourly:{time:hours(),temperature_2m:hours().map(()=>15),relative_humidity_2m:hours().map(()=>70),dew_point_2m:hours().map(()=>8),precipitation:hours().map(()=>.05),soil_temperature_0cm:hours().map(()=>12),soil_moisture_0_to_1cm:hours().map(()=>.25),vapour_pressure_deficit:hours().map(()=>.5),wind_speed_10m:hours().map(()=>6)}}));
    return r.fulfill({json:rows.length===1?rows[0]:rows});
  });
  await page.route('https://api.inaturalist.org/**',r=>r.fulfill({json:{total_results:0,results:[]}}));
  await page.goto('file://'+path.resolve('fruiting-forecast.html'));
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.__FRUITING_FORECAST_BIO_TEST__);
  return {consoleErrors,pageErrors};
}

async function analyze(page,focus,specific){
  await page.locator('#focusSelect').selectOption(focus);
  if(specific)await page.locator('#speciesSelect').selectOption(specific);
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:120000});
  return page.locator('#topBet').textContent();
}

test('Salida distinguishes normal, filter-empty, and regional species mismatch states',async({page})=>{
  const errors=await open(page);
  await page.locator('#radiusSelect').selectOption('10');
  await page.locator('#depthSelect').selectOption('quick');
  await page.locator('#locationInput').fill('Salida, Colorado');

  let text=await analyze(page,'best');
  let state=await page.evaluate(()=>{const a=__FRUITING_FORECAST_TEST__.getState().analysis;return {profile:a.biology.profileId,maturity:a.biology.maturity,ranked:a.ranked.length,gis:a.gis.status,tiles:a.gis.tiles,reason:a.filterState.emptyResultReason}});
  expect(state.profile).toBe('southernRockies');
  expect(state.maturity).toBe('PROVISIONAL');
  expect(state.ranked).toBeGreaterThan(0);
  const published=await page.evaluate(manifest=>{const t=__FRUITING_FORECAST_TEST__.selectGisTiles(manifest,38.5347,-105.9989,10),tile=t.find(x=>x.id==='n38_w106');return {ids:t.map(x=>x.id),layers:tile&&['habitat','publicLands','accessPoints','fireHistory'].every(k=>tile[k]&&tile[k].status==='AVAILABLE')}} ,JSON.parse(fs.readFileSync('data/fruiting-forecast/manifest.json','utf8')));
  expect(published.ids).toContain('n38_w106');
  expect(published.layers).toBe(true);
  expect(state.reason).toBeNull();
  expect(text).not.toMatch(/Unsupported|No model|No data/i);

  text=await analyze(page,'all');
  expect(await page.evaluate(()=>__FRUITING_FORECAST_TEST__.getState().analysis.ranked.length)).toBeGreaterThan(0);
  expect(text).not.toMatch(/Unsupported|No model|No data/i);

  text=await analyze(page,'beginner');
  state=await page.evaluate(()=>{const a=__FRUITING_FORECAST_TEST__.getState().analysis;return {reason:a.filterState.emptyResultReason,regional:a.filterState.regionalTargetCount,matched:a.filterState.focusMatchedTargetCount,gis:a.gis.status}});
  expect(state).toMatchObject({reason:'FILTER_NO_MATCH',regional:4,matched:0});
  expect(text).toContain('No Southern Rockies targets match Beginner-friendly edibles');
  expect(text).toContain('This region has forecast data');
  expect(text).not.toMatch(/Unsupported|No model|No data/i);
  await expect(page.locator('[data-focus-recovery="best"]')).toBeVisible();
  await page.locator('[data-focus-recovery="best"]').click();
  await expect(page.locator('#status')).toContainText('Analysis ready',{timeout:120000});
  expect(await page.locator('#focusSelect').inputValue()).toBe('best');
  expect(await page.evaluate(()=>__FRUITING_FORECAST_TEST__.getState().analysis.ranked.length)).toBeGreaterThan(0);

  text=await analyze(page,'specific','morel');
  state=await page.evaluate(()=>__FRUITING_FORECAST_TEST__.getState().analysis.filterState);
  expect(state.emptyResultReason).toBe('SPECIES_NOT_MODELED');
  expect(state.requestedSpeciesName).toBe('Morels');
  expect(text).toContain('Morels isn’t modeled for Southern Rockies');
  expect(text).toContain('Regional forecast data is available');
  expect(text).not.toMatch(/Unsupported|No model|No data/i);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('all 13 profile focus state machines derive truthful empty reasons',async({page})=>{
  const errors=await open(page);
  const matrix=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__,globalIds=Object.keys(b.baseTaxa);
    return Object.keys(b.profiles).map(profileId=>{
      const profile=b.profiles[profileId],biology={profileId,profileName:profile.name,maturity:profile.maturity},regional=b.regionalSpecies(biology),regionalIds=regional.map(s=>s.id),missingId=globalIds.find(id=>!regionalIds.includes(id));
      const synthetic=(focus,matched,requested)=>({ranked:matched.length?[{speciesId:matched[0].id}]:[],focus,biology,requestedSpeciesId:requested,requestedSpeciesName:requested&&b.baseTaxa[requested].common,zoneBiology:{center:{profileId,maturity:profile.maturity,regionalTargetIds:regionalIds,speciesIds:matched.map(s=>s.id)}}});
      const beginner=t.focusSpecies(biology,'beginner'),beginnerState=t.emptyResultState(synthetic('beginner',beginner));
      return {profileId,maturity:profile.maturity,targetCount:regional.length,best:t.focusSpecies(biology,'best').length,all:t.focusSpecies(biology,'all').length,beginner:beginner.length,beginnerReason:beginnerState&&beginnerState.emptyResultReason,specificReason:missingId?t.emptyResultState(synthetic('specific',[],missingId)).emptyResultReason:null};
    });
  });
  expect(matrix).toHaveLength(13);
  for(const row of matrix){
    expect(row.all).toBe(row.targetCount);
    expect(row.best).toBe(row.targetCount);
    if(row.maturity==='MODELED_SPARSE'){
      expect(row.targetCount).toBe(0);
      expect(row.beginnerReason).toBe('MODELED_SPARSE');
    }else{
      expect(row.maturity).toBe('PROVISIONAL');
      expect(row.targetCount).toBeGreaterThan(0);
      expect(row.beginnerReason).toBe(row.beginner?null:'FILTER_NO_MATCH');
      expect(row.specificReason).toBe('SPECIES_NOT_MODELED');
    }
  }
  expect(matrix.filter(r=>r.beginner===0&&r.maturity!=='MODELED_SPARSE').length).toBeGreaterThan(0);
  expect(matrix.filter(r=>r.beginner>0).length).toBeGreaterThan(0);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('archived empty analyses without new metadata render safely',async({page})=>{
  const errors=await open(page);
  const result=await page.evaluate(()=>{
    const t=__FRUITING_FORECAST_TEST__,b=__FRUITING_FORECAST_BIO_TEST__,bio={profileId:'southernRockies',profileName:b.profiles.southernRockies.name,maturity:b.profiles.southernRockies.maturity};
    return t.emptyResultState({ranked:[],focus:'beginner',biology:bio,zoneBiology:{center:{profileId:'southernRockies',maturity:'PROVISIONAL',speciesIds:[]}}});
  });
  expect(result.emptyResultReason).toBe('FILTER_NO_MATCH');
  expect(result.regionalTargetCount).toBe(4);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('location failures stay distinct from regional biology and GIS coverage',async({page})=>{
  const errors=await open(page);
  await page.locator('#locationInput').fill('95, -105');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('Coordinates are outside valid latitude/longitude ranges');
  await page.unroute('https://geocoding-api.open-meteo.com/v1/search**');
  await page.route('https://geocoding-api.open-meteo.com/v1/search**',r=>r.fulfill({json:{results:[]}}));
  await page.locator('#locationInput').fill('Definitely Not A Real Place');
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#status')).toContainText('No matching place found');
  await expect(page.locator('#topBet')).toBeEmpty();
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
