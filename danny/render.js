const vertexShader = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;
const fragmentShader = `
precision highp float;
uniform sampler2D photo;
uniform vec2 frame, drag;
uniform vec4 sites[6], traits[6];
uniform float zoom, caseNo;
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
    q.x*=1.+p*.47;
    float a=atan(q.y,q.x), r=length(q)*(1.+.062*cos(3.*a+phase)+.04*sin(5.*a-phase));
    float hill=exp(-r*r*1.75), halo=exp(-r*r*.52);
    float dent=exp(-pow((abs(q.x)-1.25)*1.8,2.)-q.y*q.y*1.3);
    warp+=s.z/aspect*(q*(hill*(-.20*alive)+p*halo*.4)-drag*p*halo*.42);
    red+=halo*(.045+.21*alive)*(1.-p*.17);
    shade+=alive*hill*(-q.x-q.y)*.86*(1.+p*.4)-p*dent*.115;
    shine+=alive*.16*exp(-length(q+vec2(.26,.31))*5.);
    float core=exp(-r*r*(s.w<.5?11.:26.));
    tip+=s.w<.5?core*alive*(.86+.09*p):0.;
    dark+=s.w>.5?core*alive*(s.w<1.5?.8:.52):0.;
    dark+=(1.-alive)*exp(-r*r*42.)*.32;
  }
  vec2 cover=vec2(min(1.,frame.x/frame.y/1.5), min(1.,1.5*frame.y/frame.x));
  vec2 sampleUv=(uv+warp-.5)*cover*.89+.5+vec2(sin(caseNo*4.1),cos(caseNo*2.4))*.045;
  if(mod(caseNo,2.)>.5)sampleUv.x=1.-sampleUv.x;
  vec3 skin=texture2D(photo,vec2(sampleUv.x,1.-sampleUv.y)).rgb;
  skin*=vec3(.98,.87,.89)*(1.-.035*mod(caseNo,4.));
  skin+=red*vec3(.27,-.34,-.28)+shade*vec3(.65,.53,.48)+shine;
  skin=mix(skin,skin*.47+vec3(.52,.43,.32),min(tip,1.));
  skin*=1.-dark;
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
  const texture = new T.Texture(image);
  texture.minFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const vectors = () => Array.from({length:6},()=>new T.Vector4());
  const u = Object.fromEntries(Object.entries({photo:texture,frame:new T.Vector2(),drag:new T.Vector2(),
    sites:vectors(),traits:vectors(),zoom:1,caseNo:0,center:new T.Vector2()}).map(([key,value])=>[key,{value}]));
  const scene = new T.Scene(), camera = new T.Camera();
  scene.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({uniforms:u,vertexShader,fragmentShader,depthTest:false})));
  return (s,w,h) => {
    if(canvas.width!==w || canvas.height!==h) renderer.setSize(w,h,false);
    u.frame.value.set(w,h); u.zoom.value=s.zoom; u.center.value.set(s.cx,s.cy);
    u.caseNo.value=s.index; u.drag.value.set(s.dx,s.dy);
    for(let i=0;i<6;i++) {
      const l=s.field[i];
      if(!l) {u.sites.value[i].z=0;continue;}
      u.sites.value[i].set(l.x,l.y,l.size,l.type);
      u.traits.value[i].set(s.active===i?s.force:0, fullness(s,i),0,l.phase);
    }
    renderer.render(scene,camera);
  };
}
function fullness(s,i) {
  if(!s.cleared.includes(i)) return 1;
  if(s.burst?.id === i) return Math.pow(Math.max(0,1-s.burst.t*3),2);
  return 0;
}
export function position(s,l) { return {x:(l.x-s.cx)*s.zoom+.5,y:(l.y-s.cy)*s.zoom+.5}; }
function canvasRenderer(canvas,image) {
  const c=canvas.getContext('2d',{alpha:false});
  return (s,w,h) => {
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
  } else {
    c.moveTo(1.8,-.14);c.lineTo(.35,-.49);c.quadraticCurveTo(-.25,0,.35,.49);c.lineTo(1.8,.14);c.closePath();c.fill();
    c.beginPath();c.ellipse(.27,0,.20,.47,0,0,Math.PI*2);c.fillStyle='rgba(76,72,59,.48)';c.fill();
  }
  c.restore();
}
function drawBurst(c,s,w,h) {
  c.clearRect(0,0,w,h);
  contactTool(c,s,w,h);
  if(!s.burst)return;
  const {id,t}=s.burst, l=s.field[id], pos=position(s,l);
  const r=l.size*Math.min(w,h)*s.zoom;
  const rise=Math.sin(Math.min(1,t*2.8)*Math.PI/2), fade=Math.min(1,(1-t)*3.7);
  c.save(); c.translate(pos.x*w,pos.y*h);
  c.rotate(.3*Math.sin(l.phase)); c.globalAlpha=Math.max(0,fade);
  c.scale(r,r); c.lineCap='round'; c.lineJoin='round';
  const length=[1.65,.70,1.10][l.type];
  const endX=Math.sin(l.phase)*rise*.94, endY=-rise*(length+.32*Math.cos(l.phase)) + Math.max(0,t-.35)*.95;
  const stroke=(color,width,offset)=>{
    c.beginPath();c.moveTo(0,0);c.bezierCurveTo(-.22*rise,-.8*rise,endX+.48*rise,endY-.28*rise,endX+offset,endY);
    c.strokeStyle=color;c.lineWidth=width;c.stroke();
  };
  stroke('rgba(83,51,34,.48)',.26,0);
  stroke(l.type===1?'#c8ad80':'#e5cfa4',.19,-.025);
  stroke('rgba(255,240,201,.77)',.055,-.045);
  if(l.type===1) {
    c.beginPath();c.ellipse(endX,endY,.13,.17,-.4,0,Math.PI*2);c.fillStyle='#74563c';c.fill();
  } else {
    const count=l.type===0?3:2;
    for(let i=0;i<count;i++){
      const phase=l.phase+i*1.7, speed=.8+.3*i;
      const x=endX+Math.cos(phase)*t*speed, y=endY-t*(1.55+.2*i)+t*t*2.2;
      c.beginPath();c.ellipse(x,y,.085+.025*i,.065+.04*i,phase,0,Math.PI*2);
      c.fillStyle=i===0?'#ebd6b0':'#dfc39d';c.fill();
    }
  }
  c.restore();
}
export async function createRenderer(stage, canvas, overlay) {
  const image=new Image(); image.src=new URL('skin.jpg',import.meta.url);
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
  return s => {
    const dpr=Math.min(window.devicePixelRatio||1,1.6);
    const w=Math.max(1,Math.round(stage.clientWidth*dpr)),h=Math.max(1,Math.round(stage.clientHeight*dpr));
    if(overlay.width!==w || overlay.height!==h) {overlay.width=w;overlay.height=h;}
    draw(s,w,h); drawBurst(effects,s,w,h);
  };
}
