const {test,expect}=require('@playwright/test');
const path=require('path');
test.use({channel:'chrome'});
async function open(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>window.__FF_TEST_FAST__=true);
  await page.route('**/api/analytics/**',r=>r.abort());
  await page.goto('file://'+path.resolve('fruiting-forecast.html'));
  await page.waitForFunction(()=>window.__FRUITING_FORECAST_TEST__&&window.FF_ECOREGIONS);
  return errors;
}
// Generic deterministic scorer harness: explicit month, habitat, weather.
async function score(page,params){
  return page.evaluate(({profileLoc,region,id,month,habitat,rain14,daysSinceRain,soilTemp,airTemp,soilMoisture})=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(...profileLoc)).find(x=>x.id===id);
    const zone={point:{searchRadius:25},elevation:null,habitat,
      metrics:{rain14,rain7:rain14*.7,rain10:rain14*.9,rain30:rain14*1.6,daysSinceRain,wetDays14:6,
        soilMoisture,soilTemp,airTemp,humidity:80,vpd:.5,wind:6,et07:.35}};
    const s=t.scoreSpecies(sp,zone,null,new Date(2026,month-1,15));
    return {score:s.score,band:s.band,confidence:s.confidence,components:s.components,missing:s.missing,seasonGate:s.seasonGate};
  },params);
}
const oakHabitat={available:true,sampleCells:24,forest:{cover:.7,deciduous:.62,open:.05,canopy:.72,evergreen:.08,dominantClass:'deciduous'},
  hosts:{oakHickory:.85,beechMaple:.3,elmAshCottonwood:.2,mappedCoverage:.92},soil:{},terrain:{},
  confidence:{cellCoverage:1,hostQuality:.7,soilCoverage:.9}};
const coniferNorth={available:true,sampleCells:24,forest:{cover:.8,deciduous:.1,open:.02,canopy:.8,evergreen:.78,dominantClass:'spruce_fir'},
  hosts:{oakHickory:0,beechMaple:0,elmAshCottonwood:0,mappedCoverage:.9},soil:{},terrain:{},
  confidence:{cellCoverage:1,hostQuality:.6,soilCoverage:.9}};
const openField={available:true,sampleCells:24,forest:{cover:.04,deciduous:0,open:.9,canopy:.03,evergreen:.02,dominantClass:'grassland_herbaceous'},
  hosts:{oakHickory:0,beechMaple:0,elmAshCottonwood:0,mappedCoverage:.9},soil:{},terrain:{},
  confidence:{cellCoverage:1,hostQuality:.5,soilCoverage:.8}};

