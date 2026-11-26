import {content} from './content.js';
import {patient,random} from './simulation.js';
const baseMode='base:campaign';
// Expansion counters live beside the base statistics. Every new key is additive: a 1.0 save loads
// unchanged, and a 1.1 save still satisfies the 1.0 validator because only the base keys are
// required. Unknown achievement IDs and inactive pack slots survive normal saves.
const deepStats={concealed:0,secondarySwarm:0,ribbons:0,networks:0,icebergs:0,krakenzits:0,hydras:0,
  deepChapters:0,deepBosses:0,mysterySolves:0};
export const rank=xp=>['Trainee','Pore scout','Field specialist','Shift lead','Pore legend'][Math.min(4,Math.floor(xp/150))];
export function itinerary(mode){
  return mode.chapters.flatMap((id,chapterIndex)=>{
    const chapter=content.get('chapters',id);
    return chapter.encounters.map(encounter=>({chapter,chapterIndex,encounter:content.get('encounters',encounter)}));
  });
}
function slot(modeId){
  const mode=content.get('modes',modeId),first=itinerary(mode)[0].encounter;
  // Authored campaign seeds stay authored for every campaign, including expansions. Procedural
  // modes draw a fresh seed per shift.
  const seed=mode.strategy==='campaign'?first.seed:crypto.getRandomValues(new Uint32Array(1))[0];
  return {encounter:first.id,seed,turn:1,cleared:[],layers:{},deep:{},streak:0,points:0};
}
export function fresh(){
  return {schema:2,revision:0,packs:content.versions(),mode:baseMode,slots:{[baseMode]:slot(baseMode)},tool:'base:loop',
    xp:0,score:0,stats:{total:0,perfects:0,bestStreak:0,bosses:0,chapters:0,endlessFields:0,zenFields:0,...deepStats},
    achievements:[],tutorials:[],settings:{sound:true,volume:.65,haptics:false,assist:false,toggle:false,contrast:false,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}};
}
const count=n=>Number.isSafeInteger(n)&&n>=0;
const targetId=n=>Number.isInteger(n)&&n>=0&&n<6;
const qualified=s=>typeof s==='string' && /^[a-z][\w-]*:[a-z][\w-]*$/.test(s);
function validTargets(values){
  return Array.isArray(values)&&values.length<=6&&values.every(targetId)&&new Set(values).size===values.length;
}
// Reservoir progress is optional. When present it stays small: one entry per target, a 36-cell
// coverage mask, a bounded depth gain and a short list of broken gate indices.
function validDeep(deep){
  if(deep===undefined)return true;
  if(!deep||typeof deep!=='object'||Array.isArray(deep))return false;
  return Object.entries(deep).every(([key,value])=>{
    const id=Number(key);
    return targetId(id)&&value&&typeof value==='object'&&/^[0-9a-f]{72}$/.test(String(value.c))
      && Number.isInteger(value.d)&&value.d>=0&&value.d<=48
      && Array.isArray(value.g)&&value.g.length<=24&&value.g.every(n=>Number.isInteger(n)&&n>=-65&&n<=24);
  });
}
function validSlot(v){
  return v && qualified(v.encounter)&&count(v.seed)&&count(v.turn)&&v.turn>=1&&count(v.streak)&&count(v.points)
    &&validTargets(v.cleared)&&v.layers&&typeof v.layers==='object'
    &&Object.entries(v.layers).every(([i,n])=>targetId(Number(i))&&count(n))
    &&validDeep(v.deep);
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
    && Object.entries(s.stats).every(([key,value])=>stats.includes(key)||count(value))
    && (s.tutorials===undefined||Array.isArray(s.tutorials)&&s.tutorials.length<=32&&s.tutorials.every(qualified))
    && Array.isArray(s.achievements)&&s.achievements.every(qualified)
    && !!s.slots?.[s.mode] && !!s.slots[baseMode] && Object.values(s.slots).every(validSlot);
}
export function migrate(old){
  if(!old)return fresh();
  if(old.schema>2)throw Error('This save needs a newer game version.');
  if(old.schema===2){
    // Additive normalization: fill expansion counters that a 1.0 save never wrote.
    for(const [key,value] of Object.entries(deepStats))if(!count(old.stats[key]))old.stats[key]=value;
    if(!Array.isArray(old.tutorials))old.tutorials=[];
    return old;
  }
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
export function earnAchievements(p){
  const earned=content.list('achievements').filter(a=>!p.achievements.includes(a.id)&&(p.stats[a.stat]||0)>=a.threshold);
  p.achievements.push(...earned.map(a=>a.id));return earned;
}
export function reward(p,v,l,perfect){
  const r=v.run,rules=content.get('scoring',v.mode.scoring);
  const native=v.mode.id.startsWith('base:');
  const layers=(r.layers[l.id]||0)+1;
  r.layers[l.id]=layers;
  if(layers<l.layers)return {partial:true,earned:[],points:0,xp:0};
  r.cleared.push(l.id);
  const closed=r.cleared.length===v.encounter.count;
  let xp=0,points=0;
  if(!v.zen){
    p.stats.total++;r.streak++;p.stats.bestStreak=Math.max(p.stats.bestStreak,r.streak);
    if(perfect)p.stats.perfects++;
    if(l.boss)p.stats[native?'bosses':'deepBosses']++;
    points=(perfect?rules.perfect:rules.clean)+Math.min(r.streak-1,rules.streakCap)*rules.streakStep+(l.boss?rules.bossBonus:0);
    xp=(perfect?30:20)+(closed?rules.caseXP:0);
    p.score+=points;r.points+=points;p.xp+=xp;
  }
  if(closed){
    // Base chapters keep the published counter. Expansion chapters track their own, so completing
    // three underground chapters never masquerades as finishing the four base chapters.
    const stat=native?'chapters':'deepChapters';
    if(v.mode.strategy==='campaign' && v.chapter.encounters.at(-1)===v.encounter.id)
      p.stats[stat]=Math.max(p.stats[stat]||0,v.chapterIndex+1);
    if(native&&v.zen)p.stats.zenFields++;
    if(native&&v.mode.strategy==='endless')p.stats.endlessFields++;
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
  // Coverage and gate state belong to one case. A new patient starts with an unmapped field.
  r.turn++;r.cleared=[];r.layers={};r.deep={};r.points=0;return true;
}
