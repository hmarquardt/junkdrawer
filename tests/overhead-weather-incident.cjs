const assert=require('node:assert/strict'),capture=require('./fixtures/overhead-incident-2026-09-08.json');require('../overhead-engine.js');
const E=OverheadEngine,{pass:p,weather}=capture,h=weather.hourly,index=Math.floor((p.peak.t/1000-h.time[0])/3600);
assert.equal(weather.hourly_units.time,'unixtime');assert.equal(weather.timezone,'America/Chicago');assert.equal(weather.utc_offset_seconds,-18000);assert.equal(index,44);
assert(h.time.every((t,i)=>i===0||t-h.time[i-1]===3600));assert.equal(h.time[index],1788915600);assert.equal(new Date(h.time[index]*1000).toISOString(),'2026-09-09T01:00:00.000Z');
assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(h.time[index]*1000),'8:00 PM CDT');
const w=E.weatherAt(weather,p.peak.t);for(const key of Object.keys(w))assert.equal(w[key],h[key][index]);
assert.deepEqual([w.cloud_cover,w.cloud_cover_low,w.cloud_cover_mid,w.cloud_cover_high,w.visibility,w.precipitation,w.weather_code],[100,0,0,100,37600,0,3]);
assert.equal(h.cloud_cover[index-1],100);assert.equal(h.cloud_cover[index+1],47);
const score=E.scorePass(p,weather),base=Object.values(score.factors).reduce((a,b)=>a+b,0);assert(base>77&&base<78);assert.equal(score.brightness,1);assert.equal(score.provisional,false);assert.equal(Math.pow(1-w.cloud_cover/100,1.2),0);assert.equal(score.score,0);
for(const missing of [null,undefined]){const copy=structuredClone(weather);copy.hourly.cloud_cover[index]=missing;assert(E.scorePass(p,copy).provisional);assert(E.scorePass(p,copy).score>0);}
// UTC hourly instants disambiguate Chicago's repeated 1 AM at the autumn DST transition.
const times=['2026-11-01T06:00Z','2026-11-01T07:00Z'].map(t=>Date.parse(t)/1000),dst={hourly:{time:times,cloud_cover:[10,90]}};
assert.equal(E.weatherAt(dst,Date.parse('2026-11-01T06:20Z')).cloud_cover,10);assert.equal(E.weatherAt(dst,Date.parse('2026-11-01T07:20Z')).cloud_cover,90);
for(const t of capture.traces){assert.equal(t.rankBeforeFilters,136);assert.equal(t.rankAfterScoreFilter,136);assert.equal(t.rankAfterShowFilter,136);assert.equal(t.rankAfterLimit,null);assert.equal(t.renderedInDOM,false);assert.equal(t.best.name,'SL-8 R/B');assert(t.best.start.includes('4:18:14 AM'));assert.equal(t.weatherSource.stale,false);assert.equal(t.weatherSource.cache,false);}
console.log('PASS: captured index 44, UTC/CDT association, raw cloud layers, score-0 arithmetic, null/undefined safety, DST repeat, and three pre-fix rank-136 DOM omissions. Base points:',base);
