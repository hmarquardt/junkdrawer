import {cases,tools,rank,makeField,pressure,assess,newCampaign} from './simulation.js';
import {openCampaign} from './storage.js';
import {bindPressure} from './input.js';
import {soundEngine} from './audio.js';
import {createRenderer,position} from './render.js';
import {illustrate} from './instruments.js';
const $=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0');
const icon=id=>'<svg aria-hidden="true"><use href="#'+id+'"/></svg>';
const audio=soundEngine();
let campaign=newCampaign(),database,saveQueue=Promise.resolve(),saveBroken=false;
let field,active=0,zoom=1,draw,started=null,force=0,burst=null,recoil=0,dx=0,dy=0;
let pending=0,ready=false,lastStamp=0, heldSource=null;
let markerListeners;
const dialog=$('dialog');
const tool=()=>tools[campaign.tool], complete=()=>campaign.cleared.length===field.length;
const current=()=>field[active];
const restCue='Hold to build pressure. Release in the green zone.';
function save() {
  if(!database || saveBroken)return;
  const previous=campaign.revision++;
  const snapshot=structuredClone(campaign);
  saveQueue=saveQueue.then(async()=>{
    if(saveBroken)return;
    try {await database.write(snapshot,previous);}
    catch(e) {saveBroken=true;$('saveStatus').textContent=e.message || 'Save unavailable. Progress is held in this tab.';}
  });
}
function cue(text){$('cue').textContent=text;}
function play(cue){if(campaign.sound)audio.play(cue,current()?.phase||0);}
function view() {
  const t=current();
  return {index:campaign.caseIndex,field,active,cleared:campaign.cleared,force,dx,dy,burst,zoom,
    cx:zoom===1?.5:Math.max(.5/zoom,Math.min(1-.5/zoom,t.x)),
    contact:started!==null,toolId:campaign.tool,
    cy:zoom===1?.5:Math.max(.5/zoom,Math.min(1-.5/zoom,t.y))};
}
function schedule(){if(!pending) pending=requestAnimationFrame(frame);}
function frame(stamp){
  pending=0;
  if(!draw || !ready)return;
  if(started!==null)force=pressure(Math.max(0,stamp-started)/1000,current(),tool());
  else if(recoil>.001){recoil*=Math.exp(-Math.min(100,stamp-lastStamp)/60);force=recoil;}
  else {force=0;recoil=0;}
  lastStamp=stamp;
  if(burst){burst.t=(stamp-burst.start)/860;if(burst.t>=1)burst=null;}
  const val=started===null?0:Math.round(force*100);
  $('percent').textContent=val+'%';$('meter').setAttribute('aria-valuenow',val);$('needle').style.left='calc('+val+'% - 1px)';
  draw(view());
  if(started!==null || recoil || burst)schedule();
}
function refreshMarkers() {
  markerListeners?.abort();
  markerListeners=new AbortController();
  const s=view();
  $('markers').replaceChildren();
  for(const l of field) {
    if(campaign.cleared.includes(l.id))continue;
    const b=document.createElement('button'), pos=position(s,l);
    b.className='marker'+(l.id===active?' current':'')+(pos.x>.68?' flip':'');
    b.style.left=100*pos.x+'%';b.style.top=100*pos.y+'%';
    b.setAttribute('aria-label','Target '+(l.id+1)+', '+l.name+'. Hold to extract.');
    b.innerHTML='<span class="ring"></span><span class="marker-label">'+pad(l.id+1)+(l.id===active?' / '+l.name.toUpperCase():'')+'</span>';
    $('markers').append(b);
    bindPressure(b,e=>{
      if(started!==null || !ready || dialog.open)return false;
      if(active!==l.id) {
        active=l.id;
        // Preserve the capturing element while the gesture is in flight.
        syncControls();
        for(const [i,node] of [...$('markers').children].entries()){
          const item=field.filter(v=>!campaign.cleared.includes(v.id))[i];
          node.classList.toggle('current',item.id===active);
          node.lastElementChild.textContent=pad(item.id+1)+(item.id===active?' / '+item.name.toUpperCase():'');
          const p=position(view(),item);node.style.left=p.x*100+'%';node.style.top=p.y*100+'%';
          node.classList.toggle('flip',p.x>.68);
        }
      }
      return start(b,e);
    },release,cancel,move,markerListeners.signal);
  }
}
function syncControls(){
  const t=current(), total=field.length;
  $('zone').style.left=(t.goal-tool().window)*100+'%';
  $('zone').style.width=tool().window*200+'%';
  $('extract').disabled=!ready;
  $('extract').hidden=complete(); $('review').hidden=!complete();
  $('targetCount').textContent=campaign.cleared.length+' / '+total;
  $('segments').innerHTML=field.map(l=>'<i class="'+(campaign.cleared.includes(l.id)?'done':'')+'"></i>').join('');
  $('zoomOut').disabled=zoom===1;$('zoomIn').disabled=zoom===2;
  $('zoomValue').textContent=zoom.toFixed(1)+'×';
}
function renderUI(){
  const i=campaign.caseIndex,[title,site,flavor]=cases[i], number=String(i+1).padStart(3,'0');
  $('caseTitle').textContent=title;$('site').textContent=site.toUpperCase();$('flavor').textContent=flavor;
  $('fieldNumber').textContent='FIELD '+pad(i+1);$('caseBadge').textContent='CASE '+number;
  $('caseCode').textContent='FILE / '+number;$('difficulty').textContent=['ROOKIE','ROOKIE','SKILLED','SKILLED','EXPERT','EXPERT'][i];
  $('rankName').textContent=rank(campaign.xp);
  $('soundBtn').innerHTML=icon(campaign.sound?'sound':'mute')+'<span>Sound '+(campaign.sound?'on':'off')+'</span>';
  $('soundBtn').setAttribute('aria-pressed',campaign.sound);
  $('kitCount').textContent=pad(tools.filter(t=>campaign.xp>=t.xp).length)+' / 03 AVAILABLE';
  $('tools').replaceChildren();
  tools.forEach((t,id)=>{
    const b=document.createElement('button'),owned=campaign.xp>=t.xp,eq=id===campaign.tool;
    b.className='tool'+(eq?' equipped':'');b.disabled=!owned;b.setAttribute('aria-pressed',eq);
    b.innerHTML='<span class="tool-art"><canvas aria-hidden="true"></canvas></span><span><span class="tool-name">'+t.name+'</span><span class="tool-detail">'+(owned?t.type:'Unlock at '+t.xp+' XP')+'</span></span><span class="tool-status">'+icon(eq?'check':owned?'kit':'lock')+'<span class="sr">'+(eq?'Equipped':owned?'Available':'Locked')+'</span></span>';
    $('tools').append(b);illustrate(b.querySelector('canvas'),id);
    b.onclick=()=>{cancel();campaign.tool=id;save();renderUI();cue(t.name+' equipped. '+restCue);};
  });
  syncControls();refreshMarkers();schedule();
}
function loadField(){
  field=makeField(campaign.caseIndex);
  active=field.find(l=>!campaign.cleared.includes(l.id))?.id??0;
  zoom=1;started=null;heldSource=null;force=recoil=dx=dy=0;burst=null;
  renderUI();cue(complete()?'Field cleared. Your case report is ready.':restCue);
}
function start(source,e) {
  if(!ready || started!==null || dialog.open || complete())return false;
  if(campaign.sound)audio.wake();
  heldSource={source,x:e.clientX,y:e.clientY};
  dx=dy=0;started=performance.now();recoil=0;play('touch');cue('Release when the indicator reaches green.');schedule();
  return true;
}
function move(e){
  if(!heldSource)return;
  dx=Math.max(-1,Math.min(1,(e.clientX-heldSource.x)/35));
  dy=Math.max(-1,Math.min(1,(e.clientY-heldSource.y)/35));schedule();
}
function cancel(){
  if(started===null)return;
  started=null;heldSource=null;recoil=force;cue(restCue);schedule();
}
function release(){
  if(started===null)return;
  const now=performance.now(),v=pressure((now-started)/1000,current(),tool()),result=assess(v,current(),tool());
  const returnFocus=heldSource?.source?.classList.contains('marker');
  started=null;heldSource=null;recoil=v;
  if(!result.success) {
    cue(v<current().goal?'A little early. Hold until the indicator reaches green.':'Too much pressure. Try another pass through green.');play('miss');schedule();return;
  }
  const xp=result.perfect?30:20;
  play('release');burst={id:active,start:now,t:0};
  campaign.cleared.push(active);campaign.total++;campaign.xp+=xp;
  if(complete())campaign.xp+=40;
  active=field.find(l=>!campaign.cleared.includes(l.id))?.id??active;
  recoil=0;force=0;zoom=1;
  save();renderUI();
  if(returnFocus) (complete()?$('review'):$('markers').querySelector('.current'))?.focus({preventScroll:true});
  cue(complete()?'Field cleared! +40 case XP. Your report is ready.':(result.perfect?'Perfect release':'Clean extraction')+'! +'+xp+' XP. Next target acquired.');
}
bindPressure($('extract'),e=>start($('extract'),e),release,cancel,move);
$('review').onclick=report;
for(const [id,step] of [['zoomIn',.5],['zoomOut',-.5]]) $(id).onclick=()=>{cancel();zoom=Math.max(1,Math.min(2,zoom+step));refreshMarkers();syncControls();schedule();};
$('soundBtn').onclick=()=>{campaign.sound=!campaign.sound;if(campaign.sound){audio.wake();play('touch');}save();renderUI();};
function modal(title,html,actions=[],label='WORKSTATION'){
  cancel();
  const body=$('dialogBody');
  body.innerHTML='<small>'+label+'</small><h2 id="dialogTitle">'+title+'</h2>'+html;
  dialog.setAttribute('aria-labelledby','dialogTitle');
  const bar=document.createElement('div');bar.className='dialog-actions';
  for(const [name,fn,secondary] of actions) {
    const b=document.createElement('button');b.className=secondary?'secondary':'primary';b.textContent=name;
    b.onclick=fn;bar.append(b);
  }
  if(actions.length)body.append(bar);
  if(!dialog.open)dialog.showModal();
}
const close=()=>dialog.close();
$('dismiss').onclick=close;
dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}};
$('workstation').onclick=()=>{if(dialog.open)close();$('viewTitle').scrollIntoView({block:'nearest'});};
$('pauseBtn').onclick=()=>modal('Shift paused','<p>Your field is waiting exactly where you left it.</p>',[['Resume shift',close]]);
$('manualBtn').onclick=()=>modal('Field manual','<h3>Choose a target</h3><p>The solid reticle marks the active pore. Hold any numbered marker to switch to it, or use the extraction button.</p><h3>Time the release</h3><p>Hold with a pointer, Space or Enter. Let go in the green band for a clean extraction. The indicator cycles while held. The center earns a precision bonus.</p><h3>Work the shift</h3><p>Clear every target for 40 bonus XP. New instruments change the pressure speed and timing window. Case files show your rank and unlocks.</p><p>Fictional arcade mechanics. Never attempt on real skin.</p>',[['Back to work',close]],'OPERATOR REFERENCE');
function files(){
  const rows=cases.map(([title],i)=>{
    const status=i<campaign.caseIndex || i===campaign.caseIndex && complete()?'CLEARED':i===campaign.caseIndex?'IN PROGRESS':'LOCKED';
    return '<div class="file-row '+(i===campaign.caseIndex?'current':'')+'"><span>'+pad(i+1)+'</span><strong>'+title+'</strong><small>'+status+'</small></div>';
  }).join('');
  modal('Case files','<p>'+rank(campaign.xp)+' · '+campaign.xp+' XP · '+campaign.total+' extractions</p>'+rows,
    [['Return to shift',close],['Reset campaign',resetPrompt,true]],'CAMPAIGN RECORD');
}
$('filesBtn').onclick=files;
function resetPrompt(){
  modal('Reset campaign?','<p>This clears your current field, XP, and instrument unlocks on this device.</p>',[['Keep campaign',files],['Reset campaign',()=>{
    const revision=campaign.revision,sound=campaign.sound;
    campaign={...newCampaign(),revision,sound};save();loadField();close();
  },true]]);
}
function report(){
  const last=campaign.caseIndex===cases.length-1;
  modal(last?'Campaign complete':'Case cleared','<p>'+cases[campaign.caseIndex][0]+' · '+field.length+' targets cleared.</p><h3>'+campaign.xp+' XP · '+rank(campaign.xp)+'</h3><p>'+(last?'Danny is officially off the clock.':'Your next field is ready for inspection.')+'</p>',
    last?[['View campaign',files],['Play again',resetPrompt,true]]:[['Begin next case',()=>{campaign.caseIndex++;campaign.cleared=[];save();loadField();close();}]],'EXTRACTION REPORT');
}
new ResizeObserver(schedule).observe($('stage'));
$('stage').addEventListener('redraw',schedule);
async function init(){
  document.querySelector('main').inert=true;
  document.querySelector('header').inert=true;
  try{database=await openCampaign();campaign=(await database.read())||campaign;}
  catch{database=null;$('saveStatus').textContent='Local saving is unavailable. You can play in this tab.';}
  try {
    draw=await createRenderer($('stage'),$('skin'),$('effects'));
    ready=true;loadField();document.querySelector('main').inert=false;document.querySelector('header').inert=false;$('feedStatus').textContent='Optics online';
  } catch { $('feedStatus').textContent='Optics unavailable';cue('The skin texture could not load. Reload to retry.');}
  if('serviceWorker' in navigator) {
    try{await navigator.serviceWorker.register('./danny-sw.js',{scope:'./danny-the-pimple-popper.html'});}
    catch{ $('saveStatus').textContent+=' Offline installation is unavailable in this browser.'; }
  }
}
init();
