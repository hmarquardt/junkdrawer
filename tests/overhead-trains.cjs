/* Starlink Train Watch validation: run `node tests/overhead-trains.cjs`.
   Propagation scenarios use real SGP4 with synthetic, deterministic launch cohorts;
   scoring/state/weekly scenarios use the pure functions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.satellite=require('../vendor/overhead/satellite-6.0.1.min.js');
global.SunCalc=require('../vendor/overhead/suncalc-1.9.0.js');
vm.runInThisContext(fs.readFileSync(__dirname+'/../overhead-engine.js','utf8'));
require('../overhead-weekly.js');require('../overhead-trains.js');
const E=global.OverheadEngine,W=global.OverheadWeekly,T=global.OverheadTrains;
const now=Date.parse('2026-09-08T18:00Z'),DAY=86400000;
const site={lat:38.3553,lon:-87.5675,alt:0,tz:'America/Chicago'};
const siteN={lat:55.5,lon:-87.5,alt:0,tz:'America/Chicago'};
const windows=E.nights(site,now).map(n=>({start:n.start,end:n.end,day:n.day}));
const windowsN=E.nights(siteN,now).map(n=>({start:n.start,end:n.end,day:n.day}));
const freshEpoch=new Date(now-6*3600000).toISOString().replace('Z',''),staleEpoch=new Date(now-6*DAY).toISOString().replace('Z','');
function mk(n,stepMA,raan=140,epoch=freshEpoch,prefix=197){const members=[];for(let i=0;i<n;i++){members.push({OBJECT_NAME:'STARLINK-'+(60000+i),OBJECT_ID:'2026-'+prefix+'-'+(100+i),NORAD_CAT_ID:60000+i,EPOCH:epoch,MEAN_MOTION:15.06,MEAN_MOTION_DOT:.00002,MEAN_MOTION_DDOT:0,ECCENTRICITY:.0001,INCLINATION:53,RA_OF_ASC_NODE:raan,ARG_OF_PERICENTER:0,MEAN_ANOMALY:(i*stepMA)%360,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',ELEMENT_SET_NO:999,REV_AT_EPOCH:100,BSTAR:0});}return members;}
const cohortOf=(members,extra={})=>({id:'2026-197',name:'Starlink train 2026-197',launchDate:'2026-09-08',ageSource:'SATCAT launch date',launchAgeDays:.3,members,memberCount:members.length,source:'CelesTrak SupGP · SpaceX ephemeris',...extra});
const weekWeather=(cloud=6,vis=25000,precip=0)=>({hourly:{time:Array.from({length:220},(_,i)=>Math.floor(now/3600000)*3600+i*3600-48*3600),cloud_cover:Array(220).fill(cloud),visibility:Array(220).fill(vis),precipitation:Array(220).fill(precip)}});
const clear=weekWeather();
const cases=[];const check=(name,fn)=>{fn();cases.push(name);};
const firstEvent=(members,siteX=site,wins=windows.slice(0,3),minimum=10)=>T.finalize(T.detectTrains(cohortOf(members),siteX,wins,minimum,{now}).events[0].event,clear);
/* 1 fresh tightly grouped deployment */
check('1 fresh tightly grouped deployment',()=>{
 const e=firstEvent(mk(24,.05));
 assert.equal(e.train.state,'Fresh Train');assert.equal(e.train.visibleCount,24);
 assert.ok(e.train.medianSpacingDeg<=1.5&&e.train.spanDeg<=20);
 assert.ok(e.peak.el>70);assert.ok(e.score>=85&&e.score<=97,'fresh clear train scores high without saturation');
 assert.equal(e.provisional,false);
 // Normalization: ideal base factors sum to exactly 100 with no clamp and no saturation.
 const perfect=T.scoreTrain({state:'Fresh Train',visibleCount:30,cohortSize:30,medianSpacingDeg:.5,spanDeg:15,peakEl:80,sun:-18,strongSeconds:300},
  {cloud_cover:0,visibility:25000,precipitation:0});
 assert.equal(Object.values(perfect.factors).reduce((a,v)=>a+v,0),100);
 assert.equal(perfect.score,100);
 assert.ok(e.train.dots.length<=14);assert.ok(e.path.length>=2);
 assert.ok(Number.isFinite(e.peak.lat)&&Number.isFinite(e.peak.lon));
});
/* 2 dispersing group */
check('2 dispersing group',()=>{
 const e=firstEvent(mk(24,.1));
 assert.equal(e.train.state,'Dispersing Train');assert.ok(e.train.spanDeg>20);
 assert.ok(e.score<100&&e.score>60);
});
/* 3 fully dispersed group */
check('3 fully dispersed group is never surfaced',()=>{
 const r=T.detectTrains(cohortOf(mk(24,4)),site,windows.slice(0,3),10,{now});
 assert.equal(r.events.length,0);
 assert(r.diagnostics.rejected.some(x=>/Dispersed|No time with/.test(x.reason)));
});
/* 4 only a few cohort members visible */
check('4 only a few cohort members visible weakens the claim',()=>{
 const r=T.detectTrains(cohortOf(mk(24,.05)),site,windows.slice(0,3),60,{now});
 const e=T.finalize(r.events.find(x=>x.windowIndex===0).event,clear);
 assert.ok(e.train.visibleCount<24);assert.notEqual(e.train.state,'Fresh Train');
});
/* 5 excellent geometry but cloudy weather */
check('5 excellent geometry but cloudy weather scores honestly',()=>{
 const r=T.detectTrains(cohortOf(mk(24,.05)),site,windows.slice(0,3),10,{now});
 const e=T.finalize(r.events[0].event,weekWeather(92,9000,0));
 assert.ok(e.score<55);assert.equal(e.provisional,false);
 const f=T.finalize(structuredClone(r.events[0].event),clear);
 assert.ok(f.score-e.score>=25);
});
/* 6 excellent geometry with missing weather */
check('6 missing weather makes the train provisional',()=>{
 const r=T.detectTrains(cohortOf(mk(24,.05)),site,windows.slice(0,3),10,{now});
 const e=T.finalize(r.events[0].event,null);
 assert.equal(e.provisional,true);assert.ok(e.factors.clouds===0&&e.factors.visibility===0);
});
/* 7 fresh launch but daylight */
check('7 daylight windows are rejected outright',()=>{
 const day={start:Date.parse('2026-09-08T18:00Z'),end:Date.parse('2026-09-08T20:00Z')};
 const r=T.detectTrains(cohortOf(mk(24,.05)),site,[day],10,{now});
 assert.equal(r.events.length,0);
 assert(r.diagnostics.rejected.some(x=>/sunlit/.test(x.reason)));
});
/* 8 low-elevation train */
check('8 low-elevation train scores below the same train overhead',()=>{
 const rLow=T.detectTrains(cohortOf(mk(24,.05)),siteN,windowsN.slice(0,2),10,{now});
 const low=T.finalize(rLow.events.find(x=>x.event.peak.el<30).event,clear);
 const high=firstEvent(mk(24,.05));
 assert.ok(low.peak.el<30&&high.peak.el>70);
 assert.ok(low.score<high.score);
 assert(W.classifyEventQuality(low,{now,complete:true,weatherSource:{at:now}},{sampleCount:9,medianGap:12}).label);
});
/* 9 cohort crosses nearly overhead */
check('9 near-overhead cohort peaks high with a strong window',()=>{
 const e=firstEvent(mk(24,.05));
 assert.ok(e.peak.el>=70);assert.ok(e.duration>=120);
 assert.equal(e.train.strongSeconds,e.duration);
});
/* 10 high member count but huge angular span */
check('10 huge angular span is not a train state',()=>{
 assert.equal(T.trainState({visibleCount:30,cohortSize:30,medianSpacingDeg:2,spanDeg:120}),'Dispersed');
 assert.equal(T.scoreTrain({state:'Dispersed',visibleCount:30,cohortSize:30,medianSpacingDeg:2,spanDeg:120,peakEl:80,sun:-18,strongSeconds:300},clear).factors.coherence,0);
});
/* 11 small span but only 2-3 visible satellites */
check('11 three visible members of a large cohort cannot claim Fresh',()=>{
 assert.equal(T.trainState({visibleCount:3,cohortSize:24,medianSpacingDeg:.4,spanDeg:3}),'Dispersed');
 assert.equal(T.trainState({visibleCount:2,cohortSize:24,medianSpacingDeg:.4,spanDeg:3}),'Dispersed');
});
/* 12 stale elements */
check('12 stale elements cap the score and refuse confident claims',()=>{
 const capped=T.scoreTrain({state:'Fresh Train',visibleCount:24,cohortSize:24,medianSpacingDeg:.5,spanDeg:14,peakEl:84,sun:-18,strongSeconds:300},clear,{stale:true});
 assert.ok(capped.score<=70);assert.equal(capped.provisional,true);
 let found=null;
 for(let raan=0;raan<360&&!found;raan+=20){
  const r=T.detectTrains(cohortOf(mk(24,.05,raan,staleEpoch)),site,windows.slice(0,3),10,{now});
  if(r.events.length)found=r.events[0].event;
 }
 assert(found,'stale-elements cohort still detects somewhere in 3 nights');
 assert.equal(found.train.stale,true);
 const e=T.finalize(found,clear);assert.ok(e.score<=70);assert.equal(e.provisional,true);
 assert(e.reasons.some(x=>/stale/.test(x)));
});

