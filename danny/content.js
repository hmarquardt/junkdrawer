// Engine 1 accepts only authored data. Every reference resolves before a pack becomes visible.
const links = {
  regions:{image:'assets'}, archetypes:{material:'materials'}, bosses:{behavior:'behaviors',archetype:'archetypes'},
  encounters:{region:'regions',boss:'bosses',archetypes:'archetypes'}, chapters:{encounters:'encounters'},
  modes:{scoring:'scoring',chapters:'chapters'}, materials:{}, equipment:{audio:'assets'}, behaviors:{},
  achievements:{},scoring:{},assets:{},upgrades:{}
};
const requiredLinks={
  regions:['image'],archetypes:['material'],bosses:['behavior','archetype'],encounters:['region','archetypes'],
  chapters:['encounters'],modes:['chapters','scoring']
};
function validateRecord(kind,v){
  const inRange=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  for(const key of requiredLinks[kind]||[]){
    if(!v[key]||Array.isArray(v[key])&&!v[key].length)throw Error('Missing '+key+' on '+v.id);
  }
  if(kind==='materials' && ['viscosity','cohesion','adhesion'].some(k=>!inRange(v[k],0,1)))throw Error('Invalid material properties');
  if(kind==='equipment' && (!inRange(v.speed,.01,8)||!inRange(v.window,.01,.45)||!Number.isInteger(v.art)||v.art<0||v.art>2))throw Error('Invalid instrument');
  if(kind==='behaviors' && (!Number.isInteger(v.layers)||v.layers<1||v.layers>8||!inRange(v.pace,.1,8)||!inRange(v.window,.1,2)))throw Error('Invalid release behavior');
  if(kind==='chapters' && !inRange(v.difficulty,.1,8))throw Error('Invalid difficulty');
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
            if(kind==='behaviors' && !['layers','drift','breakaway','alternating'].includes(value.pattern))throw Error('Unknown simulation behavior');
            if(kind==='modes' && !['campaign','endless','zen'].includes(value.strategy))throw Error('Unknown mode strategy');
            if(kind==='equipment' && !['roll','pulse','suction'].includes(value.technique))throw Error('Unknown technique');
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

// Future approved packages get a source here when released. Reading inactive pack slots
// must never download their media or prevent the base campaign from resuming.
const optionalSources=new Map();
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
