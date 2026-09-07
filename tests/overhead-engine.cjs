/* Run: node tests/overhead-engine.cjs [satellite.js path] [suncalc.js path]
   Uses the pinned vendored dependencies by default; no npm required. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:0.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0,groups:['stations']};
(async()=>{
 for(const [i,name,url]of [[2,'satellite','https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/dist/satellite.min.js'],[3,'SunCalc','https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js']]){
  global[name]=require(require('node:path').resolve(process.argv[i]||(i===2?'vendor/overhead/satellite-6.0.1.min.js':'vendor/overhead/suncalc-1.9.0.js')));
 }
 vm.runInThisContext(fs.readFileSync('overhead-engine.js','utf8'));const E=OverheadEngine;
 const from=Date.parse('2026-09-07T00:00Z'),to=Date.parse('2026-09-14T00:00Z');
 // Independent published Heavens-Above observations, retrieved 2026-09-07.
 // UTC times. Includes horizon rise from the Princeton Sep 9 pass detail.
 const cases=[
  {name:'Princeton',site:{lat:38.3553,lon:-87.5675},at:'2026-09-09T01:17:02Z',peak:'2026-09-09T01:20:22Z',end:'2026-09-09T01:22:35Z',el:68,dirs:['SW','SE','ENE'],rise:'2026-09-09T01:14:57Z',set:'2026-09-09T01:25:48Z'},
  {name:'London',site:{lat:51.5074,lon:-.1278},at:'2026-09-09T19:56:10Z',peak:'2026-09-09T19:58:44Z',end:'2026-09-09T19:58:44Z',el:23,dirs:['SSW','SSE','SSE']},
  {name:'Cape Town',site:{lat:-33.9249,lon:18.4241},at:'2026-09-10T04:20:28Z',peak:'2026-09-10T04:22:09Z',end:'2026-09-10T04:23:51Z',el:13,dirs:['NNE','NE','E']},
  {name:'Equator',site:{lat:0,lon:0},at:'2026-09-07T04:55:50Z',peak:'2026-09-07T04:57:38Z',end:'2026-09-07T04:59:25Z',el:14,dirs:['NNE','NE','E']}
 ];
 let total=0,daylight=0,shadow=0,high=0,low=0;
 for(const c of cases){const passes=E.detectPasses(ISS,c.site,from,to,10);assert(passes.length>10);total+=passes.length;
  for(const p of passes){assert(p.rise<=p.start&&p.start<=p.peak.t&&p.peak.t<=p.end&&p.end<=p.set);assert(p.orbitalPeak.el>=10);if(p.likely){assert(p.duration>=20);assert(p.peak.lit);assert(p.peak.sun<=-6.01||Math.abs(p.peak.sun+6)<.02);assert(p.peak.el>=9.99);}if(p.peak.sun>0){daylight++;assert(!p.likely);assert.equal(E.scorePass(p,null).score,0);}if(!p.peak.lit){shadow++;assert(!p.likely);}if(p.orbitalPeak.el>85)high++;if(p.orbitalPeak.el<15)low++;}
  {const p=passes.find(p=>Math.abs(p.start-Date.parse(c.at))<60000);assert(p);for(const [field,t]of [['start',c.at],['end',c.end],['rise',c.rise],['set',c.set]])if(t)assert(Math.abs(p[field]-Date.parse(t))<10000,field);assert(Math.abs(p.peak.t-Date.parse(c.peak))<10000);assert(Math.abs(p.peak.el-c.el)<1);assert.deepEqual([p.entry,p.peak,p.exit].map(q=>E.compass(q.az)),c.dirs);
   const hour=Math.floor(p.peak.t/3600000)*3600;const weather=cloud=>({hourly:{time:[hour],cloud_cover:[cloud],visibility:[30000],precipitation:[0]}});
   assert(E.scorePass(p,weather(0)).score>E.scorePass(p,weather(50)).score);assert.equal(E.scorePass(p,weather(100)).score,0);assert(E.scorePass(p,null).provisional);assert(E.scorePass(p,{hourly:{time:[hour],cloud_cover:[null],visibility:[null]}}).provisional);
  }
 }
 assert(daylight>0&&shadow>0&&high>0&&low>0);
 assert.deepEqual(E.detectPasses(ISS,{lat:0,lon:0},from+40*86400000,to+40*86400000),[]);
 const date=new Date(from),sun=satellite.sunPos(satellite.jday(date)).rsun,mag=Math.hypot(...sun);const p={x:sun[0]/mag*6800,y:sun[1]/mag*6800,z:sun[2]/mag*6800};assert(E.illuminated(p,date));assert(!E.illuminated({x:-p.x,y:-p.y,z:-p.z},date));
 for(const [tz,day,hour,iso]of [['America/Chicago','2026-09-07',20,'2026-09-08T01:00:00.000Z'],['Pacific/Auckland','2026-09-07',20,'2026-09-07T08:00:00.000Z'],['America/Chicago','2026-11-01',12,'2026-11-01T18:00:00.000Z'],['Europe/London','2026-03-29',12,'2026-03-29T11:00:00.000Z']])assert.equal(new Date(E.zonedTime(day,hour,tz)).toISOString(),iso);
 const site={lat:38.3553,lon:-87.5675,tz:'America/Chicago'};assert.equal(E.nights(site,Date.parse('2026-09-08T06:00Z'))[0].day,'2026-09-07');assert.equal(E.localDate(Date.parse('2026-09-08T01:00Z'),site.tz),'2026-09-07');
 const polar=E.nights({lat:78.22,lon:15.65,tz:'Arctic/Longyearbyen'},Date.parse('2026-06-21T12:00Z'));assert(polar.every(n=>Number.isFinite(n.start)&&n.end>n.start));
 assert.equal(E.parseElements([ISS],'stations').length,1);assert.throws(()=>E.parseElements({},'stations'));
 console.log(`PASS: ${total} orbital passes across four locations; ${daylight} daylight, ${shadow} shadow, ${high} very high, ${low} low. Four external ISS comparisons, horizon rise/set, scoring, illumination, stale elements, UTC/DST and polar windows passed.`);
})().catch(e=>{console.error(e);process.exit(1)});