test('Northern Forests / Great Lakes resolves as a real modeled profile with audited eastern taxa',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    // Great Lakes (northern Wisconsin/Michigan UP area) and northern New England
    const lakes=b.resolveBiology(45.1,-89.7), newEng=b.resolveBiology(44.26,-72.58);
    const lakesSpecies=b.regionalSpecies(lakes), neSpecies=b.regionalSpecies(newEng);
    return {lakes:{profileId:lakes.profileId,maturity:lakes.maturity,code:lakes.ecoregionCode,ecosystem:lakes.ecoregionName,ids:lakesSpecies.map(s=>s.id),maturities:lakesSpecies.map(s=>s.maturity),morelMonths:lakesSpecies.find(s=>s.id==='morel').months,morelSnowmelt:lakesSpecies.find(s=>s.id==='morel').snowmelt.status},
      newEng:{profileId:newEng.profileId,ids:neSpecies.map(s=>s.id)},
      provenance:b.profiles.northernForests.targets.morel.provenance.shared,
      hardwoodIds:b.regionalSpecies(b.resolveBiology(39.17,-86.52)).map(s=>s.id)};
  });
  expect(r.lakes.profileId).toBe('northernForests');
  expect(r.lakes.maturity).toBe('PROVISIONAL');
  expect(r.lakes.ids).toEqual(['morel','chanterelle','chicken','maitake','oyster','puffball','hericium']);
  for(const m of r.lakes.maturities)expect(m).toBe('PROVISIONAL');
  expect(r.lakes.morelMonths).toEqual([4,5,6]); // shifted later than the Midwest heuristic
  expect(r.lakes.morelSnowmelt).toBe('UNBUILT'); // declared, never claimed
  expect(r.newEng.profileId).toBe('northernForests'); // New England shares the profile
  expect(r.newEng.ids).toEqual(r.lakes.ids);
  expect(r.provenance).toContain('regional overrides');
  // The hardwood profile keeps its own (unshifted) calendar: no cross-profile inheritance.
  expect(r.hardwoodIds).toEqual(['morel','chanterelle','chicken','maitake','oyster','puffball','hericium']);
  expect(errors).toEqual([]);
});
test('Northern Forests scoring orders season, habitat and boundary correctly',async({page})=>{
  const errors=await open(page);
  const july=await score(page,{profileLoc:[45.1,-89.7],id:'chanterelle',month:8,habitat:oakHabitat,rain14:2.0,daysSinceRain:5,soilTemp:62,airTemp:74,soilMoisture:.3});
  const wrongSeason=await score(page,{profileLoc:[45.1,-89.7],id:'chanterelle',month:1,habitat:oakHabitat,rain14:2.0,daysSinceRain:5,soilTemp:62,airTemp:74,soilMoisture:.3});
  const wrongForest=await score(page,{profileLoc:[45.1,-89.7],id:'chanterelle',month:8,habitat:openField,rain14:2.0,daysSinceRain:5,soilTemp:62,airTemp:74,soilMoisture:.3});
  const coniferWrongHost=await score(page,{profileLoc:[45.1,-89.7],id:'chanterelle',month:8,habitat:coniferNorth,rain14:2.0,daysSinceRain:5,soilTemp:62,airTemp:74,soilMoisture:.3});
  const morelMay=await score(page,{profileLoc:[45.1,-89.7],id:'morel',month:5,habitat:oakHabitat,rain14:1.2,daysSinceRain:4,soilTemp:50,airTemp:58,soilMoisture:.26});
  const morelJuly=await score(page,{profileLoc:[45.1,-89.7],id:'morel',month:7,habitat:oakHabitat,rain14:1.2,daysSinceRain:4,soilTemp:66,airTemp:78,soilMoisture:.26});
  expect(july.score).toBeGreaterThan(wrongSeason.score+15);
  expect(july.score).toBeGreaterThan(wrongForest.score+10);
  expect(july.score).toBeGreaterThan(coniferWrongHost.score+10);
  expect(morelMay.score).toBeGreaterThan(morelJuly.score+20); // northern morels end by June
  expect(errors).toEqual([]);
});
test('Southeast / Coastal Plain resolves with the lateritius split, ringless honey and MARGINAL morel',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const coastal=b.resolveBiology(30.4,-84.3), inland=b.resolveBiology(32.5,-84.0);
    const coastalSpecies=b.regionalSpecies(coastal);
    const lateritius=b.baseTaxa.chanterelleLateritius, ringless=b.baseTaxa.honeyRingless;
    const nfChanterelle=b.regionalSpecies(b.resolveBiology(45.1,-89.7)).find(s=>s.id==='chanterelle');
    const seMorel=coastalSpecies.find(s=>s.id==='morel');
    return {coastal:{profileId:coastal.profileId,code:coastal.ecoregionCode,ecosystem:coastal.ecoregionName},
      inland:{profileId:inland.profileId,code:inland.ecoregionCode},
      ids:coastalSpecies.map(s=>s.id),
      lateritius:{id:lateritius.id,inat:lateritius.inat,sci:lateritius.scientific},
      ringless:{id:ringless.id,inat:ringless.inat,sci:ringless.scientific.slice(0,40)},
      seMorel:{applicability:seMorel.applicability,months:seMorel.months},
      nfChanterelleMonths:nfChanterelle.months,
      seChanterelleMonths:b.profiles.southeast.targets.chanterelleLateritius.months,
      pineGap:b.profiles.southeast.targets.chanterelleLateritius.declaredGaps};
  });
  expect(r.coastal.profileId).toBe('southeast');
  expect(['75','76','34','65','35','73']).toContain(r.coastal.code);
  expect(r.inland.profileId).toBe('southeast');
  expect(r.ids).toEqual(['chanterelleLateritius','honeyRingless','morel','chicken','oyster','maitake','puffball','hericium']);
  expect(r.lateritius.inat).toBe(143270);
  expect(r.ringless.inat).toBe(1238700);
  expect(r.seMorel.applicability).toBe('MARGINAL'); // coastal plain morels stay marginal
  expect(r.seMorel.months).toEqual([2,3,4]); // months earlier, never the Midwest calendar
  expect(r.seChanterelleMonths).toEqual([6,7,8,9]);
  expect(r.nfChanterelleMonths).toEqual([7,8,9]); // genuinely different regional calendars
  expect(r.pineGap[0].label).toContain('Pine-association');
  expect(errors).toEqual([]);
});
test('Southeast scoring orders season, moisture, winter oyster and boundaries',async({page})=>{
  const errors=await open(page);
  const july=await score(page,{profileLoc:[30.4,-84.3],id:'chanterelleLateritius',month:7,habitat:oakHabitat,rain14:2.6,daysSinceRain:4,soilTemp:76,airTemp:88,soilMoisture:.3});
  const wrongSeason=await score(page,{profileLoc:[30.4,-84.3],id:'chanterelleLateritius',month:12,habitat:oakHabitat,rain14:2.6,daysSinceRain:4,soilTemp:76,airTemp:88,soilMoisture:.3});
  const wrongForest=await score(page,{profileLoc:[30.4,-84.3],id:'chanterelleLateritius',month:7,habitat:openField,rain14:2.6,daysSinceRain:4,soilTemp:76,airTemp:88,soilMoisture:.3});
  const oysterWinter=await score(page,{profileLoc:[30.4,-84.3],id:'oyster',month:1,habitat:oakHabitat,rain14:1.8,daysSinceRain:4,soilTemp:50,airTemp:58,soilMoisture:.32});
  const oysterJuly=await score(page,{profileLoc:[30.4,-84.3],id:'oyster',month:7,habitat:oakHabitat,rain14:1.8,daysSinceRain:4,soilTemp:80,airTemp:92,soilMoisture:.3});
  const honeyOctober=await score(page,{profileLoc:[30.4,-84.3],id:'honeyRingless',month:10,habitat:oakHabitat,rain14:2.2,daysSinceRain:3,soilTemp:70,airTemp:78,soilMoisture:.3});
  const honeyJanuary=await score(page,{profileLoc:[30.4,-84.3],id:'honeyRingless',month:1,habitat:oakHabitat,rain14:2.2,daysSinceRain:3,soilTemp:48,airTemp:50,soilMoisture:.3});
  expect(july.score).toBeGreaterThan(wrongSeason.score+20);
  expect(july.score).toBeGreaterThan(wrongForest.score+20);
  expect(oysterWinter.score).toBeGreaterThan(oysterJuly.score+20); // SE oyster is a winter target
  expect(honeyOctober.score).toBeGreaterThan(honeyJanuary.score+20);
  expect(errors).toEqual([]);
});
test('ecological boundaries suppress cross-profile biology instead of falling back',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const nfVsHardwood=b.resolveBiology(45.1,-89.7), hardwood=b.resolveBiology(38.3553,-87.5675);
    const seVsPlain=b.resolveBiology(32.5,-84.0), plains=b.resolveBiology(31.5,-100.5);
    const seVsAppalachian=b.resolveBiology(32.5,-84.0), appalachian=b.resolveBiology(36.5,-83.2);
    const unsupported=b.resolveBiology(38.5,-100.0);
    return {nf:nfVsHardwood.profileId,hardwood:hardwood.profileId,se:seVsPlain.profileId,plains:plains.profileId,
      appalachian:appalachian.profileId,unsupported:{profileId:unsupported.profileId,targets:unsupported.targets},
      hardwoodSpeciesInNf:b.regionalSpecies(nfVsHardwood).map(s=>s.id).length>0,
      plainsSpecies:b.regionalSpecies(plains).length,unsupportedSpecies:b.regionalSpecies(unsupported).length};
  });
  expect(r.nf).toBe('northernForests');expect(r.hardwood).toBe('hardwood');
  expect(r.se).toBe('southeast');expect(r.plains).toBe('plains');
  expect(r.appalachian).toBe('appalachians');
  expect(r.plainsSpecies).toBe(0); // Great Plains stays unsupported: no silent fallback
  expect(r.unsupportedSpecies).toBe(0);
  expect(r.unsupported.targets).toEqual([]);
  expect(errors).toEqual([]);
});
test('Appalachians/Ozarks reuse is the audited explicit decision, not an accident',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const app=b.resolveBiology(36.5,-83.2);
    const species=b.regionalSpecies(app);
    return {profileId:app.profileId,maturity:app.maturity,ids:species.map(s=>s.id),
      sameObject:b.profiles.appalachians.targets===b.profiles.hardwood.targets};
  });
  expect(r.profileId).toBe('appalachians');
  expect(r.maturity).toBe('PROVISIONAL');
  expect(r.sameObject).toBe(true); // documented deliberate reuse (Task 20 audit found no material defect)
  expect(r.ids.length).toBe(7);
  expect(errors).toEqual([]);
});
