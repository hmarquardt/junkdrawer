const vertexShader = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;
const fragmentShader = `
precision highp float;
uniform sampler2D photo;
uniform vec2 frame, drag;
uniform vec4 sites[6], traits[6];
uniform float zoom, caseNo, photoAspect;
uniform vec4 tissue;
uniform vec2 center;
varying vec2 vUv;
void main(){
  vec2 screen=vec2(vUv.x,1.-vUv.y);
  vec2 uv=(screen-.5)/zoom+center;
  vec2 aspect=frame/min(frame.x,frame.y);
  vec2 warp=vec2(0.);
  float red=0., shade=0., shine=0., tip=0., dark=0.;
  for(int i=0;i<6;i++){
    vec4 s=sites[i], t=traits[i];
    if(s.z<=0.)continue;
    vec2 q=(uv-s.xy)*aspect/s.z;
    float p=t.x, alive=t.y, phase=t.w;
    q.x*=1.0+.13*sin(phase);
    q.y+=.09*sin(q.x*2.+phase);
    q.x*=1.+p*.53*tissue.z;
    q.y*=1.-p*.15;
    q += p*vec2(.11*sin(q.y*4.+phase),.06*cos(q.x*3.));
    float a=atan(q.y,q.x), r=length(q)*(1.+.062*cos(3.*a+phase)+.04*sin(5.*a-phase));
    float hill=exp(-r*r*1.48), halo=exp(-r*r*.52);
    float ridges=sin(q.y*22.+phase+sin(q.x*7.8))*.5+sin(q.x*18.-q.y*9.+phase)*.5;
    hill*=1.+.065*ridges;
    float mottling=.91+.09*sin(q.x*8.+sin(q.y*6.)+phase);
    float dent=exp(-pow((abs(q.x)-1.25)*1.8,2.)-q.y*q.y*1.3);
    warp+=s.z/aspect*(q*(hill*(-.20*alive)+p*halo*.4)-drag*p*halo*.42);
    red+=halo*mottling*(.04+.165*alive)*(1.-p*.17);
    shade+=alive*hill*(-q.x-q.y)*.64*(1.+p*.4)-p*dent*.115;
    float rim=exp(-pow((r-.68)*4.0,2.));
    shine+=alive*tissue.y*(.16*exp(-length(q+vec2(.26,.31))*5.)+p*rim*.065);
    shade-=p*dent*.12;
    if(t.z>.5){
      float lobe=exp(-dot(q-vec2(.42,.15),q-vec2(.42,.15))*4.);
      shade+=alive*lobe*(-q.x-q.y+.59)*.35;
      tip+=alive*lobe*.10;
    }
    vec2 opening=q+vec2(.09,.12);
    float capRadius=length(opening*vec2(.93,1.12))*(1.+.12*sin(a*3.+phase));
    float core=exp(-pow(capRadius,2.4)*(s.w<.5?18.:33.));
    shade+=alive*exp(-pow((capRadius-.30)*7.,2.))*.035*ridges;
    tip+=s.w<.5?core*alive*(.86+.09*p):0.;
    dark+=s.w>.5?core*alive*(s.w<1.5?.8:.52):0.;
    dark+=(1.-alive)*exp(-r*r*42.)*.32;
  }
  vec2 cover=vec2(min(1.,frame.x/frame.y/photoAspect), min(1.,photoAspect*frame.y/frame.x));
  vec2 sampleUv=(uv+warp-.5)*cover*.89+.5+vec2(sin(caseNo*4.1),cos(caseNo*2.4))*.045;
  if(mod(caseNo,2.)>.5)sampleUv.x=1.-sampleUv.x;
  vec3 skin=texture2D(photo,vec2(sampleUv.x,1.-sampleUv.y)).rgb;
  skin*=vec3(.98,.91,.93)*tissue.x;
  skin+=red*vec3(.27,-.34,-.28)+shade*vec3(.65,.53,.48)+shine;
  skin=mix(skin,skin*.32+vec3(.65,.58,.44),min(tip,1.));
  skin*=1.-dark;
  skin+=.025*tissue.y*smoothstep(.62,.89,skin.r);
  skin*=1.-.19*dot(screen-.5,screen-.5);
  gl_FragColor=vec4(skin,1.);
}
`;
function gpuRenderer(canvas, image) {
  const T = window.THREE;
  if(!T) return null;
  const gl = canvas.getContext('webgl2',{alpha:false,antialias:false});
  if(!gl) return null;
  const renderer = new T.WebGLRenderer({canvas,context:gl,antialias:false});
  // Each region plate gets its own GPU texture. Mutating one texture's image in place leaves a
  // partially stale upload on some drivers (visible as a quadrant seam), so the old texture is
  // disposed and replaced, which also keeps GPU memory bounded across region changes.
  let texture = new T.Texture(image);
  const dress = value => {
    value.minFilter = T.LinearFilter;
    value.generateMipmaps = false;
    value.needsUpdate = true;
    return value;
  };
  dress(texture);
  const vectors = () => Array.from({length:6},()=>new T.Vector4());
  const u = Object.fromEntries(Object.entries({photo:texture,frame:new T.Vector2(),photoAspect:1,tissue:new T.Vector4(),drag:new T.Vector2(),
    sites:vectors(),traits:vectors(),zoom:1,caseNo:0,center:new T.Vector2()}).map(([key,value])=>[key,{value}]));
  const scene = new T.Scene(), camera = new T.Camera();
  scene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms:u,vertexShader,fragmentShader,depthTest:false})));
  return (s,w,h,image) => {
    if(canvas.width!==w || canvas.height!==h) renderer.setSize(w,h,false);
    if(texture.image!==image){
      texture.dispose();
      texture=dress(new T.Texture(image));
      u.photo.value=texture;
    }
    u.photoAspect.value=image.naturalWidth/image.naturalHeight;
    u.tissue.value.set(s.patient.tone,s.region.oil*s.patient.oil,s.region.elasticity,0);
    u.frame.value.set(w,h); u.zoom.value=s.zoom; u.center.value.set(s.cx,s.cy);
    u.caseNo.value=s.index; u.drag.value.set(s.dx,s.dy);
    for(let i=0;i<6;i++) {
      const l=s.field[i];
      if(!l) {u.sites.value[i].z=0;continue;}
      u.sites.value[i].set(l.x,l.y,l.size,l.type);
      u.traits.value[i].set(s.active===i?s.force:0, fullness(s,i),l.boss?1:0,l.phase);
    }
    renderer.render(scene,camera);
  };
}
function fullness(s,i) {
  if(!s.cleared.includes(i)) return 1-.54*(s.layers[i]||0)/s.field[i].layers;
  if(s.burst?.id === i) return Math.pow(Math.max(0,1-s.burst.t*3),2);
  return 0;
}
export function position(s,l) { return {x:(l.x-s.cx)*s.zoom+.5,y:(l.y-s.cy)*s.zoom+.5}; }
function canvasRenderer(canvas,image) {
  const c=canvas.getContext('2d',{alpha:false});
  return (s,w,h,image) => {
    if(canvas.width!==w || canvas.height!==h) {canvas.width=w;canvas.height=h;}
    const cover=Math.max(w/image.width,h/image.height)*s.zoom*1.12;
    const iw=image.width*cover, ih=image.height*cover;
    c.drawImage(image,w*(.5+(.5-s.cx)*s.zoom)-iw/2,h*(.5+(.5-s.cy)*s.zoom)-ih/2,iw,ih);
    c.fillStyle='rgba(110,49,60,.14)'; c.fillRect(0,0,w,h);
    for(const l of s.field) {
      const {x,y}=position(s,l), f=l.id===s.active?s.force:0, a=fullness(s,l.id);
      c.save(); c.translate(x*w+s.dx*f*2,y*h+s.dy*f*2);
      const r=l.size*Math.min(w,h)*s.zoom;
      c.scale(r*(1-.16*f),r*(1+.22*f)); c.rotate(.14*Math.sin(l.phase));
      function wash(x,y,r,stops) {
        const g=c.createRadialGradient(x,y,0,x,y,r);
        stops.forEach(([i,color])=>g.addColorStop(i,color)); c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);
      }
      wash(.16,.23,1.85,[[0,'rgba(109,36,31,'+(.18+.44*a)+')'],[.5,'rgba(171,54,61,'+(.08+.21*a)+')'],[1,'rgba(164,56,59,0)']]);
      if(a>.01) {
        wash(-.25,-.22,.91,[[0,'rgba(255,207,168,'+.52*a+')'],[1,'rgba(237,168,140,0)']]);
        wash(-.04,-.05,l.type===0?.46:.29,[[0,l.type===0?'rgba(248,223,183,'+.95*a+')':'rgba(67,44,35,'+.92*a+')'],[1,'rgba(174,124,99,0)']]);
      }
      c.restore();
    }
  };
}
// A rounded metal profile picks up the same upper-left highlight as the skin.
function contactTool(c,s,w,h) {
  if(!s.contact) return;
  const l=s.field[s.active], pos=position(s,l);
  const r=l.size*Math.min(w,h)*s.zoom;
  c.save(); c.translate(pos.x*w,pos.y*h);
  c.scale(r,r); c.rotate(.64+s.dy*.12);
  c.translate(s.dx*.12,0);
  const steel=c.createLinearGradient(0,-.19,0,.19);
  [[0,'#56625c'],[.2,'#dce0d4'],[.34,'#fff8e7'],[.58,'#959c92'],[.77,'#5d665f'],[1,'#b5bbb0']].forEach(([offset,color])=>steel.addColorStop(offset,color));
  c.shadowColor='rgba(66,36,29,.55)';c.shadowOffsetY=r*.18*(1-s.force*.65);c.shadowBlur=r*.13;
  c.strokeStyle=steel;c.fillStyle=steel;c.lineCap='round';c.lineWidth=.24;
  c.beginPath();c.moveTo(1.65,0);c.lineTo(Math.hypot(w,h)/r,0);c.stroke();
  c.shadowBlur=0;c.shadowOffsetY=0;
  c.beginPath();
  if(s.toolId===0){
    c.moveTo(1.7,0);c.bezierCurveTo(1.05,0,.65,-.62,-.14,-.68);
    c.bezierCurveTo(-1.04,-.77,-1.19,.43,-.42,.59);
    c.bezierCurveTo(.45,.74,.85,.11,1.7,0);c.lineWidth=.105;c.stroke();
  } else if(s.toolId===1){
    c.moveTo(1.75,-.11);c.lineTo(.49,-.045);c.lineTo(.04,-.21);c.lineTo(.45,.065);c.lineTo(1.75,.11);c.fill();
  } else if(s.toolId===2) {
    c.moveTo(1.8,-.14);c.lineTo(.35,-.49);c.quadraticCurveTo(-.25,0,.35,.49);c.lineTo(1.8,.14);c.closePath();c.fill();
    c.beginPath();c.ellipse(.27,0,.20,.47,0,0,Math.PI*2);c.fillStyle='rgba(76,72,59,.48)';c.fill();
  } else if(s.toolId===3) {
    // PoreScope barrel with an illuminated imaging ring.
    c.moveTo(1.8,-.10);c.lineTo(.62,-.13);c.lineTo(.62,.13);c.lineTo(1.8,.10);c.closePath();c.fill();
    c.beginPath();c.ellipse(.5,0,.17,.17,0,0,Math.PI*2);c.lineWidth=.09;c.strokeStyle='#bff6ff';c.stroke();
    c.beginPath();c.ellipse(.5,0,.07,.07,0,0,Math.PI*2);c.strokeStyle='rgba(190,250,255,.7)';c.stroke();
  } else if(s.toolId===4) {
    // Vortex cone with two spiral vanes.
    c.moveTo(1.8,-.15);c.lineTo(.46,-.45);c.quadraticCurveTo(-.2,0,.46,.45);c.lineTo(1.8,.15);c.closePath();c.fill();
    c.beginPath();c.ellipse(.34,0,.19,.42,0,0,Math.PI*2);c.fillStyle='rgba(70,84,76,.55)';c.fill();
    c.strokeStyle='rgba(222,240,226,.85)';c.lineWidth=.055;
    for(const dir of [1,-1]){c.beginPath();c.moveTo(.28,-.3*dir);c.bezierCurveTo(.62,-.5*dir,.62,.34*dir,.3,.26*dir);c.stroke();}
  } else {
    // Resonance Wand: needle shaft and stepped fork tips.
    c.moveTo(1.8,-.06);c.lineTo(.32,-.045);c.lineTo(.32,.045);c.lineTo(1.8,.06);c.closePath();c.fill();
    c.strokeStyle='#9ff3c8';c.lineWidth=.07;
    c.beginPath();c.moveTo(.3,-.12);c.lineTo(.3,.12);c.moveTo(.3,-.12);c.lineTo(-.08,-.16);c.moveTo(.3,.12);c.lineTo(-.08,.16);c.stroke();
    c.fillStyle='#cefa80';c.beginPath();c.arc(-.1,-.17,.055,0,Math.PI*2);c.fill();
    c.beginPath();c.arc(-.1,.17,.055,0,Math.PI*2);c.fill();
  }
  c.restore();
}
function drawStream(c,stream,pos,r,l){
  const points=stream.particles;
  c.save();c.translate(pos.x*1,pos.y*1);
  function strand(color,width,offset){
    c.strokeStyle=color;
    for(let i=1;i<points.length;i++){
      const p=points[i-1],q=points[i];
      c.lineWidth=q.r*width;c.beginPath();c.moveTo(p.x+offset,p.y+offset);
      c.lineTo(q.x+offset,q.y+offset);c.stroke();
    }
  }
  strand('rgba(74,46,33,.48)',2.15,.065);
  strand(stream.mat.color,2,0);strand(stream.mat.highlight,.61,-.032);
  if(l.type===1){
    const tip=points.at(-1);
    c.fillStyle='#745941';c.beginPath();c.ellipse(tip.x,tip.y,tip.r,tip.r*.82,.4,0,Math.PI*2);c.fill();
  }
  for(const p of stream.droplets){
    c.fillStyle=stream.mat.color;c.beginPath();c.ellipse(p.x,p.y,p.r,p.r*.8,0,0,Math.PI*2);c.fill();
    c.fillStyle=stream.mat.highlight;c.beginPath();c.arc(p.x-.02,p.y-.02,p.r*.37,0,Math.PI*2);c.fill();
  }
  c.restore();
}
function drawOpticalHud(c,s,w,h) {
  if(!s.contact) return;
  const l=s.field[s.active]; if(!l) return;
  const pos=position(s,l), px=pos.x*w, py=pos.y*h;
  const baseR=Math.max(24,l.size*Math.min(w,h)*s.zoom*1.32);
  const pct=Math.max(0,Math.min(1,s.applied??s.force));
  c.save();
  // Subtle recessed ring + live phosphor arc right on the active target
  c.strokeStyle='rgba(14,19,16,.55)';
  c.lineWidth=Math.max(3,baseR*.09);
  c.beginPath();c.arc(px,py,baseR,0,Math.PI*2);c.stroke();
  c.strokeStyle=s.inBand?'#cefa80':'rgba(232,244,218,.78)';
  c.lineWidth=Math.max(2.5,baseR*(s.inBand?.105:.075));
  c.lineCap='round';
  if(s.inBand){c.shadowColor='#cefa80';c.shadowBlur=12;}
  c.beginPath();c.arc(px,py,baseR,-Math.PI/2,-Math.PI/2+pct*Math.PI*2);c.stroke();
  c.restore();
}
function drawBurst(c,s,w,h) {
  drawOpticalHud(c,s,w,h);
  contactTool(c,s,w,h);
  if(!s.burst)return;
  const b=s.burst, l=s.field[b.id], pos=position(s,l);
  const r=l.size*Math.min(w,h)*s.zoom;
  const px=pos.x*w, py=pos.y*h;
  // Brief expanding optical release ring + crisp micro-callout
  if(b.t<.55 && !s.reducedMotion){
    const u=b.t/.55;
    c.save();
    c.strokeStyle=b.perfect?`rgba(206,250,128,${(1-u)*.82})`:`rgba(220,242,216,${(1-u)*.62})`;
    c.lineWidth=Math.max(1.5,(1-u)*3.5);
    c.beginPath();c.arc(px,py,r*(.9+u*1.75),0,Math.PI*2);c.stroke();
    c.restore();
  }
  // A reservoir can open several outlets in one release. Each stream keeps its own material.
  const streams=b.streams||[b];
  for(const stream of streams){
    c.save();c.translate(px,py);c.scale(r,r);
    c.globalAlpha=Math.max(0,Math.min(1,(1-b.t)*4));
    c.lineCap='round';c.lineJoin='round';
    drawStream(c,stream,{x:0,y:0},r,l);
    c.restore();
  }
  if(b.callout && b.t<.82){
    const fade=Math.min(1,(0.82-b.t)*3.2), rise=s.reducedMotion?0:b.t*26;
    c.save();
    c.globalAlpha=fade;
    c.font='700 '+Math.max(12,Math.round(Math.min(w,h)*.024))+'px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign='center';
    c.fillStyle='rgba(17,22,19,.86)';
    const label=b.callout, tw=c.measureText(label).width+14, th=22;
    const tx=Math.max(tw/2+8,Math.min(w-tw/2-8,px));
    const ty=Math.max(30,py-r*1.15-rise);
    c.beginPath();c.roundRect(tx-tw/2,ty-th/2,tw,th,4);c.fill();
    c.strokeStyle=b.perfect?'#cefa80':'#9db89c';
    c.lineWidth=1;c.stroke();
    c.fillStyle=b.perfect?'#cefa80':'#eff4e8';
    c.fillText(label,tx,ty+4);
    c.restore();
  }
}
export async function createRenderer(stage, canvas, overlay, initialUrl) {
  let image=new Image(); image.src=initialUrl;
  await image.decode();
  let draw;
  try {draw=gpuRenderer(canvas,image);} catch {}
  function fallback(){
    const next=canvas.cloneNode(false);
    canvas.replaceWith(next); canvas=next;
    draw=canvasRenderer(canvas,image);
    stage.dataset.renderer='canvas2d';
  }
  if(!draw) fallback();
  else {
    stage.dataset.renderer='webgl2';
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();fallback();stage.dispatchEvent(new Event('redraw'));},{once:true});
  }
  const effects=overlay.getContext('2d');
  let desired=image.src,quality=1.5,slow=0;
  const paint=s=>{
    // Lower the backing-buffer cost only after repeated slow interactive frames.
    if(s.contact && s.frameMs>34 && s.frameMs<200)slow++;else slow=Math.max(0,slow-1);
    if(slow>=6){quality=Math.max(.7,quality-.2);slow=0;}
    const dpr=Math.min(window.devicePixelRatio||1,quality);
    const w=Math.max(1,Math.round(stage.clientWidth*dpr)),h=Math.max(1,Math.round(stage.clientHeight*dpr));
    if(overlay.width!==w || overlay.height!==h) {overlay.width=w;overlay.height=h;}
    draw(s,w,h,image);
    effects.clearRect(0,0,w,h);
    // Expansion imaging (PoreScope) paints on the same 2D overlay, so WebGL2 and Canvas share it.
    // It sits under the expelled material and the instrument so an extraction stays readable.
    if(paint.overlay)paint.overlay(effects,s,w,h);
    drawBurst(effects,s,w,h);
  };
  paint.region=async url=>{
    desired=url;
    if(image.src===url)return;
    const next=new Image();next.src=url;
    await next.decode();
    if(desired===url){image=next;stage.dispatchEvent(new Event('redraw'));}
  };
  return paint;
}
