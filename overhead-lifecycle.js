/* Pure display lifecycle. Does not alter propagation, geometry or sighting quality. */
(function(root){
'use strict';
const GRACE_MS=10*60000,TOLERANCE_MS=1000;
function eventLifecycle(pass,now){
 const start=pass.start,peak=pass.peak?.t,end=pass.end,rise=pass.rise,set=pass.set,orbitalPeak=pass.orbitalPeak?.t;
 const raw={start,peak,end,rise,set,orbitalPeak},warnings=[];
 for(const [key,t]of Object.entries(raw))if(!Number.isFinite(t))warnings.push(key+' is not a finite epoch millisecond timestamp');
 for(const [a,b]of [['rise','set'],['start','end'],['start','peak'],['peak','end'],['rise','orbitalPeak'],['orbitalPeak','set']])if(Number.isFinite(raw[a])&&Number.isFinite(raw[b])&&raw[a]>raw[b]+TOLERANCE_MS)warnings.push(a+' > '+b);
 const finite=values=>values.filter(Number.isFinite),viewTimes=finite([start,end,peak]);
 // Guard the times used in the recommendation itself, never extend its eligibility to geometric set.
 const viewingStart=Number.isFinite(start)?start:Math.min(...viewTimes);
 const viewingEnd=viewTimes.length?Math.max(...viewTimes):null;
 const primaryTimes=finite([...viewTimes,rise,set,orbitalPeak]);
 const displayUntil=primaryTimes.length?Math.max(...primaryTimes)+GRACE_MS:null;
 // Unknown timing remains inspectable, but must not create an actionable recommendation.
 const recommendationEligible=Number.isFinite(now)&&viewingEnd!==null&&now<viewingEnd;
 const displayEligible=displayUntil===null||now<displayUntil;
 const lifecycle=recommendationEligible?(now<viewingStart?'upcoming':'in-progress'):displayEligible?'recently-ended':'expired';
 return {lifecycle,now,...raw,viewingStart:Number.isFinite(viewingStart)?viewingStart:null,viewingEnd,geometricSet:Number.isFinite(set)?set:null,displayUntil,
  remainingToStart:Number.isFinite(viewingStart)?viewingStart-now:null,remainingToViewingEnd:viewingEnd===null?null:viewingEnd-now,
  recommendationEligible,displayEligible,timingInvariantValid:!warnings.length,warnings};
}
root.OverheadLifecycle={eventLifecycle,GRACE_MS,TOLERANCE_MS};
if(typeof module!=='undefined')module.exports=root.OverheadLifecycle;
})(typeof self!=='undefined'?self:globalThis);