/* 13 cohort identification and fallback labeling */
check('13 cohorts group by international designator, never by name alone',()=>{
 const objects=[...mk(10,.05,140,freshEpoch,197),...mk(9,.05,140,freshEpoch,198),...mk(3,.05,140,freshEpoch,199),
  {OBJECT_NAME:'OTHERSAT',OBJECT_ID:'2026-197ZZ',NORAD_CAT_ID:88888,EPOCH:freshEpoch,MEAN_MOTION:15.06,MEAN_MOTION_DOT:0,MEAN_MOTION_DDOT:0,INCLINATION:53,ECCENTRICITY:.0001,RA_OF_ASC_NODE:0,ARG_OF_PERICENTER:0,MEAN_ANOMALY:0,BSTAR:0}];
 const before=JSON.stringify(objects);
 const {cohorts,skipped}=T.identifyCohorts(objects,{now,launchDates:{'2026-197':'2026-09-08','2026-198':'2026-09-05'}});
 assert.equal(JSON.stringify(objects),before);
 assert.deepEqual(cohorts.map(c=>c.id),['2026-197','2026-198']);
 assert.ok(cohorts[0].members.length===10&&cohorts[1].members.length===9);
 assert.equal(cohorts[0].ageSource,'SATCAT launch date');assert.ok(cohorts[0].launchAgeDays!==null);
 assert(skipped.some(s=>s.id==='2026-199'));
 const aged=T.identifyCohorts(mk(10,.05,140,freshEpoch,197),{now,launchDates:{'2026-197':'2026-08-01'}});
 assert.equal(aged.cohorts.length,0);assert(aged.skipped.some(s=>/Launched ~38 days ago/.test(s.reason)));
 const noDate=T.identifyCohorts(mk(10,.05,140,freshEpoch,197),{now});
 assert.equal(noDate.cohorts.length,1);assert.equal(noDate.cohorts[0].launchAgeDays,null);assert.equal(noDate.cohorts[0].ageSource,'unknown');
});
/* 14 supplemental feed unavailable → general-catalog fallback */
check('14 detection runs on general-catalog elements when SupGP is unavailable',()=>{
 const fallback=cohortOf(mk(24,.05),{source:'CelesTrak general catalog (SupGP unavailable)'});
 const r=T.detectTrains(fallback,site,windows.slice(0,3),10,{now});
 assert(r.events.length>0);
 assert.equal(r.events[0].event.train.source,'CelesTrak general catalog (SupGP unavailable)');
});
/* 15 stale train can never be Exceptional in the weekly layer */
check('15 stale train is never classified Exceptional by the weekly layer',()=>{
 let f=null;
 for(let raan=0;raan<360&&!f;raan+=20){
  const r=T.detectTrains(cohortOf(mk(24,.05,raan,staleEpoch)),site,windows.slice(0,3),10,{now});
  if(r.events.length)f=r.events[0].event;
 }
 const staleEvent=T.finalize(f,clear);
 const c=W.classifyEventQuality(staleEvent,{now,complete:true,weatherSource:{at:now}},{sampleCount:9,medianGap:12,sameObjectGap:null});
 assert.notEqual(c.label,'Exceptional');assert(c.downgrades.some(x=>/stale/i.test(x)));
});
/* 16 train vs ISS for Best Thing This Week: competitive, never forced either way */
check('16 spectacular train outranks an ordinary ISS pass; a superb ISS pass is not forced to lose',()=>{
 const {pass}=require('./overhead-weekly.cjs');
 const fresh=T.finalize(T.detectTrains(cohortOf(mk(24,.05)),site,windows.slice(0,3),10,{now}).events[0].event,clear);
 const weak=T.finalize(T.detectTrains(cohortOf(mk(24,.05)),siteN,windowsN.slice(0,2),10,{now}).events.find(x=>x.event.peak.el<30).event,weekWeather(80,8000,0));
 const empty=Object.fromEntries(windows.map((n,i)=>[i,[]]));
 // Fresh clear train (significance = score+4, ~99) comfortably beats an ordinary ISS pass.
 const ordinary=pass(windows[0].start+7200000,{score:78});
 const r1=W.rankWeeklyEvents({...empty,0:[fresh,ordinary]},windows,{now,complete:true,weatherSource:{at:now}});
 assert.ok(r1.winner.pass.train);assert.equal(r1.winner.pass.train.cohortId,'2026-197');
 assert.ok(r1.significanceGap>0);
 // A superb ISS 96 pass narrowly beats the same train: no forced Starlink wins.
 const superb=pass(windows[0].start+7200000);
 const r2=W.rankWeeklyEvents({...empty,0:[fresh,superb]},windows,{now,complete:true,weatherSource:{at:now}});
 // After normalization a fresh clear train (~91) sits just below a superb ISS 96: no saturation, no forced winner.
 assert.equal(r2.winner.pass.norad,'25544');assert.ok(r2.scoreGap>0&&r2.scoreGap<=8);
 // A weak hazy low train loses clearly to the same superb ISS pass.
 const r3=W.rankWeeklyEvents({...empty,0:[weak,superb]},windows,{now,complete:true,weatherSource:{at:now}});
 assert.equal(r3.winner.pass.norad,'25544');assert.ok(r3.scoreGap>20);
 // Weekly results expose trains through bestISS exclusion and best night.
 const r4=W.rankWeeklyEvents({...empty,0:[fresh]},windows,{now,complete:true,weatherSource:{at:now}});
 assert.equal(r4.bestISS,null);assert.equal(r4.bestNights[0].pass.train.state,'Fresh Train');
 assert.equal(r4.winner.classification.label,'Excellent'); // selective: small-sample trains need score ≥ 95 for Exceptional
});
/* 17 night ownership across local midnight */
check('17 every train is owned by the window containing it',()=>{
 const all=[];
 for(let raan=0;raan<360;raan+=20){
  const r=T.detectTrains(cohortOf(mk(24,.05,raan)),site,windows,10,{now});
  for(const {windowIndex,event} of r.events)all.push({windowIndex,event});
 }
 assert(all.length>0);
 for(const {windowIndex,event} of all)assert(event.start>=windows[windowIndex].start&&event.start<windows[windowIndex].end);
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:site.tz,hour:'numeric',hourCycle:'h23'});
 assert(all.some(({event})=>+fmt.format(new Date(event.peak.t))<6),'at least one train runs past local midnight');
});
/* 18 two recent cohorts in the same week */
check('18 two cohorts in one week rank independently and deterministically',()=>{
 const a=firstEvent(mk(24,.05));
 const b=T.finalize(T.detectTrains(cohortOf(mk(24,.1)),site,windows.slice(0,3),10,{now}).events[0].event,clear);
 b.id='train-2026-196-x';b.norad='train-2026-196';b.name='Starlink train 2026-196';b.train.cohortId='2026-196';
 const empty=Object.fromEntries(windows.map((n,i)=>[i,[]]));
 const r=W.rankWeeklyEvents({...empty,0:[a,b]},windows,{now,complete:true,weatherSource:{at:now}});
 assert.equal(r.eventsConsidered,2);assert.equal(r.winner.pass.train.cohortId,'2026-197');
 assert.ok(r.scoreGap>=0);
 const r2=W.rankWeeklyEvents({...empty,0:[b,a]},windows,{now,complete:true,weatherSource:{at:now}});
 assert.equal(r2.winner.pass.train.cohortId,'2026-197');
});
/* geometry primitive sanity */
check('19 separation primitive is correct',()=>{
 assert.ok(Math.abs(T.separation({az:0,el:0},{az:0,el:0}))<1e-9);
 assert.ok(Math.abs(T.separation({az:0,el:0},{az:180,el:0})-180)<1e-9);
 assert.ok(Math.abs(T.separation({az:0,el:30},{az:90,el:30})-75.5225)<1e-3);
});
/* 20 public freshness formatter (footer): aggregation, no raw keys, stale states */
check('20 public footer freshness is aggregated, key-free and honest',()=>{
 const now=Date.parse('2026-09-08T18:00Z');
 const F=src=>E.publicFreshness(src,now);
 const at=m=>now-m*60000;
 // Weather appears at most once even with multiple weather keys (e.g. after a location change).
 const multi=F({'weather:38.355,-87.568':{at:at(5)},'weather:51.5,-0.1':{at:at(90)},'orbits:stations':{at:at(120)},'orbits:visual':{at:at(130)},'orbits:last-30-days':{at:at(10)},'orbits:supgp:2026-197':{at:at(18)},'orbits:supgp:2026-196':{at:at(24)},'satcat:2026-197':{at:at(2)}});
 assert.equal(multi.split('Weather updated').length-1,1);
 assert(multi.includes('Orbital data updated 2h ago'),'orbital uses the oldest active catalog');
 assert(multi.includes('Starlink supplemental data updated 18m ago'),'supgp aggregates to the freshest');
 assert(!multi.includes('satcat:')&&!multi.includes('orbits:')&&!multi.includes('weather:'),'no raw keys leak');
 assert(!multi.includes('2026-197'),'no cohort identifiers leak');
 // Stale states are compact and explicit.
 assert.equal(F({'weather:38.355,-87.568':{at:at(5),stale:true}}),'Weather: stale cached forecast');
 assert.equal(F({'orbits:stations':{at:at(120),stale:true}}),'Orbital data: stale cache · refresh recommended');
 assert.equal(F({'orbits:supgp:2026-197':{at:at(18),stale:true}}),'Starlink supplemental data updated 18m ago (stale cache)');
 // SATCAT-only and empty source sets.
 assert.equal(F({'satcat:2026-197':{at:at(2)}}),'No source data available');
 assert.equal(F({}),'No source data available');
});

console.log('PASS '+cases.length+' train scenarios:\n'+cases.join('\n'));

