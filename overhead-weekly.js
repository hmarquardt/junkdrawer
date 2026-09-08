/* Weekly interpretation only. Consumes scored passes; never propagates or edits them. */
(function(root){
'use strict';
const HOUR=3600000;
const RULES=Object.freeze({qualityBand:5,tieSignificance:2,tieQuality:3,worthwhile:60,exceptional:90,excellent:75,freshHours:6,confidentLeadHours:72});
function prominence(p){
 const id=String(p.norad),groups=p.groups||[];
 if(id==='25544')return {points:4,label:'ISS'};
 if(id==='48274')return {points:3,label:'Tiangong'};
 if(['20580','25994','27424'].includes(id))return {points:2,label:'Recognizable satellite'};
 if(groups.includes('last-30-days'))return {points:groups.includes('visual')?2:1,label:'Recent launch; individual brightness uncertain'};
 return {points:groups.includes('visual')?1:0,label:groups.includes('visual')?'Bright-catalog candidate':'Uncertain spacecraft'};
}
function weatherConfidence(p,ctx){
 if(p.provisional||!p.w||![p.w.cloud_cover,p.w.visibility,p.w.precipitation].every(Number.isFinite))return 'missing';
 if(!ctx.weatherSource||ctx.weatherSource.stale||ctx.now-ctx.weatherSource.at>RULES.freshHours*HOUR)return 'stale';
 if(p.peak.t-ctx.now>RULES.confidentLeadHours*HOUR)return 'extended forecast';
 return 'current forecast';
}
const median=a=>{const b=a.slice().sort((x,y)=>x-y);return b.length? (b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2:null;};
function classifyEventQuality(p,ctx,relative){
 const reasons=[],downgrades=[],confidence=weatherConfidence(p,ctx),prom=prominence(p);
 const geometry=p.peak.el>=60&&p.duration>=240&&p.peak.sun<=-12&&p.peak.lit===true;
 const weather=p.w&&p.w.cloud_cover<=15&&p.w.visibility>=16000&&p.w.precipitation===0;
 const unusual=relative.medianGap>=10&&relative.sampleCount>=5||relative.sameObjectGap>=8||relative.sampleCount<5&&p.score>=95&&p.peak.el>=75&&p.duration>=300;
 if(p.score<90)downgrades.push('Sighting quality below 90');
 if(!geometry)downgrades.push('Requires ≥60° elevation, ≥4 useful minutes, full sunlight and Sun ≤−12°');
 if(prom.points<3)downgrades.push('Object brightness/prominence does not support a confident exceptional claim');
 if(confidence!=='current forecast')downgrades.push('Weather confidence: '+confidence);
 if(!weather)downgrades.push('Requires ≤15% cloud, ≥16 km visibility and no precipitation');
 if(!unusual)downgrades.push('Not sufficiently distinct from other selected opportunities');
 if(!ctx.complete)downgrades.push('Seven-night source/calculation coverage is incomplete');
 let label=p.score>=75&&p.peak.el>=35&&p.duration>=120?'Excellent':p.score>=60&&p.peak.el>=20&&p.duration>=60?'Good':p.score>=40?'Fair opportunity':'Routine';
 if(!downgrades.length){label='Exceptional';reasons.push('High-quality, high, sustained station pass under clear dark skies',relative.sampleCount<5?'Exceptional absolute geometry; comparison sample is small':'Stands out within the selected seven-night observations');}
 else if(geometry&&prom.points>=3&&confidence!=='current forecast'&&(p.provisional||p.score>=75)){
   label='Potentially exceptional';reasons.push('Excellent station geometry; verify the weather before making plans');
 }
 if(!reasons.length)reasons.push(label==='Routine'?'Best available does not mean worth a special trip':'Useful observing quality, without an exceptional claim');
 return {label,confidence,reasons,downgrades,exceptional:label==='Exceptional'};
}
function calculateEventSignificance(p,relative){
 const object=prominence(p),relativeBonus=relative.sampleCount>=5?Math.min(2,Math.max(0,relative.medianGap)/10):0;
 return {value:Math.round((p.score+object.points+relativeBonus)*10)/10,quality:p.score,prominence:object,relativeBonus};
}
function findComparableEvents(event,entries){return entries.filter(e=>e.pass.id!==event.pass.id&&e.pass.start>event.pass.start&&e.pass.score>=event.pass.score-3&&e.pass.peak.el>=event.pass.peak.el-15&&e.pass.duration>=event.pass.duration*.7&&e.classification.confidence===event.classification.confidence).sort((a,b)=>a.pass.start-b.pass.start);}
function rankWeeklyEvents(results,windows,options={}){
 const ctx={now:Date.now(),complete:false,...options},seen=new Set(),pool=[];
 windows.slice(0,7).forEach((night,index)=>{for(const p of results[index]||[]){if(seen.has(p.id)||!p.likely||p.end<=ctx.now||p.start<night.start||p.start>=night.end||p.peak.sun> -6||!p.peak.lit||!Number.isFinite(p.score))continue;seen.add(p.id);pool.push({pass:p,night:index});}});
 const center=median(pool.map(e=>e.pass.score)),byObject=new Map();
 for(const e of pool){const key=String(e.pass.norad);if(!byObject.has(key))byObject.set(key,[]);byObject.get(key).push(e.pass);}
 for(const values of byObject.values())values.sort((a,b)=>b.score-a.score);
 const entries=pool.map(e=>{const same=byObject.get(String(e.pass.norad)),other=same[0].id===e.pass.id?same[1]:same[0],sameBest=other?.score??null;
   const relative={sampleCount:pool.length,medianGap:e.pass.score-(center??e.pass.score),sameObjectGap:sameBest===null?null:e.pass.score-sameBest};
   return {...e,relative,significance:calculateEventSignificance(e.pass,relative),classification:classifyEventQuality(e.pass,ctx,relative)};});
 const order=(a,b)=>b.significance.value-a.significance.value||a.pass.start-b.pass.start||a.pass.id.localeCompare(b.pass.id);
 entries.sort(order);
 const highestQuality=entries.slice().sort((a,b)=>b.pass.score-a.pass.score||a.pass.start-b.pass.start)[0]||null;
 const candidates=entries.filter(e=>e.pass.score>=(highestQuality?.pass.score??0)-RULES.qualityBand).sort(order);
 const leading=candidates[0],ties=leading?candidates.filter(e=>leading.significance.value-e.significance.value<=RULES.tieSignificance&&Math.abs(e.pass.score-leading.pass.score)<=RULES.tieQuality):[];
 const winner=ties.slice().sort((a,b)=>b.significance.prominence.points-a.significance.prominence.points||a.pass.start-b.pass.start||order(a,b))[0]||null;
 const runnerUp=candidates.find(e=>e!==winner)||entries.find(e=>e!==winner)||null;
 const bestNights=windows.slice(0,7).map((_,i)=>entries.filter(e=>e.night===i).sort((a,b)=>b.pass.score-a.pass.score||order(a,b))[0]||null);
 return {complete:ctx.complete,eventsConsidered:entries.length,medianQuality:center,winner,runnerUp,highestQuality,bestISS:entries.filter(e=>String(e.pass.norad)==='25544').sort((a,b)=>b.pass.score-a.pass.score||order(a,b))[0]||null,bestNights,
   noWorthwhileNights:bestNights.flatMap((e,i)=>!e||e.pass.score<RULES.worthwhile?[i]:[]),ties,
   scoreGap:winner&&runnerUp?winner.pass.score-runnerUp.pass.score:null,significanceGap:winner&&runnerUp?+(winner.significance.value-runnerUp.significance.value).toFixed(1):null,
   comparable:winner?findComparableEvents(winner,entries):[],entries,horizonEnd:windows[6]?.end??null,
   exceptionalCount:entries.filter(e=>e.classification.exceptional).length,uncertain:entries.some(e=>e.classification.confidence!=='current forecast')};
}
function buildViewingInstruction(p,{time,now=Date.now()}){
 const directions=['north','north-northeast','northeast','east-northeast','east','east-southeast','southeast','south-southeast','south','south-southwest','southwest','west-southwest','west','west-northwest','northwest','north-northwest'];
 const direction=directions[Math.round(((p.entry.az%360)+360)%360/22.5)%16];
 const when=p.start<=now?'now':'around '+time(Math.floor(Math.max(now,p.start-120000)/60000)*60000);
 return (p.peak.el>=75?'This pass goes almost overhead. ':'')+'Go outside '+when+' and face '+direction+'.'+(p.peak.el<30?' Look low above the horizon.':'');
}
root.OverheadWeekly={RULES,prominence,weatherConfidence,classifyEventQuality,calculateEventSignificance,rankWeeklyEvents,findComparableEvents,buildViewingInstruction};
if(typeof module!=='undefined')module.exports=root.OverheadWeekly;
})(typeof self!=='undefined'?self:globalThis);
