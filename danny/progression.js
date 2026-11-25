import {content} from './content.js';
import {patient,random} from './simulation.js';
const baseMode='base:campaign';
export const rank=xp=>['Trainee','Pore scout','Field specialist','Shift lead','Pore legend'][Math.min(4,Math.floor(xp/150))];
export function itinerary(mode){
  return mode.chapters.flatMap((id,chapterIndex)=>{
    const chapter=content.get('chapters',id);
    return chapter.encounters.map(encounter=>({chapter,chapterIndex,encounter:content.get('encounters',encounter)}));
  });
}
function slot(modeId){
  const first=itinerary(content.get('modes',modeId))[0].encounter;
  const seed=modeId===baseMode?first.seed:crypto.getRandomValues(new Uint32Array(1))[0];
  return {encounter:first.id,seed,turn:1,cleared:[],layers:{},streak:0,points:0};
}
export function fresh(){
  return {schema:2,revision:0,packs:content.versions(),mode:baseMode,slots:{[baseMode]:slot(baseMode)},tool:'base:loop',
    xp:0,score:0,stats:{total:0,perfects:0,bestStreak:0,bosses:0,chapters:0,endlessFields:0,zenFields:0},
    achievements:[],settings:{sound:true,volume:.65,haptics:false,assist:false,toggle:false,contrast:false,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}};
}
const count=n=>Number.isSafeInteger(n)&&n>=0;
const targetId=n=>Number.isInteger(n)&&n>=0&&n<6;
const qualified=s=>typeof s==='string' && /^[a-z][\w-]*:[a-z][\w-]*$/.test(s);
function validTargets(values){
  return Array.isArray(values)&&values.length<=6&&values.every(targetId)&&new Set(values).size===values.length;
}
function validSlot(v){
  return v && qualified(v.encounter)&&count(v.seed)&&count(v.turn)&&v.turn>=1&&count(v.streak)&&count(v.points)
    &&validTargets(v.cleared)&&v.layers&&typeof v.layers==='object'
    &&Object.entries(v.layers).every(([i,n])=>targetId(Number(i))&&count(n));
}
export function validSave(s){
  if(!s||!count(s.revision))return false;
  if(s.schema===undefined)return count(s.caseIndex)&&s.caseIndex<6&&validTargets(s.cleared)&&count(s.xp)
    &&count(s.total)&&count(s.tool)&&s.tool<3&&typeof s.sound==='boolean';
  if(s.schema>2)return true; // Newer clients own these records. Preserve them.
  if(s.schema!==2||!count(s.xp)||!count(s.score)||!qualified(s.mode)||!qualified(s.tool))return false;
  const stats=['total','perfects','bestStreak','bosses','chapters','endlessFields','zenFields'];
  const prefs=['sound','haptics','assist','toggle','contrast','reducedMotion'];
  return s.stats && stats.every(key=>count(s.stats[key])) && s.settings && prefs.every(key=>typeof s.settings[key]==='boolean')
    && Number.isFinite(s.settings.volume)&&s.settings.volume>=0&&s.settings.volume<=1
    && Array.isArray(s.achievements)&&s.achievements.every(qualified)
    && !!s.slots?.[s.mode] && !!s.slots[baseMode] && Object.values(s.slots).every(validSlot);
}
export function migrate(old){
  if(!old)return fresh();
  if(old.schema>2)throw Error('This save needs a newer game version.');
  if(old.schema===2)return old;
  const p=fresh(),dest=p.slots[baseMode],route=itinerary(content.get('modes',baseMode)),c=route[old.caseIndex].encounter;
  Object.assign(dest,{encounter:c.id,seed:c.seed,cleared:[...old.cleared],turn:old.caseIndex+1});
  Object.assign(p,{revision:old.revision,xp:old.xp,tool:content.list('equipment')[old.tool]?.id||'base:loop'});
  p.stats.total=old.total;p.settings.sound=old.sound;
  p.stats.chapters=Math.floor((old.caseIndex+(old.cleared.length===c.count?1:0))/2);
  earnAchievements(p);
  return p;
}
export function switchMode(p,id){
  content.get('modes',id);p.slots[id]??=slot(id);p.mode=id;
}
export function visitFor(p){
  const mode=content.get('modes',p.mode),run=p.slots[p.mode],route=itinerary(mode);
  const index=route.findIndex(e=>e.encounter.id===run.encounter);
  if(index<0)throw Error('Required encounter content is unavailable.');
  const {chapter,chapterIndex,encounter}=route[index],zen=mode.strategy==='zen',endless=mode.strategy==='endless';
  return {mode,run,route,chapter,chapterIndex,encounter,index,seed:run.seed,patient:patient(run.seed),
    region:content.get('regions',encounter.region),boss:encounter.boss&&!zen?content.get('bosses',encounter.boss):null,
    procedural:mode.strategy!=='campaign',zen,difficulty:zen?1:endless?1+Math.min(1.1,run.turn*.065):chapter.difficulty};
}
export function availableUpgrades(p){return content.list('upgrades').filter(u=>p.xp>=u.xp);}
export function calibrated(p,visit){
  const item=content.get('equipment',p.tool),upgrades=availableUpgrades(p);
  return {...item,speed:item.speed*(p.settings.assist?.64:1)*upgrades.reduce((v,u)=>v*u.speedScale,1),
    window:(item.window+upgrades.reduce((v,u)=>v+u.windowBonus,0)+(p.settings.assist?.07:0))/Math.sqrt(visit.difficulty)};
}
function earnAchievements(p){
  const earned=content.list('achievements').filter(a=>!p.achievements.includes(a.id)&&p.stats[a.stat]>=a.threshold);
  p.achievements.push(...earned.map(a=>a.id));return earned;
}
export function reward(p,v,l,perfect){
  const r=v.run,rules=content.get('scoring',v.mode.scoring);
  const layers=(r.layers[l.id]||0)+1;
  r.layers[l.id]=layers;
  if(layers<l.layers)return {partial:true,earned:[],points:0,xp:0};
  r.cleared.push(l.id);
  const closed=r.cleared.length===v.encounter.count;
  let xp=0,points=0;
  if(!v.zen){
    p.stats.total++;r.streak++;p.stats.bestStreak=Math.max(p.stats.bestStreak,r.streak);
    if(perfect)p.stats.perfects++;
    if(l.boss)p.stats.bosses++;
    points=(perfect?rules.perfect:rules.clean)+Math.min(r.streak-1,rules.streakCap)*rules.streakStep+(l.boss?rules.bossBonus:0);
    xp=(perfect?30:20)+(closed?rules.caseXP:0);
    p.score+=points;r.points+=points;p.xp+=xp;
  }
  if(closed){
    if(v.mode.strategy==='campaign' && v.chapter.encounters.at(-1)===v.encounter.id)p.stats.chapters=Math.max(p.stats.chapters,v.chapterIndex+1);
    if(v.zen)p.stats.zenFields++;
    if(v.mode.strategy==='endless')p.stats.endlessFields++;
  }
  return {partial:false,points,xp,earned:earnAchievements(p)};
}
export function advance(v){
  const r=v.run;
  if(v.mode.strategy==='campaign'){
    const next=v.route[v.index+1];if(!next)return false;
    r.encounter=next.encounter.id;r.seed=next.encounter.seed;
  }else{
    const rng=random(r.seed^Math.imul(r.turn,0x45d9f3b));
    r.seed=Math.floor(rng()*4294967296);
    const choices=v.route.filter(item=>v.zen||Boolean(item.encounter.boss)===((r.turn+1)%4===0));
    r.encounter=choices[Math.floor(rng()*choices.length)].encounter.id;
  }
  r.turn++;r.cleared=[];r.layers={};r.points=0;return true;
}
