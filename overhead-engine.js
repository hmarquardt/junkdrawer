/* Overhead: pure observing geometry and scoring. No network or UI dependencies.
   satellite.js 6.0.1 and SunCalc 1.9.0 must be loaded by the host. */
(function (root) {
  'use strict';
  const D = Math.PI / 180, DAY = 86400000;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const epoch = value => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z');
  function illuminated(p, date) {
    // Finite angular discs: require the entire Sun to clear Earth's limb.
    // Conservative through penumbra; WGS84 equatorial Earth radius.
    const sun = satellite.sunPos(satellite.jday(date)).rsun.map(x => x * 149597870.7);
    const v = [sun[0] - p.x, sun[1] - p.y, sun[2] - p.z];
    const r = Math.hypot(p.x, p.y, p.z), s = Math.hypot(...v);
    const separation = Math.acos(clamp((-p.x*v[0]-p.y*v[1]-p.z*v[2])/(r*s), -1, 1));
    return separation > Math.asin(clamp(6378.137/r)) + Math.asin(695700/s);
  }
  function sample(rec, ms, site, full = true) {
    const date = new Date(ms), pos = satellite.propagate(rec, date).position;
    if (!pos || !Number.isFinite(pos.x)) return null;
    const gmst = satellite.gstime(date), ecf = satellite.eciToEcf(pos, gmst);
    const look = satellite.ecfToLookAngles({latitude:site.lat*D, longitude:site.lon*D, height:(site.alt||0)/1000}, ecf);
    const result = {t:ms, el:look.elevation/D, az:look.azimuth/D, range:look.rangeSat};
    if (full) {
      const geo = satellite.eciToGeodetic(pos, gmst);
      Object.assign(result, {lat:geo.latitude/D, lon:geo.longitude/D,
        sun:SunCalc.getPosition(date, site.lat, site.lon).altitude/D, lit:illuminated(pos,date)});
    }
    return result;
  }
  const visible = (p, minimum) => !!p && p.el >= minimum && p.sun <= -6 && p.lit;
  function refine(rec, a, b, site, predicate) {
    const initial = predicate(sample(rec,a,site));
    while (b-a > 250) { const m=(a+b)/2; if (predicate(sample(rec,m,site)) === initial) a=m; else b=m; }
    // Return the side that satisfies the predicate, including at shadow edges.
    return initial?a:b;
  }
  function peak(rec,a,b,site) {
    // Elevation is unimodal over a short orbital pass.
    while(b-a>250) { const x=a+(b-a)/3,y=b-(b-a)/3;
      if((sample(rec,x,site,false)?.el??-90)<(sample(rec,y,site,false)?.el??-90)) a=x; else b=y; }
    return sample(rec,(a+b)/2,site);
  }
  function detectPasses(object, site, start, end, minimum = 10) {
    const rec = object.tle ? satellite.twoline2satrec(...object.tle) : satellite.json2satrec(object);
    const ep = object.EPOCH ? epoch(object.EPOCH) : (rec.jdsatepoch-2440587.5)*DAY;
    if (!Number.isFinite(ep) || Math.max(Math.abs(start-ep),Math.abs(end-ep)) > 14*DAY) return [];
    const passes=[], step=30000;
    let rise=null, prev=sample(rec,start,site,false);
    if(prev?.el>0) rise=start;
    function finish(set) {
      const top=peak(rec,rise,set,site);
      if(!top || top.el<minimum) return;
      const segments=[]; let segment=null, previous=null;
      for(let t=rise;t<=set+1999;t+=2000) {
        const p=sample(rec,Math.min(t,set),site);
        if(visible(p,minimum)) {
          if(segment===null) segment=previous ? refine(rec,previous.t,p.t,site,q=>visible(q,minimum)) : p.t;
        } else if(segment!==null) {
          segments.push([segment,refine(rec,previous.t,p.t,site,q=>visible(q,minimum))]); segment=null;
        }
        previous=p;
      }
      if(segment!==null) segments.push([segment,set]);
      const duration=segments.reduce((n,[a,b])=>n+(b-a)/1000,0);
      const longest=segments.slice().sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
      const a=longest&&duration>=20?longest[0]:rise,b=longest&&duration>=20?longest[1]:set;
      const path=[];
      for(let t=a;t<b;t+=Math.max(2000,(b-a)/80)) path.push(sample(rec,t,site));
      path.push(sample(rec,b,site));
      const best=peak(rec,a,b,site);
      passes.push({id:String(object.NORAD_CAT_ID||rec.satnum)+'-'+Math.round(rise),
        norad:String(object.NORAD_CAT_ID||rec.satnum),name:object.OBJECT_NAME||'Unnamed spacecraft',
        groups:object.groups||[],epoch:ep,rise,set,orbitalPeak:top,start:a,end:b,peak:best,
        duration,segments,likely:duration>=20,entry:sample(rec,a,site),exit:sample(rec,b,site),path});
    }
    for(let t=start+step;t<=end+step;t+=step) {
      const time=Math.min(t,end),p=sample(rec,time,site,false);
      if(p && prev) {
        if(prev.el<=0 && p.el>0) rise=refine(rec,prev.t,time,site,q=>!!q&&q.el>0);
        if(prev.el>0 && p.el<=0 && rise!==null) { finish(refine(rec,prev.t,time,site,q=>!!q&&q.el>0)); rise=null; }
      }
      prev=p; if(time===end) break;
    }
    if(rise!==null) finish(end);
    return passes;
  }
  function weatherAt(weather, time) {
    const h=weather?.hourly; if(!h?.time?.length) return null;
    const seconds=time/1000;
    let i=Math.floor((seconds-h.time[0])/3600);
    if(i<0 || i>=h.time.length || Math.abs(h.time[i]-seconds)>3600) return null;
    const keys=['cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','visibility','precipitation','relative_humidity_2m','weather_code','temperature_2m'];
    return Object.fromEntries(keys.map(k=>[k,Number.isFinite(h[k]?.[i])?h[k][i]:null]));
  }
  function scorePass(pass, weather) {
    const w=weatherAt(weather,pass.peak.t),known=!!w&&w.cloud_cover!==null&&w.visibility!==null&&w.precipitation!==null;
    const brightness=pass.norad==='25544'?1:pass.norad==='48274'?.88:pass.groups.includes('visual')?.68:.35;
    const factors={elevation:25*clamp((pass.peak.el-5)/65),duration:15*clamp(pass.duration/360),
      illumination:pass.likely?10:0,darkness:15*clamp((-pass.peak.sun-3)/12),brightness:10*brightness,
      clouds:known?20*(1-w.cloud_cover/100):0,visibility:known?5*clamp(w.visibility/20000):0};
    let score=Object.values(factors).reduce((a,b)=>a+b,0);
    // A bright-object catalog is not a promise of naked-eye brightness tonight.
    score*=.55+.45*brightness;
    if(known) score*=Math.pow(1-w.cloud_cover/100,1.2)*clamp(w.visibility/10000,.15,1)*(w.precipitation>0?.35:1);
    if(!pass.likely) score=0;
    return {score:Math.round(clamp(score,0,100)),provisional:!known,w,factors,brightness};
  }
  function label(score) { return score>=90?'Don’t miss it':score>=75?'Excellent':score>=60?'Good':score>=40?'Possible':score>=20?'Poor':'Not worth it'; }
  function compass(az) { return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(az/22.5)%16]; }
  function localDate(ms, zone) { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms)); }
  function zonedTime(day,hour,zone) {
    const target=Date.parse(day+'T'+String(hour).padStart(2,'0')+':00:00Z'); let value=target;
    for(let i=0;i<4;i++) {
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
      value+=target-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    } return value;
  }
  function nights(site, now=Date.now()) {
    let day=localDate(now,site.tz);
    const today=SunCalc.getTimes(new Date(zonedTime(day,12,site.tz)),site.lat,site.lon);
    if(Number.isFinite(+today.sunrise) && now<+today.sunrise) day=new Date(Date.parse(day+'T12:00Z')-DAY).toISOString().slice(0,10);
    return Array.from({length:7},(_,i)=>{
      const d=new Date(Date.parse(day+'T12:00Z')+i*DAY).toISOString().slice(0,10),next=new Date(Date.parse(d+'T12:00Z')+DAY).toISOString().slice(0,10);
      const solar=SunCalc.getTimes(new Date(zonedTime(d,12,site.tz)),site.lat,site.lon);
      const morning=SunCalc.getTimes(new Date(zonedTime(next,12,site.tz)),site.lat,site.lon);
      return {day:d,start:Number.isFinite(+solar.sunset)?+solar.sunset:zonedTime(d,18,site.tz),
        end:Number.isFinite(+morning.sunrise)?+morning.sunrise:zonedTime(next,6,site.tz),
        solar:Object.fromEntries(Object.entries(solar).map(([k,v])=>[k,Number.isFinite(+v)?+v:null])),
        morning:Object.fromEntries(Object.entries(morning).map(([k,v])=>[k,Number.isFinite(+v)?+v:null]))};
    });
  }
  function parseElements(data,group) {
    let rows;
    if(typeof data==='string') {
      const lines=data.trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean); rows=[];
      for(let i=0;i<lines.length;i++) if(lines[i].startsWith('1 ')&&lines[i+1]?.startsWith('2 ')) {
        const rec=satellite.twoline2satrec(lines[i],lines[i+1]);
        rows.push({OBJECT_NAME:i&& !lines[i-1].startsWith('2 ')?lines[i-1].replace(/^0 /,''):'NORAD '+rec.satnum,
          NORAD_CAT_ID:rec.satnum,EPOCH:new Date((rec.jdsatepoch-2440587.5)*DAY).toISOString(),tle:[lines[i],lines[i+1]]}); i++;
      }
    } else rows=data;
    if(!Array.isArray(rows)||!rows.length) throw Error('No OMM or TLE records found');
    return rows.filter(o=>o.EPOCH&&Number.isFinite(epoch(o.EPOCH))&&(o.tle||[o.MEAN_MOTION,o.INCLINATION,o.ECCENTRICITY,o.RA_OF_ASC_NODE,o.ARG_OF_PERICENTER,o.MEAN_ANOMALY].every(Number.isFinite)))
      .map(o=>({...o,groups:[group]}));
  }
  root.OverheadEngine={illuminated,sample,visible,detectPasses,weatherAt,scorePass,label,compass,localDate,zonedTime,nights,parseElements};
})(typeof self!=='undefined'?self:globalThis);
