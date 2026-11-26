// Engine 1 accepts only authored data. Every reference resolves before a pack becomes visible.
// Engine 1.1 adds optional first-party families (reservoir graphs, commentary, tutorials) and new
// instrument techniques. A 1.0 pack remains valid because every addition is optional metadata.
const links = {
  regions:{image:'assets'}, archetypes:{material:'materials',reservoir:'reservoirs'},
  bosses:{behavior:'behaviors',archetype:'archetypes',reservoir:'reservoirs'},
  encounters:{region:'regions',boss:'bosses',archetypes:'archetypes',behaviors:'behaviors',reservoir:'reservoirs',patient:'patients',condition:'conditions'},
  chapters:{encounters:'encounters'}, modes:{scoring:'scoring',chapters:'chapters'},
  materials:{}, equipment:{audio:'assets'}, behaviors:{reservoir:'reservoirs'},
  achievements:{}, scoring:{}, assets:{}, upgrades:{}, reservoirs:{}, commentary:{},
  tutorials:{equipment:'equipment'}, patients:{region:'regions',reservoir:'reservoirs',condition:'conditions',materials:'materials'},
  conditions:{}, intake:{}, records:{}
};
const requiredLinks={
  regions:['image'],archetypes:['material'],bosses:['behavior','archetype'],encounters:['region','archetypes'],
  chapters:['encounters'],modes:['chapters','scoring']
};
const TECHNIQUES=['roll','pulse','suction','probe','vortex','resonance','silver','spectral','cryo','arcane'];
const PATTERNS=['layers','drift','breakaway','alternating','stutter','surge'];
const RESERVOIR_PATTERNS=['fork','ribbon','strata','chain','braid','migrate'];
const OBSTRUCTIONS=['none','plug','valve','septum','migrate','core'];
const CLASSES=['vampire','werewolf','zombie','swamp','reptilian','alien','troll','ghost','fungoid','lovecraftian','hybrid','crossover'];
const RECORD_KINDS=['max','count','score'];
const INTENSITIES=['spooky','midnight','eldritch'];
function validateRecord(kind,v){
  const inRange=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  for(const key of requiredLinks[kind]||[]){
    if(!v[key]||Array.isArray(v[key])&&!v[key].length)throw Error('Missing '+key+' on '+v.id);
  }
  if(kind==='materials' && ['viscosity','cohesion','adhesion'].some(k=>!inRange(v[k],0,1)))throw Error('Invalid material properties');
  if(kind==='equipment' && (!inRange(v.speed,.01,8)||!inRange(v.window,.01,.45)||!Number.isInteger(v.art)||v.art<0||v.art>9))throw Error('Invalid instrument');
  if(kind==='equipment' && v.scope!==undefined){
    const scopes=[].concat(v.scope);
    if(!scopes.length||scopes.some(scope=>typeof scope!=='string'||!/^[a-z][a-z0-9-]*$/.test(scope)))throw Error('Invalid instrument scope');
  }
  if(kind==='behaviors' && (!Number.isInteger(v.layers)||v.layers<1||v.layers>8||!inRange(v.pace,.1,8)||!inRange(v.window,.1,2)))throw Error('Invalid release behavior');
  if(kind==='chapters' && !inRange(v.difficulty,.1,8))throw Error('Invalid difficulty');
  if(kind==='reservoirs'){
    const rooms=Array.isArray(v.chambers)&&v.chambers.length===2&&v.chambers.every(n=>Number.isInteger(n)&&n>=1&&n<=14)&&v.chambers[0]<=v.chambers[1];
    if(!rooms || !inRange(v.scale,.1,4) || !Array.isArray(v.materials) || !v.materials.length)throw Error('Invalid reservoir template');
    if(!Number.isInteger(v.hidden)||v.hidden<0||v.hidden>14)throw Error('Invalid concealed count');
    for(const key of ['phase','dormant','rewire','mutates','outlets']){
      if(v[key]!==undefined && (!Number.isInteger(v[key])||v[key]<0||v[key]>8))throw Error('Invalid reservoir '+key);
    }
    if(v.mutation!==undefined && (!Number.isInteger(v.mutation)||v.mutation<1||v.mutation>16))throw Error('Invalid mutation milestone');
  }
  if(kind==='patients'){
    if(!CLASSES.includes(v.klass))throw Error('Unknown patient class');
    if(!Array.isArray(v.materials)||!v.materials.length)throw Error('Patient needs materials');
  }
  if(kind==='records' && (!RECORD_KINDS.includes(v.kind)||typeof v.stat!=='string'))throw Error('Invalid record definition');
  if(kind==='conditions' && Object.values(v).some(value => typeof value==='number' && !Number.isFinite(value)))throw Error('Invalid condition');
  if(kind==='tutorials' && (!Array.isArray(v.steps)||!v.steps.length||v.steps.some(s=>typeof s!=='string'||!s.trim())))throw Error('Invalid tutorial');
}
export function createRegistry() {
  const catalog=new Map(), packages=new Map(), pending=new Map();
  const api={
    get(kind,id) {
      const hit=catalog.get(id);
      if(hit?.kind!==kind)throw Error('Unavailable '+kind+' record '+id);
      return hit.value;
    },
    list(kind){return [...catalog.values()].filter(r=>r.kind===kind).map(r=>r.value);},
    versions(){return Object.fromEntries(packages);},
    // Only the application supplies manifest URLs. No user-entered URLs or script imports.
    load(path) {
      const url=new URL(path,import.meta.url);
      if(url.origin!==location.origin)throw Error('Content must be served with the game.');
      if(pending.has(url.href))return pending.get(url.href);
      const promise=(async()=>{
        const response=await fetch(url);
        if(!response.ok)throw Error('Content unavailable: '+url.pathname);
        const pack=await response.json(), additions=new Map();
        if(pack.engineMajor!==1 || !/^[a-z][a-z0-9-]*$/.test(pack.namespace) || !/^\d+\.\d+\.\d+$/.test(pack.version))throw Error('Incompatible content manifest');
        if(packages.has(pack.namespace))throw Error('Duplicate pack '+pack.namespace);
        for(const kind of Object.keys(links)){
          for(const value of pack[kind]||[]) {
            if(!value.id?.startsWith(pack.namespace+':') || !/^[a-z][\w-]*:[a-z][\w-]*$/.test(value.id) || catalog.has(value.id) || additions.has(value.id))throw Error('Invalid or duplicate content ID');
            validateRecord(kind,value);
            if(kind==='assets'){
              const asset=new URL(value.src,url);
              if(asset.origin!==url.origin || !['audio','image'].includes(value.kind))throw Error('Unsupported asset');
              value.url=asset.href;
            }
            if(kind==='encounters' && (!Number.isInteger(value.count)||value.count<1||value.count>6||!value.archetypes?.length))throw Error('Invalid field');
            if(kind==='behaviors' && !PATTERNS.includes(value.pattern))throw Error('Unknown simulation behavior');
            if(kind==='modes' && !['campaign','endless','zen'].includes(value.strategy))throw Error('Unknown mode strategy');
            if(kind==='equipment' && !TECHNIQUES.includes(value.technique))throw Error('Unknown technique');
            if(kind==='reservoirs' && (!RESERVOIR_PATTERNS.includes(value.pattern)||!OBSTRUCTIONS.includes(value.obstruction||'none')))throw Error('Unknown reservoir family');
            if(kind==='modes' && value.intensity!==undefined && !INTENSITIES.includes(value.intensity))throw Error('Unknown visual intensity');
            if(kind==='patients' && value.intake!==undefined && typeof value.intake!=='string')throw Error('Invalid intake note');
            if(kind==='encounters' && value.patient!==undefined && !String(value.patient).includes(':'))throw Error('Invalid encounter patient');
            additions.set(value.id,{kind,value});
          }
        }
        for(const {kind,value} of additions.values()){
          for(const [key,target] of Object.entries(links[kind])){
            if(value[key]===undefined)continue;
            for(const id of [].concat(value[key])){
              if((additions.get(id)||catalog.get(id))?.kind!==target)throw Error('Unresolved '+key+' reference '+id);
            }
          }
        }
        for(const [key,item] of additions)catalog.set(key,item);
        packages.set(pack.namespace,pack.version);
        return pack.namespace;
      })();
      pending.set(url.href,promise);
      promise.catch(()=>pending.delete(url.href));
      return promise;
    }
  };
  return api;
}
export const content=createRegistry();
export const baseReady=content.load('./base.json');

// Future approved packages get a source here when released. Reading inactive pack slots must never
// download their media or prevent the base campaign from resuming. Registering a source is only a
// string; the manifest, module and plates download when that content is actually required.
const optionalSources=new Map([['pore-explorer','./pore-explorer/pack.json'],['midnight-clinic','./midnight-clinic/pack.json']]);
export async function restoreContent(state){
  if(state?.schema!==2)return;
  const active=state.slots?.[state.mode];
  const required=new Set([state.mode,state.tool,active?.encounter].filter(Boolean).map(id=>id.split(':')[0]));
  for(const ns of required){
    let installed=content.versions()[ns];
    if(!installed){
      const source=optionalSources.get(ns);
      if(!source)throw Error('This shift needs the '+ns+' content pack.');
      await content.load(source);installed=content.versions()[ns];
    }
    if(!installed || state.packs?.[ns] && state.packs[ns].split('.')[0]!==installed.split('.')[0])
      throw Error('Saved content needs a compatible '+ns+' version.');
  }
}
