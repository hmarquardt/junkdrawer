import {content} from './content.js';
export function random(seed) {
  return () => {
    seed |= 0;seed=seed+0x6D2B79F5|0;
    let n=Math.imul(seed^seed>>>15,1|seed);
    n^=n+Math.imul(n^n>>>7,61|n);
    return ((n^n>>>14)>>>0)/4294967296;
  };
}
export function patient(seed) {
  const r=random(seed^0x4af189), pick=list=>list[Math.floor(r()*list.length)];
  const first=pick(['Robin','Marlowe','Jules','Kit','Perry','Max','Bea','Alex','Frankie','Ash','Val','Lou']);
  const last=pick(['Finch','Banks','Moon','Reed','Bell','Lopez','Knight','Singh','Sparks','Kim','Stone','Lake']);
  return {name:first+' '+last,job:pick(['night baker','pigeon wrangler','jazz accountant','stunt librarian','museum guard','retired mime','mall detective','cheese sculptor']),
    tone:.86+r()*.22,oil:.8+r()*.4,grain:r()*9};
}
export function makeField(visit) {
  const {seed,encounter,index,difficulty,boss}=visit,rng=random(seed);
  const sites=[[.47,.47],[.72,.67],[.25,.34],[.68,.28],[.34,.73],[.81,.47]];
  if(visit.procedural){
    for(let j=5;j>0;j--){const k=Math.floor(rng()*(j+1));[sites[k],sites[j]]=[sites[j],sites[k]];}
  }
  return sites.slice(0,encounter.count).map(([x,y],id)=>{
    const leader=boss && id===encounter.count-1?boss:null;
    const archetype=content.get('archetypes',leader?.archetype||encounter.archetypes[(id+index)%encounter.archetypes.length]);
    const behavior=leader?content.get('behaviors',leader.behavior):null;
    return {id,x:x+(rng()-.5)*.09,y:y+(rng()-.5)*.09,size:(.044+rng()*.014)*(leader?1.45:1),
      phase:rng()*Math.PI*2,goal:.49+rng()*.25,resistance:(.86+rng()*.28)/Math.sqrt(difficulty),
      type:archetype.shape,name:leader?.name||archetype.name,material:content.get('materials',archetype.material),
      behavior,layers:behavior?.layers||1,boss:!!leader};
  });
}
// The pulse tip moves in soft steps. Suction ramps nonlinearly. The loop is proportional.
export function pressure(seconds,target,tool,layer=0){
  const behavior=target.behavior;
  const pace=behavior?.pattern==='breakaway'?(layer?1.7:.58):(behavior?.pace||1);
  const cycle=seconds*tool.speed*pace/target.resistance;
  const linear=1-Math.abs(1-cycle%2);
  if(tool.technique==='suction')return linear**1.42;
  if(tool.technique==='pulse')return linear-.025*Math.sin(linear*8*Math.PI);
  return linear;
}
export function band(seconds,target,tool,layer=0){
  const b=target.behavior;
  let center=target.goal;
  if(b?.pattern==='drift')center+=Math.sin(seconds*2.4+target.phase)*b.shift;
  if(b?.pattern==='layers'||b?.pattern==='breakaway')center-=layer*b.shift;
  if(b?.pattern==='alternating')center=layer%2?.75:.75-b.shift;
  const width=tool.window*(b?.window||1);
  return {center:Math.min(1-width,Math.max(width,center)),width};
}
export function assess(value,zone){
  const error=Math.abs(value-zone.center);
  return {success:error<=zone.width,perfect:error<=zone.width*.35};
}
// Short position-based chain with an anchored outlet, finite emission impulse, viscosity,
// gravity and contact friction. The simulation is independent of viewport units and frame rate.
export function eject(target,value,dx,dy,layer,tool) {
  const mat=target.material,r=random(Math.round(target.phase*1e6)+layer*431+Math.round(value*70));
  const count=Math.round(5+mat.cohesion*6), thickness=.10+.09*mat.viscosity;
  const vx=(r()-.5)*3+dx*1.65+(tool.technique==='roll'?.9:0);
  const vy=-3-value*2.6-Math.abs(dy)*.6;
  const particles=Array.from({length:count},(_,i)=>({
    x:0,y:-.023*i,vx:vx+(r()-.5)*1.8,vy:vy*(.75+.45*i/count),r:thickness*(.66+.32*Math.sin(Math.PI*i/count))
  }));
  const droplets=Array.from({length:Math.round((1-mat.cohesion)*9)},()=>({
    x:0,y:0,vx:vx+(r()-.5)*6,vy:vy*(.56+r()*.68),r:.045+r()*.075
  }));
  return {id:target.id,mat,particles,droplets,t:0,age:0,carry:0,life:1.22+mat.viscosity*.35,
    impulseX:vx,impulseY:vy,rest:.15+(1-mat.viscosity)*.15,seed:target.phase};
}
export function stepMaterial(b,delta){
  const dt=1/90;
  b.carry+=Math.min(.10,delta);
  while(b.carry>=dt){
    b.carry-=dt;b.age+=dt;
    const fixed=b.age<.14+b.mat.adhesion*.21;
    for(const p of [...b.particles,...b.droplets]){
      p.ox=p.x;p.oy=p.y;
      const drag=Math.exp(-dt*(.65+2*b.mat.viscosity));
      p.vx*=drag;p.vy=p.vy*drag+dt*6.4;p.x+=p.vx*dt;p.y+=p.vy*dt;
    }
    // Stored pressure continues feeding the extrudate briefly after the outlet opens.
    if(b.age<.27){
      const push=(1-b.age/.27)*dt*5.8;
      for(let i=1;i<b.particles.length;i++){
        const p=b.particles[i],fraction=i/(b.particles.length-1);
        p.x+=b.impulseX*push*fraction*dt;p.y+=b.impulseY*push*fraction*dt;
      }
    }
    for(let iter=0;iter<4;iter++){
      if(fixed){b.particles[0].x=0;b.particles[0].y=0;}
      for(let i=1;i<b.particles.length;i++){
        const p=b.particles[i-1],q=b.particles[i],x=q.x-p.x,y=q.y-p.y;
        const dist=Math.hypot(x,y)||.0001;
        const correction=Math.max(0,dist-b.rest)/dist*(.34+.16*b.mat.cohesion);
        if(!fixed||i>1){p.x+=x*correction;p.y+=y*correction;}
        q.x-=x*correction;q.y-=y*correction;
      }
    }
    for(const p of [...b.particles,...b.droplets]){
      const floor=.48+.12*Math.sin(p.x+b.seed);
      if(p.y>floor){p.y=floor;p.x=p.ox+(p.x-p.ox)*(1-b.mat.adhesion);}
      p.vx=(p.x-p.ox)/dt;p.vy=(p.y-p.oy)/dt;
    }
  }
  b.t=b.age/b.life;
}
