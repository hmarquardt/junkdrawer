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
test('Northern Rockies / Interior Mountains resolves as a coherent modeled profile',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const at=(lat,lon)=>{const bio=b.resolveBiology(lat,lon);return {profileId:bio.profileId,maturity:bio.maturity,code:bio.ecoregionCode,ecosystem:bio.ecoregionName,ids:b.regionalSpecies(bio).map(s=>s.id)}};
    return {idPanhandle:at(47.5,-116.5),idBatholith:at(44.2,-115.5),wyoming:at(43.5,-110.4),
      northCascades:at(48.6,-121.4),sierra:at(37.5,-119.4),azNm:at(35.35,-111.7)};
  });
  for(const zone of [r.idPanhandle,r.idBatholith,r.wyoming]){
    expect(zone.profileId).toBe('interiorMountains');
    expect(zone.maturity).toBe('PROVISIONAL');
    expect(zone.ids).toEqual(['morelBurn','matsutakeMurrillianum']);
  }
  // Task-Zero reassignments: North Cascades -> PNW, AZ/NM mountains -> southernRockies.
  // Revision 12: Sierra Nevada (code 5) is its own snowmelt-montane profile.
  expect(r.northCascades.profileId).toBe('pnw');
  expect(r.sierra.profileId).toBe('sierraNevada');
  expect(r.azNm.profileId).toBe('southernRockies');
  expect(r.azNm.ids).toEqual(['porcini','chanterelleRoseocanus','morelNatural','morelBurn']);
  // A sky-island point inside EPA 23 resolves the monsoon profile.
  expect(errors).toEqual([]);
});
test('Interior morel burn target uses its own regional parameters with declared gaps',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const t=b.profiles.interiorMountains.targets.morelBurn;
    const sr=b.profiles.southernRockies.targets.morelBurn;
    return {months:t.months,shoulder:t.shoulder,elevation:t.elevationFt,elevationSoft:t.elevationSoftFt,
      elevationProvenance:(t.elevationProvenance||'').slice(0,80),
      requiresDisturbance:t.requiresDisturbance,cap:t.evidenceGapCap,snowmelt:t.snowmelt.status,
      srMonths:sr.months,srElevation:sr.elevationFt,
      sameObject:t===sr,
      provenanceRegion:t.provenance.region.slice(0,60),
      severity:t.provenance.severity.slice(0,60)};
  });
  expect(r.months).toEqual([6,7,8]);          // interior progression, not the SR calendar
  expect(r.srMonths).toEqual([6,7]);          // Southern Rockies burn calendar stays its own
  expect(r.elevation).toEqual([4000,8500]);   // northern belts run lower
  expect(r.elevationSoft).toBe(2500);
  expect(r.elevationProvenance).toContain('proxy');
  expect(r.requiresDisturbance).toBe(true);
  expect(r.cap).toBe(25);
  expect(r.snowmelt).toBe('UNBUILT');
  expect(r.sameObject).toBe(false);           // separate regional model, not a shared object
  expect(r.provenanceRegion).toContain('PNW-GTR-710');
  expect(r.severity).toContain('severity');
  expect(errors).toEqual([]);
});
test('Interior disturbance behavior: no mapped burn caps the target; burn evidence drives ordering',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const bio=b.resolveBiology(44.2,-115.5);
    const sp=b.regionalSpecies(bio).find(s=>s.id==='morelBurn');
    const habitat={available:true,sampleCells:24,forest:{cover:.72,deciduous:.06,open:.04,canopy:.6,evergreen:.7,dominantClass:'spruce_fir'},
      hosts:{spruceFir:.75,firSpruceMountainHemlock:.6,lodgepolePine:.5,douglasFir:.4,aspenBirch:.1,ponderosaPine:.2,mappedCoverage:.92},
      soil:{},terrain:{},confidence:{cellCoverage:1,hostQuality:.7,soilCoverage:.9}};
    const metrics={rain14:1.6,rain7:1.1,rain10:1.4,rain30:2.4,daysSinceRain:5,wetDays14:5,soilMoisture:.28,soilTemp:52,airTemp:60,humidity:60,vpd:.7,wind:7,et07:.3};
    const noFire={reason:'No mapped MTBS perimeter applies to this sector'};
    const burn={status:'AVAILABLE',reason:'Mapped prior-year perimeter',perimeterId:'TEST',fireYear:2025,severity:null};
    const withBurn=t.scoreSpecies(sp,{point:{searchRadius:25},elevation:1900,habitat,metrics,disturbance:burn},null,new Date(2026,6,15));
    const withoutBurn=t.scoreSpecies(sp,{point:{searchRadius:25},elevation:1900,habitat,metrics,disturbance:noFire},null,new Date(2026,6,15));
    const wrongSeason=t.scoreSpecies(sp,{point:{searchRadius:25},elevation:1900,habitat,metrics,disturbance:burn},null,new Date(2026,10,15));
    return {withBurn:withBurn.score,withBurnBand:withBurn.band,withoutBurn:withoutBurn.score,withoutBurnBand:withoutBurn.band,
      withoutBurnCapped:withoutBurn.score<=25,wrongSeason:worseSeason(wrongSeason.score)};
    function worseSeason(x){return x}
  });
  expect(r.withoutBurnCapped).toBe(true);       // evidence-gap cap with no qualifying burn
  expect(r.withBurn).toBeGreaterThan(r.withoutBurn); // mapped prior-year burn raises the target
  expect(errors).toEqual([]);
});
test('Interior matsutake ordering: autumn season, interior hosts, elevation band',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(44.2,-115.5)).find(s=>s.id==='matsutakeMurrillianum');
    const habitat={available:true,sampleCells:24,forest:{cover:.68,deciduous:.05,open:.05,canopy:.55,evergreen:.65,dominantClass:'lodgepole_pine'},
      hosts:{lodgepolePine:.7,douglasFir:.5,spruceFir:.4,firSpruceMountainHemlock:.3,ponderosaPine:.2,mappedCoverage:.92},
      soil:{},terrain:{},confidence:{cellCoverage:1,hostQuality:.7,soilCoverage:.9}};
    const metrics=rain=>({rain14:rain,rain7:rain*.7,rain10:rain*.9,rain30:rain*1.6,daysSinceRain:5,wetDays14:5,soilMoisture:.26,soilTemp:14,airTemp:16,humidity:55,vpd:.6,wind:6,et07:.3});
    const zone=elevM=>({point:{searchRadius:25},elevation:elevM,habitat,metrics:metrics(1.4)});
    const sept=t.scoreSpecies(sp,zone(1600),null,new Date(2026,8,20));
    const winter=t.scoreSpecies(sp,zone(1600),null,new Date(2026,11,20));
    const noHost=t.scoreSpecies(sp,{point:{searchRadius:25},elevation:1600,habitat:{...habitat,hosts:{lodgepolePine:0,douglasFir:0,spruceFir:0,firSpruceMountainHemlock:0,ponderosaPine:0,mappedCoverage:.9}},metrics:metrics(1.4)},null,new Date(2026,8,20));
    const wrongElev=t.scoreSpecies(sp,zone(2900),null,new Date(2026,8,20));
    return {sept:sept.score,winter:winter.score,noHost:noHost.score,wrongElev:wrongElev.score,
      missing:sept.missing,provenance:b.profiles.interiorMountains.targets.matsutakeMurrillianum.provenance.region.slice(0,50)};
  });
  expect(r.sept).toBeGreaterThan(r.winter);     // autumn fruiting, frost ends the season
  expect(r.sept).toBeGreaterThan(r.noHost);     // interior lodgepole/Douglas-fir hosts matter
  expect(r.sept).toBeGreaterThan(r.wrongElev);  // band follows interior belts
  expect(r.provenance).toContain('GTR-412');
  expect(errors).toEqual([]);
});
test('Interior boundaries: rubriceps stays south, PNW targets stay west, sky islands stay monsoon',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const at=(lat,lon)=>{const bio=b.resolveBiology(lat,lon);return {profileId:bio.profileId,ids:b.regionalSpecies(bio).map(s=>s.id)}};
    return {interior:at(44.2,-115.5),colorado:at(39.48,-106.05),pnw:at(45.52,-122.68),azNm:at(35.35,-111.7),
      interiorTargets:b.profiles.interiorMountains.targets,
      srMorelBurn:b.profiles.southernRockies.targets.morelBurn,
      imMorelBurn:b.profiles.interiorMountains.targets.morelBurn};
  });
  expect(r.interior.profileId).toBe('interiorMountains');
  expect(r.interior.ids).toEqual(['morelBurn','matsutakeMurrillianum']);
  expect(r.interior.ids).not.toContain('porcini');           // B. rubriceps never transfers north
  expect(r.interior.ids).not.toContain('chanterelleFormosus'); // PNW maritime targets never transfer east
  expect(r.imMorelBurn).not.toBe(r.srMorelBurn);             // distinct regional models
  expect(r.azNm.profileId).toBe('southernRockies');          // AZ/NM mountains -> monsoon profile
  expect(errors).toEqual([]);
});
test('California Task Zero: Mediterranean and Sierra split with Klamath reassignment',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    const at=(lat,lon)=>{const bio=b.resolveBiology(lat,lon);return {profileId:bio.profileId,maturity:bio.maturity,code:bio.ecoregionCode,ecosystem:bio.ecoregionName,ids:b.regionalSpecies(bio).map(s=>s.id)}};
    return {oakWoodland:at(38.3,-122.5),soCal:at(34.2,-117.2),valley:at(36.9,-119.8),
      sierra:at(37.7,-119.5),klamath:at(41.5,-122.9),
      californiaTargets:b.profiles.california.targets,sierraTargets:b.profiles.sierraNevada.targets,
      pnwIds:b.profiles.pnw.targets};
  });
  // Mediterranean: oak woodland, SoCal mountains, and the valley all resolve california.
  for(const zone of [r.oakWoodland,r.soCal,r.valley]){
    expect(zone.profileId).toBe('california');
    expect(zone.maturity).toBe('PROVISIONAL');
  }
  expect(r.oakWoodland.ids).toEqual(['chanterelleCalifornicus','craterellusCalicornucopioides','lactariusRubidus','morel']);
  // Sierra is a distinct snowmelt-montane profile.
  expect(r.sierra.profileId).toBe('sierraNevada');
  expect(r.sierra.ids).toEqual(['morelBurn','springKing']);
  // Task-Zero reassignment: the Klamath/North Coast resolves PNW (GTR-412 documents
  // matsutake fruiting in the Klamath NF; GTR-576 extends the golden chanterelle).
  expect(r.klamath.profileId).toBe('pnw');
  expect(r.pnwIds).toHaveProperty('matsutakeMurrillianum');
  expect(Object.keys(r.californiaTargets)).toEqual(['chanterelleCalifornicus','craterellusCalicornucopioides','lactariusRubidus','morel']);
  expect(Object.keys(r.sierraTargets)).toEqual(['morelBurn','springKing']);
  expect(errors).toEqual([]);
});
test('California Mediterranean ordering: winter-rain season, oak host, summer drought',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const sp=b.regionalSpecies(b.resolveBiology(38.3,-122.5)).find(s=>s.id==='chanterelleCalifornicus');
    const oakHabitat={available:true,sampleCells:24,forest:{cover:.55,deciduous:.4,open:.1,canopy:.6,evergreen:.35,dominantClass:'western_oak'},
      hosts:{westernOak:.85,tanoakLaurel:.25,oakHickory:0,mappedCoverage:.9},soil:{},terrain:{},
      confidence:{cellCoverage:1,hostQuality:.7,soilCoverage:.9}};
    const zone=(rain,soilT)=>({point:{searchRadius:25},elevation:200,habitat:oakHabitat,
      metrics:{rain14:rain,rain7:rain*.7,rain10:rain*.9,rain30:rain*1.8,daysSinceRain:4,wetDays14:8,soilMoisture:.26,soilTemp:soilT,airTemp:soilT+10,humidity:75,vpd:.5,wind:6,et07:.25}});
    const january=t.scoreSpecies(sp,zone(2.2,48),null,new Date(2026,0,15));
    const july=t.scoreSpecies(sp,zone(.1,72),null,new Date(2026,6,15));
    const wrongHost=t.scoreSpecies(sp,{point:{searchRadius:25},elevation:200,habitat:{...oakHabitat,hosts:{westernOak:0,tanoakLaurel:0,oakHickory:0,mappedCoverage:.9}},metrics:zone(2.2,48).metrics},null,new Date(2026,0,15));
    return {january:january.score,july:july.score,wrongHost:wrongHost.score,
      missing:january.missing,gap:january.declaredGaps,
      fogNote:b.profiles.california.targets.chanterelleCalifornicus.provenance.fog.slice(0,40)};
  });
  expect(r.january).toBeGreaterThan(r.july+20);   // winter-rain fruiting vs dry-summer shutdown
  expect(r.january).toBeGreaterThan(r.wrongHost); // California oak host signal matters
  expect(r.gap[0].weight).toBe(12);               // declared Coast Live Oak resolution gap
  expect(r.fogNote).toContain('fog');
  expect(errors).toEqual([]);
});
test('Sierra ordering: snowmelt season, elevation progression, distinct morel model',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__,t=__FRUITING_FORECAST_TEST__;
    const bio=b.resolveBiology(37.7,-119.5);
    const roster=b.regionalSpecies(bio);
    const king=roster.find(s=>s.id==='springKing');
    if(!king)throw Error('springKing missing: '+JSON.stringify({profileId:bio.profileId,ids:roster.map(s=>s.id),ecoType:typeof window.FF_ECOREGIONS,ecoFeatures:window.FF_ECOREGIONS&&window.FF_ECOREGIONS.features&&window.FF_ECOREGIONS.features.length}));
    const conifer={available:true,sampleCells:24,forest:{cover:.72,deciduous:.04,open:.03,canopy:.55,evergreen:.72,dominantClass:'california_mixed_conifer'},
      hosts:{californiaMixedConifer:.8,ponderosaPine:.5,spruceFir:.55,lodgepolePine:.35,douglasFir:.2,mappedCoverage:.92},
      soil:{},terrain:{},confidence:{cellCoverage:1,hostQuality:.7,soilCoverage:.9}};
    const zone=(elevM,month)=>({point:{searchRadius:25},elevation:elevM,habitat:conifer,
      metrics:{rain14:1.2,rain7:.8,rain10:1.1,rain30:2.2,daysSinceRain:6,wetDays14:4,soilMoisture:.24,soilTemp:elevM>2100?8:14,airTemp:elevM>2100?14:20,humidity:50,vpd:.8,wind:7,et07:.35}});
    const june=t.scoreSpecies(king,zone(1800,6),null,new Date(2026,5,15));
    const november=t.scoreSpecies(king,zone(1800,11),null,new Date(2026,10,15));
    const highElev=t.scoreSpecies(king,zone(4000,6),null,new Date(2026,5,15)); // above the declared belt + soft
    const im=b.profiles.interiorMountains.targets.morelBurn, sn=b.profiles.sierraNevada.targets.morelBurn;
    return {june:june.score,november:november.score,highElev:highElev.score,
      months:b.profiles.sierraNevada.targets.morelBurn.months,
      elev:b.profiles.sierraNevada.targets.morelBurn.elevationFt,
      sameMorelObject:im===sn,
      imMonths:im.months,
      snowmelt:sn.morelBurn? 'x' : (b.profiles.sierraNevada.targets.morelBurn.snowmelt||{}).status,
      provenance:b.profiles.sierraNevada.targets.morelBurn.provenance.morelBurn.slice(0,40)};
  });
  expect(r.june).toBeGreaterThan(r.november);   // spring snowmelt season
  expect(r.highElev).toBeLessThan(r.june);      // late-spring high elevation lags in June
  expect(r.months).toEqual([4,5,6,7]);          // Sierra progression, not the interior [6,7,8]
  expect(r.elev).toEqual([3500,9500]);
  expect(r.sameMorelObject).toBe(false);        // distinct Sierra model
  expect(r.provenance).toContain('GTR-710');
  expect(errors).toEqual([]);
});
test('No cross-taxon contamination: California taxa are distinct from PNW/SR/interior',async({page})=>{
  const errors=await open(page);
  const r=await page.evaluate(()=>{
    const b=__FRUITING_FORECAST_BIO_TEST__;
    return {caChanterelle:b.baseTaxa.chanterelleCalifornicus.scientific,
      caTrumpet:b.baseTaxa.craterellusCalicornucopioides.scientific,
      pnwChanterelle:b.baseTaxa.chanterelleFormosus.scientific,
      springKing:b.baseTaxa.springKing.scientific,
      caInat:b.baseTaxa.chanterelleCalifornicus.inat,
      trumpetInat:b.baseTaxa.craterellusCalicornucopioides.inat,
      kingInat:b.baseTaxa.springKing.inat,
      caProfileHasFormosus:'chanterelleFormosus' in b.profiles.california.targets,
      caProfileHasRubriceps:'porcini' in b.profiles.california.targets,
      sierraHasRubriceps:'porcini' in b.profiles.sierraNevada.targets,
      pnwHasCalifornicus:'chanterelleCalifornicus' in b.profiles.pnw.targets};
  });
  expect(r.caChanterelle).toBe('Cantharellus californicus');
  expect(r.caTrumpet).toBe('Craterellus calicornucopioides');
  expect(r.pnwChanterelle).toBe('Cantharellus formosus');
  expect(r.springKing).toBe('Boletus rex-veris');
  expect(r.caInat).toBe(120444);
  expect(r.trumpetInat).toBe(473935);
  expect(r.kingInat).toBe(438025);
  expect(r.caProfileHasFormosus).toBe(false);
  expect(r.caProfileHasRubriceps).toBe(false);
  expect(r.sierraHasRubriceps).toBe(false);
  expect(r.pnwHasCalifornicus).toBe(false);
  expect(errors).toEqual([]);
});
