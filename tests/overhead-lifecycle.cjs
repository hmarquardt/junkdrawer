/* Historical reproduction first: node tests/overhead-lifecycle.cjs --before */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
global.satellite=require('../vendor/overhead/satellite-6.0.1.min.js');global.SunCalc=require('../vendor/overhead/suncalc-1.9.0.js');
require('../overhead-engine.js');
const E=OverheadEngine,W=require('../overhead-weekly.js');
// Reuse the archived real ISS elements from the browser regression, not synthetic orbital data.
const source=fs.readFileSync(require.resolve('./overhead.spec.js'),'utf8');
const iss=vm.runInNewContext('('+source.match(/const iss=(\{[^\n]+\});/)[1]+')');iss.groups=['stations'];
const now=Date.parse('2026-09-09T01:00:00Z'),site={lat:38.3553,lon:-87.5675,tz:'America/Chicago'};
const windows=E.nights(site,now),real=E.detectPasses(iss,site,windows[0].start,windows[0].end).find(p=>p.likely&&p.start>now);
const iso=t=>new Date(t).toISOString(),fields=p=>({start:iso(p.start),peak:iso(p.peak.t),end:iso(p.end),rise:iso(p.rise),set:iso(p.set),orbitalPeak:iso(p.orbitalPeak.t),now:iso(now)});
assert(real);console.log('Archived real September 8 Princeton pass:',JSON.stringify(fields(real)));
const {pass}=require('./overhead-weekly.cjs');
const fixture=pass(Date.parse('2026-09-09T01:17:00Z'));Object.assign(fixture,{rise:Date.parse('2026-09-09T01:15Z'),end:Date.parse('2026-09-09T01:23Z'),set:Date.parse('2026-09-09T01:25Z')});fixture.peak.t=fixture.orbitalPeak.t=Date.parse('2026-09-09T01:20Z');
const malformed={...fixture,end:Date.parse('2026-09-09T00:59:00Z')};
if(process.argv.includes('--before')){
 for(const [label,p]of [['real archived',real],['ordinary fixture',fixture],['malformed fixture (not field evidence)',malformed]]){
  // Explicitly replay the release .8 end-only eligibility gate, even after the fix ships.
  const scored={...p,score:96},winner=W.rankWeeklyEvents({0:p.end>now?[scored]:[]},windows,{now,complete:true,weatherSource:{at:now}}).winner;
  console.log(label,JSON.stringify({oldFeedEligible:p.end>now,oldWeeklyEligible:!!winner,...fields(p)}));
 }
 assert(real.end>now&&fixture.end>now);assert(malformed.end<=now);
 console.log('The ordinary/archived event does NOT reproduce early expiry. An inconsistent end does. Exact original browser fields are needed to attribute the field report.');
}else{
 const {eventLifecycle:L}=require('../overhead-lifecycle.js');
 for(const [clock,phase,actionable,retained]of [['01:00','upcoming',true,true],['01:16','upcoming',true,true],['01:17','in-progress',true,true],['01:18','in-progress',true,true],['01:21','in-progress',true,true],['01:23','recently-ended',false,true],['01:24','recently-ended',false,true],['01:25','recently-ended',false,true],['01:34:59.999','recently-ended',false,true],['01:35','expired',false,false]]){
  const at=Date.parse('2026-09-09T'+clock+'Z'),l=L(fixture,at);assert.equal(l.lifecycle,phase,clock);assert.equal(l.recommendationEligible,actionable,clock);assert.equal(l.displayEligible,retained,clock);assert(l.timingInvariantValid);
  assert.equal(!!W.rankWeeklyEvents({0:[fixture]},windows,{now:at}).winner,actionable,clock);
 }
 const bad=L(malformed,now);assert(!bad.timingInvariantValid);assert(bad.displayEligible&&bad.recommendationEligible);assert.equal(bad.viewingEnd,fixture.peak.t);assert(bad.warnings.length);
 assert(L(malformed,fixture.peak.t-1).recommendationEligible);assert(L(malformed,fixture.peak.t).displayEligible);
 assert(!L(fixture,fixture.end+1).recommendationEligible);assert(L(fixture,fixture.end+1).displayEligible);
 assert(L(real,now).timingInvariantValid);assert(L(real,now).recommendationEligible);
 assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:site.tz,hour:'numeric',minute:'2-digit'}).format(fixture.start),'8:17 PM');
 console.log('PASS: ISS 8:17 PM pass must not disappear at 8:00 PM; 10 exact lifecycle boundaries, ranking exclusion, malformed peak/end and archived pass.');
}
module.exports={fixture,malformed,real,now,windows,site};
