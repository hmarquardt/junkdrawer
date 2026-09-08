const assert=require('node:assert/strict');
const W=require('../overhead-weekly.js');
const now=Date.parse('2026-09-07T18:00Z'),day=86400000;
const windows=Array.from({length:7},(_,i)=>({start:now+i*day,end:now+(i+1)*day,day:'night-'+i}));
function pass(t,overrides={}){
 const point={t,el:81,az:315,sun:-18,lit:true,range:450,lat:38,lon:-87};
 return {id:'pass-'+t,norad:'25544',name:'ISS',groups:['stations'],epoch:now-3600000,start:t,end:t+342000,rise:t-60000,set:t+400000,duration:342,likely:true,provisional:false,score:96,brightness:1,peak:{...point,t:t+171000},orbitalPeak:{...point,t:t+171000},entry:{...point,el:10},exit:{...point,t:t+342000,el:10,az:90},path:[{...point,el:10},{...point},{...point,el:10,az:90}],w:{cloud_cover:0,visibility:25000,precipitation:0},...overrides};
}
const rank=(list,options={})=>W.rankWeeklyEvents(Object.fromEntries(windows.map((n,i)=>[i,list.filter(p=>p.start>=n.start&&p.start<n.end)])),windows,{now,complete:true,weatherSource:{at:now},...options});
if(require.main===module){
 const cases=[];function check(name,fn){fn();cases.push(name);}
 check('1 obvious exceptional ISS',()=>{const r=rank([pass(now+3600000),pass(now+day,{score:72})]);assert.equal(r.winner.classification.label,'Exceptional');assert.equal(r.scoreGap,24);});
 check('2 mediocre week',()=>{const r=rank([48,53,51,46].map((score,i)=>pass(now+(i+1)*3600000,{score})));assert.equal(r.exceptionalCount,0);assert(r.winner.pass.score<=53);assert.equal(r.winner.classification.label,'Fair opportunity');assert.equal(r.noWorthwhileNights.length,7);});
 check('3 effectively tied excellent passes',()=>{const r=rank([pass(now+3600000,{score:88}),pass(now+7200000,{score:89})]);assert.equal(r.ties.length,2);assert.equal(r.winner.pass.score,88);assert.equal(r.winner.classification.label,'Excellent');});
 check('4 heavy clouds',()=>{const r=rank([pass(now+3600000,{score:8,w:{cloud_cover:90,visibility:25000,precipitation:0}})]);assert.equal(r.winner.classification.label,'Routine');});
 check('5 missing weather',()=>{const r=rank([pass(now+3600000,{score:75,provisional:true,w:null})]);assert.equal(r.winner.classification.label,'Potentially exceptional');});
 check('6 obscure quality vs ISS significance',()=>{const r=rank([pass(now+3600000,{score:83,norad:'12345',groups:['visual'],name:'Obscure'}),pass(now+7200000,{score:81})]);assert.equal(r.highestQuality.pass.score,83);assert.equal(r.winner.pass.norad,'25544');assert.equal(r.winner.pass.score,81);const far=rank([pass(now+3600000,{score:83,norad:'12345',groups:['visual']}),pass(now+7200000,{score:70})]);assert.equal(far.winner.pass.norad,'12345');});
 check('7 no passes',()=>assert.equal(rank([]).winner,null));
 check('8 daylight only',()=>assert.equal(rank([pass(now+3600000,{likely:false}),pass(now+7200000,{peak:{el:81,t:now+7200000,sun:10,lit:true}})]).winner,null));
 check('9 low long pass',()=>{const p=pass(now+3600000,{score:61,duration:600});p.peak.el=15;const r=rank([p]);assert.equal(r.winner.classification.label,'Fair opportunity');assert.match(W.buildViewingInstruction(p,{time:()=> '7 PM',now}),/Look low/);});
 check('10 overhead short pass',()=>{const p=pass(now+3600000,{score:82,duration:25});assert.equal(rank([p]).winner.classification.label,'Fair opportunity');});
 check('11 observing-night ownership crosses UTC dates',()=>{const p=pass(Date.parse('2026-09-08T01:15Z'));assert.equal(rank([p]).winner.night,0);assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'long'}).format(p.start),'Monday');assert.match(W.buildViewingInstruction(p,{time:t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(t),now}),/8:13 PM.*northwest/);});
 check('12 weather changes winner',()=>{const a=pass(now+3600000),b=pass(now+7200000,{score:80});assert.equal(rank([a,b]).winner.pass.id,a.id);const updated={...a,score:12,w:{cloud_cover:85,visibility:25000,precipitation:0}};assert.equal(rank([updated,b]).winner.pass.id,b.id);});
 check('stale / extended / incomplete not exceptional',()=>{assert.equal(rank([pass(now+3600000)],{weatherSource:{at:now-7*3600000}}).winner.classification.label,'Potentially exceptional');assert.equal(rank([pass(now+4*day)]).winner.classification.label,'Potentially exceptional');assert.notEqual(rank([pass(now+3600000)],{complete:false}).winner.classification.label,'Exceptional');});
 check('deduplication, elapsed and NOW exclusion; input immutable',()=>{const p=pass(now+3600000),results={0:[p,p,pass(now-3600000)],7:[pass(now+7200000)]},before=JSON.stringify(results);const r=W.rankWeeklyEvents(results,windows,{now,complete:true,weatherSource:{at:now}});assert.equal(r.eventsConsidered,1);assert.equal(JSON.stringify(results),before);});
 check('same-class comparisons and actual horizon',()=>{const r=rank([pass(now+3600000),pass(now+day,{score:95})]);assert.equal(r.comparable.length,1);assert.equal(r.horizonEnd,windows[6].end);});
 check('ordinary repetitive high week is not exceptional',()=>{const r=rank([90,91,92,91,90,92].map((score,i)=>pass(now+(i+1)*3600000,{score})));assert.equal(r.exceptionalCount,0);});
 // A parameter sweep uses the unchanged real scorer, rather than hand-assigned quality.
 require('node:vm').runInThisContext(require('node:fs').readFileSync(require.resolve('../overhead-engine.js'),'utf8'));
 const sweep=[];
 for(const norad of ['25544','48274','12345'])for(const el of [15,35,60,81])for(const duration of [30,120,240,360])for(const sun of [-6,-12,-18])for(const cloud of [0,10,30,80]){
  const p=pass(now+3600000+sweep.length*1000,{norad,groups:['visual'],duration});p.id='sweep-'+sweep.length;p.peak.el=el;p.peak.sun=sun;
  const hour=Math.floor(p.peak.t/3600000)*3600,weather={hourly:{time:[hour],cloud_cover:[cloud],visibility:[25000],precipitation:[0]}};
  Object.assign(p,OverheadEngine.scorePass(p,weather));sweep.push(p);
 }
 const distribution=rank(sweep),counts={};for(const e of distribution.entries)counts[e.classification.label]=(counts[e.classification.label]||0)+1;
 assert(distribution.exceptionalCount>0);assert(distribution.exceptionalCount<distribution.eventsConsidered*.1);
 assert(distribution.entries.filter(e=>e.classification.exceptional).every(e=>e.pass.w.cloud_cover<=15&&e.pass.peak.el>=60&&e.pass.duration>=240&&e.pass.score>=90));
 const maxBright=Math.max(...sweep.filter(p=>p.norad==='12345').map(p=>p.score));assert.equal(maxBright,83);
 console.log('PASS '+cases.length+' weekly scenarios:\n'+cases.join('\n')+'\nReal-scoring sweep ('+sweep.length+' geometry/weather/category combinations): '+JSON.stringify(counts)+'; ordinary bright maximum '+maxBright);
}
module.exports={pass,now,windows,rank};
