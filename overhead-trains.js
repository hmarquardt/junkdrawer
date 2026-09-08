/* Starlink Train Watch: launch-cohort identification, staged train detection,
   deterministic coherence model and Train Observation Score.
   Consumes OverheadEngine + satellite.js + SunCalc for propagation; no network, no UI.
   A train event is a grouped observational event shaped like a pass (entry/peak/exit/path)
   so it flows through the existing list, detail, sky, map and weekly-ranking layers. */
(function(root){
'use strict';
const DAY=86400000,D=Math.PI/180;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const RULES=Object.freeze({maxAgeDays:10,minMembers:8,maxMembers:80,coarseStepMs:60000,refineStepMs:4000,minVisible:3,
 strongCount:4,maxClusterGapMs:120000,minClusterMs:60000,
 fresh:{maxMedian:1.5,maxSpan:20,minFraction:.6},dispersing:{maxMedian:5,maxSpan:45,minFraction:.4},weak:{maxMedian:12,maxSpan:80},
 staleDays:3,elementWindowDays:14});
function intDes(o){const m=/^(\d{4}-\d{3})/.exec(String(o.OBJECT_ID||''));return m?m[1]:null;}
/* Group Starlink objects by international designator — objects from one launch/deployment
   share it. Names alone are never used to group. Returns {cohorts,skipped}. */
function identifyCohorts(objects,{now=Date.now(),launchDates={},maxAgeDays=RULES.maxAgeDays,minMembers=RULES.minMembers}={}){
 const byId=new Map();
 for(const o of objects){
  if(!/^STARLINK/i.test(String(o.OBJECT_NAME||'')))continue;
  const id=intDes(o);if(!id)continue;
  if(!byId.has(id))byId.set(id,[]);byId.get(id).push(o);
 }
 const cohorts=[],skipped=[];
 for(const [id,members] of byId){
  const launchDate=launchDates[id]||null;
  // SATCAT provides a launch DATE only, not a deployment timestamp: age is approximate.
  const launchAgeDays=launchDate?(now-Date.parse(launchDate+'T12:00:00Z'))/DAY:null;
  const ageSource=launchDate?'SATCAT launch date':'unknown';
  if(members.length<minMembers){skipped.push({id,reason:'Fewer than '+minMembers+' cataloged members'});continue;}
  if(launchAgeDays!==null&&launchAgeDays>maxAgeDays){skipped.push({id,reason:'Launched ~'+Math.round(launchAgeDays)+' days ago (limit '+maxAgeDays+')'});continue;}
  cohorts.push({id,name:'Starlink train '+id,launchDate,ageSource,launchAgeDays:launchAgeDays===null?null:Math.round(launchAgeDays*10)/10,
   members:members.slice().sort((a,b)=>String(a.NORAD_CAT_ID).localeCompare(String(b.NORAD_CAT_ID))).slice(0,RULES.maxMembers),
   memberCount:members.length});
 }
 cohorts.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 return {cohorts,skipped};
}
/* Cheap look angles (no SunCalc/geodetic) for the coarse stage. */
function look(rec,ms,site){
 const date=new Date(ms),pos=satellite.propagate(rec,date).position;
 if(!pos||!Number.isFinite(pos.x))return null;
 const gmst=satellite.gstime(date),ecf=satellite.eciToEcf(pos,gmst);
 const l=satellite.ecfToLookAngles({latitude:site.lat*D,longitude:site.lon*D,height:(site.alt||0)/1000},ecf);
 return {t:ms,el:l.elevation/D,az:l.azimuth/D,ecf,eci:pos,gmst,date};
}
const litOf=s=>root.OverheadEngine.illuminated(s.eci,s.date);
function sunAt(ms,site){return SunCalc.getPosition(new Date(ms),site.lat,site.lon).altitude/D;}
/* Angular separation in the observer's sky between two az/el positions. */
function separation(a,b){
 const u=p=>[Math.cos(p.el*D)*Math.sin(p.az*D),Math.cos(p.el*D)*Math.cos(p.az*D),Math.sin(p.el*D)];
 const x=u(a),y=u(b),d=Math.max(-1,Math.min(1,x[0]*y[0]+x[1]*y[1]+x[2]*y[2]));
 return Math.acos(d)/D;
}
function centroid(lookAngles,site){
 const sum=[0,0,0];
 for(const s of lookAngles){sum[0]+=s.ecf.x;sum[1]+=s.ecf.y;sum[2]+=s.ecf.z;}
 const ecfArr=sum.map(v=>v/lookAngles.length),ecf={x:ecfArr[0],y:ecfArr[1],z:ecfArr[2]};
 const l=satellite.ecfToLookAngles({latitude:site.lat*D,longitude:site.lon*D,height:(site.alt||0)/1000},ecf);
 const g=satellite.eciToGeodetic(ecf,lookAngles[0].gmst);
 return {t:lookAngles[0].t,el:l.elevation/D,az:l.azimuth/D,lat:g.latitude/D,lon:g.longitude/D};
}
/* Deterministic train state from sky geometry. */
function trainState({visibleCount,cohortSize,medianSpacingDeg,spanDeg}){
 const fraction=cohortSize?visibleCount/cohortSize:0;
 if(medianSpacingDeg<=RULES.fresh.maxMedian&&spanDeg<=RULES.fresh.maxSpan&&fraction>=RULES.fresh.minFraction)return 'Fresh Train';
 if(medianSpacingDeg<=RULES.dispersing.maxMedian&&spanDeg<=RULES.dispersing.maxSpan&&fraction>=RULES.dispersing.minFraction)return 'Dispersing Train';
 if(medianSpacingDeg<=RULES.weak.maxMedian&&spanDeg<=RULES.weak.maxSpan&&visibleCount>=5)return 'Weak Train';
 return 'Dispersed';
}
const STATE_WEIGHT={'Fresh Train':1,'Dispersing Train':.7,'Weak Train':.4,'Dispersed':0};
/* Deterministic Train Observation Score. Reuses the page's weather vocabulary;
   deployment age is contextual only (never a direct scoring factor). */
function scoreTrain(metrics,weather,{stale=false}={}){
 const known=!!weather&&Number.isFinite(weather.cloud_cover)&&Number.isFinite(weather.visibility)&&Number.isFinite(weather.precipitation);
 const weight=STATE_WEIGHT[metrics.state]??0;
 const factors={visibleCount:20*Math.min(1,metrics.visibleCount/25),coherence:20*weight,
  elevation:15*clamp(metrics.peakEl/80),strongWindow:10*Math.min(1,metrics.strongSeconds/300),
  darkness:10*clamp((-metrics.sun-3)/12),
  clouds:known?20*(1-weather.cloud_cover/100):0,visibility:known?5*clamp(weather.visibility/20000):0};
 let score=Object.values(factors).reduce((a,b)=>a+b,0);
 if(known)score*=Math.pow(1-weather.cloud_cover/100,1.2)*clamp(weather.visibility/10000,.15,1)*(weather.precipitation>0?.35:1);
 if(stale)score=Math.min(score,70);
 const reasons=[metrics.visibleCount+' of '+metrics.cohortSize+' cohort members visible at once',
  metrics.state+': median spacing '+(+metrics.medianSpacingDeg).toFixed(1)+'°, apparent span '+(+metrics.spanDeg).toFixed(1)+'°',
  Math.round(metrics.peakEl)+'° maximum train elevation',Math.round(metrics.strongSeconds)+' s strong viewing window'];
 if(stale)reasons.push('Orbital elements are stale; the score is capped and confidence reduced');
 if(!known)reasons.push('Weather unavailable; score is provisional');
 return {score:Math.round(clamp(score,0,100)),provisional:!known||stale,factors,reasons};
}


/* Staged detection for one cohort across all planning windows. */
function detectTrains(cohort,site,windows,minimum,{now=Date.now()}={}){
 const diagnostics={cohort:cohort.id,memberCount:cohort.memberCount,propagated:cohort.members.length,launchDate:cohort.launchDate,
  launchAgeDays:cohort.launchAgeDays,ageSource:cohort.ageSource,windowsConsidered:windows.length,rejected:[],candidates:0,samples:0,results:[]};
 const epochs=cohort.members.map(m=>Date.parse(m.EPOCH)).filter(Number.isFinite);
 const newest=epochs.length?Math.max(...epochs):NaN;
 if(!Number.isFinite(newest)||now-newest>RULES.elementWindowDays*DAY){diagnostics.rejected.push({window:'all',reason:'Orbital elements outside the 14-day prediction window'});return {events:[],diagnostics};}
 const stale=now-newest>RULES.staleDays*DAY;
 diagnostics.elementAgeDays=Math.round((now-newest)/DAY*10)/10;
 const recs=cohort.members.map(m=>{try{return satellite.json2satrec(m);}catch{return null;}}).filter(Boolean);
 const ground=s=>{const g=satellite.eciToGeodetic(satellite.eciToEcf(s.eci,s.gmst),s.gmst);return {lat:g.latitude/D,lon:g.longitude/D};};
 // Coherence at one instant: order members along the train's direction of travel
 // (leader ground-track heading), then measure spacing and angular span.
 function measureStep(recs,visible,t){
  const leader=look(recs[0],t,site)||visible[0];
  const ahead=look(recs[0],t+30000,site)||leader,behind=look(recs[0],Math.max(0,t-30000),site)||leader;
  const ga=ground(ahead),gb=ground(behind);
  let dLon=ga.lon-gb.lon;while(dLon>180)dLon-=360;while(dLon<-180)dLon+=360;
  const dLat=ga.lat-gb.lat,g0=ground(visible[0]);
  const proj=s=>{const g=ground(s);let dl=g.lon-g0.lon;while(dl>180)dl-=360;while(dl<-180)dl+=360;return dLat*(g.lat-g0.lat)+dLon*dl;};
  const ordered=visible.slice().sort((a,b)=>proj(a)-proj(b));
  const seps=[];for(let i=1;i<ordered.length;i++)seps.push(separation(ordered[i-1],ordered[i]));
  const sorted=seps.slice().sort((a,b)=>a-b);
  let span=0;for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++)span=Math.max(span,separation(ordered[i],ordered[j]));
  return {t,ordered,count:visible.length,median:sorted.length?sorted[Math.floor(sorted.length/2)]:0,
   span,maxGap:sorted.length?sorted[sorted.length-1]:0};
 }
 const events=[];
 windows.forEach((window,index)=>{
  const sunCache=new Map();const sunOf=t=>{if(!sunCache.has(t))sunCache.set(t,sunAt(t,site));return sunCache.get(t);};
  // Stage 1: coarse 60 s scan of every member across the window.
  const times=[];for(let t=window.start;t<=window.end;t+=RULES.coarseStepMs)times.push(t);
  const coarse=new Map(times.map(t=>[t,[]]));
  for(const rec of recs)for(const t of times){
   diagnostics.samples++;
   const s=look(rec,t,site);
   if(!s||s.el<minimum)continue;
   if(sunOf(t)>-6||!litOf(s))continue;
   coarse.get(t).push(s);
  }
  // Stage 2: contiguous clusters of simultaneous visibility.
  const clusters=[];let cluster=null;
  for(const t of times){
   if(coarse.get(t).length>=RULES.minVisible){
    if(cluster&&t-cluster.end<=RULES.maxClusterGapMs)cluster.end=t;
    else{cluster={start:t,end:t};clusters.push(cluster);}
   }
  }
  if(!clusters.length)diagnostics.rejected.push({window:index,reason:'No time with '+RULES.minVisible+'+ sunlit members above '+minimum+'°'});
  let best=null;
  for(const c of clusters){
   if(c.end-c.start<RULES.minClusterMs){diagnostics.rejected.push({window:index,reason:'Simultaneous visibility under '+Math.round(RULES.minClusterMs/1000)+' s'});continue;}
   diagnostics.candidates++;
   // Stage 3: refine at 4 s; keep the most coherent instant.
   const steps=[];
   for(let t=c.start;t<=c.end+RULES.refineStepMs/2;t+=RULES.refineStepMs){
    const visible=[];
    for(const rec of recs){
     diagnostics.samples++;
     const s=look(rec,t,site);
     if(!s||s.el<minimum)continue;
     if(sunOf(t)>-6||!litOf(s))continue;
     visible.push(s);
    }
    if(visible.length>=RULES.minVisible)steps.push(measureStep(recs,visible,t));
   }
   if(!steps.length){diagnostics.rejected.push({window:index,reason:'Refinement found no coherent instant'});continue;}
   for(const step of steps){
    const state=trainState({visibleCount:step.count,cohortSize:recs.length,medianSpacingDeg:step.median,spanDeg:step.span});
    const key=[step.count,-step.median,-step.span,-step.t].join();
    if(!best||key>best.key)best={...step,state,key,cluster:c,steps};
   }
  }
  if(!best)return;
  if(best.state==='Dispersed'){diagnostics.rejected.push({window:index,reason:'Dispersed: median spacing '+best.median.toFixed(1)+'°, span '+best.span.toFixed(1)+'°'});return;}
  // Strong viewing window: contiguous refine steps around the best instant
  // that keep a strong simultaneous count.
  const strongNeed=Math.max(RULES.strongCount,Math.ceil(.3*best.count));
  const byTime=new Map(best.steps.map(r=>[r.t,r]));
  let a=best.t,b=best.t;
  for(let t=best.t-RULES.refineStepMs;t>=best.cluster.start-RULES.refineStepMs/2;t-=RULES.refineStepMs){const r=byTime.get(t);if(!r||r.count<strongNeed)break;a=t;}
  for(let t=best.t+RULES.refineStepMs;t<=best.cluster.end+RULES.refineStepMs/2;t+=RULES.refineStepMs){const r=byTime.get(t);if(!r||r.count<strongNeed)break;b=t;}
  // Centroid geometry across the full coherent cluster (entry → exit).
  const path=[];const stepPath=Math.max(RULES.refineStepMs,(best.cluster.end-best.cluster.start)/60);
  for(let t=best.cluster.start;t<=best.cluster.end+stepPath/2;t+=stepPath){
   const pts=[];
   for(const rec of recs){const s=look(rec,t,site);if(s&&s.el>0)pts.push(s);}
   if(pts.length)path.push({...centroid(pts,site),range:null,sun:sunOf(t),lit:true});
  }
  if(path.length<2)return;
  const peakSample=path.reduce((p,c)=>c.el>p.el?c:p,path[0]);
  const dots=best.ordered.map(s=>({az:s.az,el:s.el}));
  const event={id:'train-'+cohort.id+'-'+Math.round(best.t/10000),norad:'train-'+cohort.id,name:cohort.name,groups:['trains'],
   epoch:newest,rise:best.cluster.start,set:best.cluster.end,start:best.cluster.start,end:best.cluster.end,
   peak:{...peakSample,lit:true},orbitalPeak:{...peakSample,lit:true},entry:path[0],exit:path[path.length-1],path,
   duration:(b-a)/1000,likely:true,
   train:{cohortId:cohort.id,launchDate:cohort.launchDate,ageSource:cohort.ageSource,launchAgeDays:cohort.launchAgeDays,cohortSize:recs.length,memberCount:cohort.memberCount,
    state:best.state,stale,source:cohort.source||'CelesTrak general catalog',
    visibleCount:best.count,medianSpacingDeg:Math.round(best.median*10)/10,spanDeg:Math.round(best.span*10)/10,
    maxGapDeg:Math.round(best.maxGap*10)/10,strongSeconds:(b-a)/1000,
    dots:dots.length>14?dots.filter((_,i)=>i%Math.ceil(dots.length/14)===0):dots,
    members:best.ordered.map(s=>({az:s.az,el:s.el,t:s.t})),
    memberRecords:cohort.members.map(m=>({name:m.OBJECT_NAME,norad:String(m.NORAD_CAT_ID)}))}};
  events.push({windowIndex:index,event});
  diagnostics.results.push({window:index,state:best.state,visibleCount:best.count,medianSpacingDeg:event.train.medianSpacingDeg,
   spanDeg:event.train.spanDeg,maxGapDeg:event.train.maxGapDeg,stale});
 });
 return {events,diagnostics};
}
/* Attach weather-aware score and presentation fields on the main thread. */
function finalize(event,weather){
 const w=root.OverheadEngine.weatherAt(weather,event.peak.t);
 const scored=scoreTrain({...event.train,peakEl:event.peak.el,sun:event.peak.sun,strongSeconds:event.duration},w,{stale:event.train.stale});
 event.w=w;event.score=scored.score;event.provisional=scored.provisional;event.factors=scored.factors;event.reasons=scored.reasons;event.brightness=1;
 return event;
}
root.OverheadTrains={RULES,identifyCohorts,trainState,scoreTrain,detectTrains,finalize,separation};
if(typeof module!=='undefined')module.exports=root.OverheadTrains;
})(typeof self!=='undefined'?self:globalThis);
