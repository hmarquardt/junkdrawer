import {content,baseReady,restoreContent} from './content.js';
import {makeField,pressure,assess,band,eject,stepMaterial} from './simulation.js';
import {fresh,migrate,visitFor,rank,switchMode,calibrated,availableUpgrades,reward,advance} from './progression.js';
import {openCampaign} from './storage.js';
import {bindPressure} from './input.js';
import {soundEngine} from './audio.js';
import {createRenderer,position} from './render.js';
import {illustrate} from './instruments.js';
const $=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0');
const icon=id=>'<svg aria-hidden="true"><use href="#'+id+'"/></svg>';
const audio=soundEngine(),dialog=$('dialog');
let profile,visit,field,tool,active=0,zoom=1,draw,ready=false;
// The Pore Explorer is fetched only when a player opens it or resumes its checkpoint.
let expansion=null,expansionLoading=null,clinic=null,clinicLoading=null,world=null,worldLoading=null,spa=null,spaLoading=null;
let database,writesPending=0,saveBroken=false,markerListeners;
let started=null,source=null,force=0,velocity=0,dx=0,dy=0,burst=null,lastStamp=0,frameMs=0,pending=0,inside=false;
const current=()=>field[active], run=()=>visit.run, complete=()=>run().cleared.length===field.length;
const locked=l=>l.boss && run().cleared.length<field.length-1;
const layer=()=>run().layers[active]||0;
const cue=text=>{$('cue').textContent=text;};
const say=text=>{$('saveStatus').textContent=text;};
const rest=()=>visit.zen?'Use any pressure. Release whenever it feels right.':profile.settings.toggle?'Press once to build pressure. Press again in the green zone.':'Hold to build pressure. Release in the green zone.';
function play(cue,phase=current()?.phase||0,pan=0){if(profile.settings.sound)audio.play(cue,phase,pan);}
function buzz(ms){if(profile.settings.haptics)navigator.vibrate?.(ms);}
function save(eraseHistory=false){
  if(!database || saveBroken)return;
  const previous=profile.revision++,parentId=profile.checkpointId??null;
  profile.checkpointId=crypto.randomUUID();
  profile.packs={...profile.packs,...content.versions()};
  const snapshot=structuredClone(profile);
  // Opening the transaction synchronously also queues it before a quick navigation.
  // IndexedDB serializes readwrite transactions on this object store in creation order.
  writesPending++;$('feedStatus').dataset.save='pending';
  database.write(snapshot,previous,parentId,eraseHistory).catch(e=>{
    saveBroken=true;say(e.message);
  }).finally(()=>{
    if(--writesPending===0)$('feedStatus').dataset.save=saveBroken?'failed':'saved';
  });
}
function view(){
  const t=current();
  return {index:visit.patient.grain,field,active,cleared:run().cleared,layers:run().layers,
    force,dx,dy,burst,zoom,region:visit.region,patient:visit.patient,frameMs,
    cx:zoom===1?.5:Math.max(.5/zoom,Math.min(1-.5/zoom,t.x)),
    cy:zoom===1?.5:Math.max(.5/zoom,Math.min(1-.5/zoom,t.y)),contact:started!==null,toolId:tool.art};
}
function schedule(){if(!pending)pending=requestAnimationFrame(frame);}
function updateBand(zone){
  $('zone').style.left=(zone.center-zone.width)*100+'%';
  $('zone').style.width=zone.width*200+'%';
}
function frame(stamp){
  pending=0;if(!ready)return;
  frameMs=lastStamp?Math.max(0,stamp-lastStamp):16;lastStamp=stamp;
  const dt=Math.min(.05,frameMs/1000),seconds=started===null?0:Math.max(0,stamp-started)/1000;
  const applied=started===null?0:pressure(seconds,current(),tool,layer());
  // Damped surface recovery; short substeps also bound the response after a suspended frame.
  for(let i=0;i<4;i++){
    const step=dt/4;velocity+=((applied-force)*260-velocity*23)*step;force+=velocity*step;
  }
  if(Math.abs(force)<.001 && Math.abs(velocity)<.01 && started===null){force=0;velocity=0;}
  if(burst){stepMaterial(burst,frameMs/1000);if(burst.t>=1)burst=null;}
  const zone=band(seconds,current(),tool,layer()),inBand=started!==null&&(visit.zen||assess(applied,zone).success);
  if(inBand && !inside){play('zone');buzz(12);if(profile.settings.assist)cue('Release now.');}
  inside=inBand;
  if(started!==null && profile.settings.sound)audio.pressure(applied,inside);
  $('meter').classList.toggle('inside',inside);
  const val=Math.round(applied*100);
  $('percent').textContent=val+'%';$('meter').setAttribute('aria-valuenow',val);
  $('needle').style.left='calc('+val+'% - 1px)';
  updateBand(visit.zen?{center:.5,width:.5}:zone);
  draw(view());
  if(started!==null||velocity||force||burst)schedule();
}
function markerStyle(b,l){
  const pos=position(view(),l),selected=l.id===active;
  b.className='marker'+(selected?' current':'')+(pos.x>.67?' flip':'')+(l.boss?' boss':'');
  b.style.left=pos.x*100+'%';b.style.top=pos.y*100+'%';
  b.disabled=locked(l);
  b.lastElementChild.textContent=b.disabled?'BOSS':pad(l.id+1)+(selected?' / '+(l.boss?'BOSS':l.name.toUpperCase()):'')+(l.deep?(l.deep.state?.found?' ◈':' ◇'):'');
  b.setAttribute('aria-label',(l.boss?'Boss ':'Target ')+(l.id+1)+', '+l.name+(b.disabled?', clear other targets first.':'.'));
}
function bindAction(b,choose,signal){
  bindPressure(b,e=>{
    if(!ready || dialog.open || complete())return false;
    if(started!==null){
      if(profile.settings.toggle && source?.button===b)release();
      return false;
    }
    choose();start(b,e);return true;
  },()=>{if(!profile.settings.toggle)release();},cancel,move,signal);
  // Assistive technology can activate a button without sending pointer or key events.
  b.addEventListener('click',e=>{
    if(e.detail!==0 || !e.isTrusted || !ready || complete() || dialog.open)return;
    if(started!==null){release();return;}
    choose();start(b,e);cue('Activate again to release.');
  },{signal});
}
function refreshMarkers(){
  markerListeners?.abort();markerListeners=new AbortController();$('markers').replaceChildren();
  for(const l of field){
    if(run().cleared.includes(l.id))continue;
    const b=document.createElement('button');
    b.innerHTML='<span class="ring"></span><span class="marker-label"></span>';
    b.dataset.target=l.id;markerStyle(b,l);$('markers').append(b);
    bindAction(b,()=>{
      active=l.id;
      for(const node of $('markers').children)markerStyle(node,field[Number(node.dataset.target)]);
      syncControls();
    },markerListeners.signal);
  }
}
function syncControls(){
  $('extract').disabled=!ready;$('extract').hidden=complete();$('review').hidden=!complete();
  $('extract').classList.toggle('latched',started!==null&&profile.settings.toggle);
  $('extract').lastElementChild.textContent=profile.settings.toggle?(started!==null?'Release pressure':'Start pressure'):'Hold to extract';
  $('targetCount').textContent=run().cleared.length+' / '+field.length;
  $('segments').innerHTML=field.map(l=>'<i class="'+(run().cleared.includes(l.id)?'done':'')+'"></i>').join('');
  $('zoomOut').disabled=zoom===1;$('zoomIn').disabled=zoom===2;
  $('zoomValue').textContent=zoom.toFixed(1)+'×';
  $('bossHint').hidden=!visit.boss;
  if(visit.boss)$('bossHint').textContent=visit.boss.name+' · '+(current().boss?'Pass '+Math.min(layer()+1,current().layers)+'/'+current().layers+'. '+visit.boss.hint:'Clear the field to face the boss.');
}
function renderUI(){
  const {encounter,mode,patient,region,chapter,chapterIndex}=visit;
  tool=calibrated(profile,visit);audio.volume(profile.settings.volume);
  document.body.classList.toggle('contrast',profile.settings.contrast);
  $('caseTitle').textContent=encounter.name;$('site').textContent=region.name.toUpperCase();
  $('patient').textContent=patient.name+' · '+patient.job;$('flavor').textContent=encounter.flavor;
  $('fieldNumber').textContent='FIELD '+pad(run().turn);$('caseBadge').textContent='CASE '+String(run().turn).padStart(3,'0');
  $('caseCode').textContent=visit.zen?'FREE PLAY':'SCORE / '+run().points;
  $('difficulty').textContent=visit.boss?'BOSS SHIFT':visit.zen?'UNTIMED':'STANDARD';
  $('modeBtn').textContent=mode.name.toUpperCase()+' MODE ▾';
  const expanded=String(mode.id).startsWith('pore-explorer:');
  $('introText').textContent=expanded?(mode.strategy==='campaign'?'Beneath the surface · chapter '+(chapterIndex+1)+' of '+mode.chapters.length+' · '+chapter.name:mode.description):mode.strategy==='campaign'?'Chapter '+(chapterIndex+1)+' of '+mode.chapters.length+' · '+chapter.name:mode.description;
  $('rankName').textContent=rank(profile.xp);
  $('soundBtn').innerHTML=icon(profile.settings.sound?'sound':'mute')+'<span>Sound '+(profile.settings.sound?'on':'off')+'</span>';
  $('soundBtn').setAttribute('aria-pressed',profile.settings.sound);
  const family=visit.mode.id.split(':')[0];
  const inScope=item=>!item.scope||(Array.isArray(item.scope)?item.scope.includes(family):item.scope===family);
  const equipment=content.list('equipment').filter(inScope);
  const archiveKit=visit.mode.id.startsWith('world-book-of-pores:')||visit.mode.id.startsWith('disgusting-day-spa:');
  $('kitCount').textContent=pad(equipment.filter(t=>visit.zen||archiveKit||profile.xp>=t.xp).length)+' / '+pad(equipment.length)+' AVAILABLE';
  $('tools').replaceChildren();
  for(const item of equipment){
    const restricted=!!(clinic?.toolLocked?.(item.id)||world?.toolLocked?.(item.id));
    const archive=visit.mode.id.startsWith('world-book-of-pores:')||visit.mode.id.startsWith('disgusting-day-spa:');
    const b=document.createElement('button'),owned=visit.zen||archive||profile.xp>=item.xp,eq=item.id===tool.id;
    b.className='tool'+(eq?' equipped':'');b.disabled=!owned||restricted;b.setAttribute('aria-pressed',eq);
    b.innerHTML='<span class="tool-art"><canvas aria-hidden="true"></canvas></span><span><span class="tool-name"></span><span class="tool-detail"></span></span><span class="tool-status">'+icon(eq?'check':owned?'kit':'lock')+'<span class="sr">'+(eq?'Equipped':owned?'Available':'Locked')+'</span></span>';
    b.querySelector('.tool-name').textContent=item.name;b.querySelector('.tool-detail').textContent=restricted?'Restricted this shift':owned?item.type:'Unlock at '+item.xp+' XP';
    $('tools').append(b);illustrate(b.querySelector('canvas'),item.art);
    b.onclick=()=>{cancel();profile.tool=item.id;save();renderUI();cue(item.name+' equipped. '+rest());expansion?.toolEquipped(item.id);};
  }
  syncControls();refreshMarkers();expansion?.sync();clinic?.sync();world?.sync();spa?.sync();schedule();
}
function loadField(){
  cancel();visit=visitFor(profile);field=makeField(visit);
  const equipped=content.get('equipment',profile.tool),family=visit.mode.id.split(':')[0];
  // The World Book archives the whole kit; other modes keep their own scope and XP unlocks.
  const archive=visit.mode.id.startsWith('world-book-of-pores:')||visit.mode.id.startsWith('disgusting-day-spa:');
  const equippedScope=[].concat(equipped.scope||[]);
  if((equippedScope.length&&!equippedScope.includes(family)) || (!visit.zen&&!archive&&equipped.xp>profile.xp))profile.tool='base:loop';
  expansion?.decorate(field,visit);
  const patient=visit.encounter.patient?content.get('patients',visit.encounter.patient):null;
  world?.startSession({namespace:visit.mode.id.split(':')[0],encounter:visit.encounter.id,seed:visit.seed,
    klass:patient?.klass||null,region:visit.region.id,mode:visit.mode.id,turn:run().turn});
  active=field.find(l=>!run().cleared.includes(l.id))?.id??0;
  started=source=burst=null;zoom=1;force=velocity=dx=dy=0;
  draw.region(content.get('assets',visit.region.image).url).catch(()=>say('Region photo unavailable. Using the last loaded skin field.'));
  renderUI();cue(complete()?'Field cleared. Your case report is ready.':rest());
}
function start(button,e){
  if(profile.settings.sound){audio.start(tool.technique);play('touch');}
  source={button,x:e.clientX,y:e.clientY};dx=dy=0;inside=false;started=lastStamp=performance.now();
  syncControls();cue(visit.zen?'Release at your own pace.':profile.settings.toggle?'Press again when the indicator reaches green.':'Release when the indicator reaches green.');schedule();
}
function move(e){
  if(!source||!Number.isFinite(source.x))return;
  dx=Math.max(-1,Math.min(1,(e.clientX-source.x)/35));dy=Math.max(-1,Math.min(1,(e.clientY-source.y)/35));schedule();
}
function cancel(){
  if(started===null)return;
  started=source=null;inside=false;audio.stop();syncControls();cue(rest());schedule();
}
function release(){
  if(started===null)return;
  const now=performance.now(),elapsed=Math.max(0,now-started)/1000,l=current(),pass=layer();
  const value=pressure(elapsed,l,tool,pass),zone=band(elapsed,l,tool,pass),result=assess(value,zone);
  const focusMarker=source.button.classList.contains('marker');
  started=source=null;audio.stop();inside=false;syncControls();
  if(!result.success && !visit.zen){
    if(run().streak){run().streak=0;save();}
    cue(value<zone.center?'A little early. Release when the band lights up.':'Too much pressure. Try the next pass through green.');play('miss');schedule();return;
  }
  // A reservoir target hands its release to the expansion; base targets are unchanged.
  const deep=expansion?.active()?expansion.flow({profile,visit,run:run(),target:l,tool,value,perfect:result.perfect,dx,dy}):null;
  if(deep?.refused || deep?.blocked){cue(deep.message);play(deep.cue||'miss');schedule();return;}
  play(deep?.cue||'release',l.phase,deep?.pan||0);buzz(l.boss?38:20);
  if(tool.audio && profile.settings.sound)audio.asset(content.get('assets',tool.audio).url);
  if(deep?.diagnostic){save();renderUI();cue(deep.message);schedule();return;}
  // The vortex can advance two flow units in one release; reward() still commits one layer.
  if(deep?.steps)run().layers[l.id]=(run().layers[l.id]||0)+deep.steps-1;
  burst=deep?.burst||eject(l,value,dx,dy,pass,tool);
  if(profile.settings.reducedMotion){stepMaterial(burst,.08);burst.life=.22;}
  lastStamp=now;
  const before=availableUpgrades(profile).length,prize=reward(profile,visit,l,result.perfect);
  if(!prize.partial){active=field.find(x=>!run().cleared.includes(x.id))?.id??active;force=velocity=0;zoom=1;}
  save();renderUI();
  if(focusMarker)(complete()?$('review'):$('markers').querySelector('.current'))?.focus({preventScroll:true});
  const line=deep?.message||(prize.partial?'Seal released. '+visit.boss.hint:visit.zen?'Clean release.':(result.perfect?'Perfect release':'Clean extraction')+' · +'+prize.points+' points · +'+prize.xp+' XP.');
  const upgrades=availableUpgrades(profile),earned=[...(deep?.earned||[]),...prize.earned];
  cue((complete()?'Field cleared! ':'')+line+(upgrades.length>before?' '+upgrades.at(-1).name+' fitted.':'')+(earned.length?' Achievement: '+earned[0].name+'.':''));
  if(complete()){play('win');world?.completeEncounter({points:run().points,perfect:result.perfect});spa?.completeAppointment?.();}
}
bindAction($('extract'),()=>{});
window.addEventListener('blur',cancel);
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
$('review').onclick=report;
for(const [id,step] of [['zoomIn',.5],['zoomOut',-.5]])$(id).onclick=()=>{cancel();zoom=Math.max(1,Math.min(2,zoom+step));refreshMarkers();syncControls();schedule();};
$('soundBtn').onclick=()=>{cancel();profile.settings.sound=!profile.settings.sound;if(profile.settings.sound){audio.wake();play('touch');}save();renderUI();};
// Dialogs render text from the first-party content catalog as plain text.
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function modal(title,html,actions=[],label='WORKSTATION'){
  cancel();
  const body=$('dialogBody');
  body.innerHTML='<small>'+escape(label)+'</small><h2 id="dialogTitle">'+escape(title)+'</h2>'+html;
  dialog.setAttribute('aria-labelledby','dialogTitle');
  const bar=document.createElement('div');bar.className='dialog-actions';
  for(const [name,fn,secondary] of actions){
    const b=document.createElement('button');b.className=secondary?'secondary':'primary';b.textContent=name;b.onclick=fn;bar.append(b);
  }
  if(actions.length)body.append(bar);
  if(!dialog.open)dialog.showModal();
}
const close=()=>dialog.close();
$('dismiss').onclick=close;
dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}};
$('workstation').onclick=()=>{if(dialog.open)close();$('viewTitle').scrollIntoView({block:'nearest'});};
$('pauseBtn').onclick=()=>modal('Shift paused','<p>Your field is waiting exactly where you left it.</p>',[['Resume shift',close]]);
$('manualBtn').onclick=()=>modal('Field manual','<h3>Choose a target</h3><p>Hold a numbered marker or the extraction button. Space and Enter work too. Drag during contact to lean the instrument and steer the release.</p><h3>Catch the signal</h3><p>Release inside the striped band. The center earns a precision bonus. The loop rolls steadily, the tip builds in pulses, and the vacuum accelerates. Audio settings include an audible in-band cue, slower timing, and two-press control.</p><h3>Work the shift</h3><p>Clear the smaller targets to expose the boss. Watch its case brief for the special release pattern. Clean streaks build score. XP unlocks instruments and automatically fits grip and servo upgrades.</p><p>Fictional arcade mechanics. Never attempt on real skin.</p>',[['Back to work',close]],'OPERATOR REFERENCE');
function modes(){
  modal('Choose a shift','<p>Each mode keeps its own field. You can switch back at any time.</p>',[],'GAMEPLAY MODES');
  const list=content.list('modes');
  for(const m of list){
    const b=document.createElement('button');b.className='mode-option';b.setAttribute('aria-pressed',profile.mode===m.id);
    b.innerHTML='<strong>'+escape(m.name)+'</strong><span>'+escape(m.description)+'</span>';
    b.onclick=()=>{switchMode(profile,m.id);loadField();save();close();};
    $('dialogBody').append(b);
  }
  // The expansion is offered here even before it has been loaded; the base modes stay first.
  if(!list.some(m=>m.id.startsWith('pore-explorer:'))){
    const b=document.createElement('button');b.className='mode-option deep-option';
    b.innerHTML='<strong>The Pore Explorer</strong><span>Expansion 1 · subsurface imaging, reservoir networks and three buried bosses. Download on demand.</span>';
    b.onclick=async()=>{try{await ensureExpansion();expansion.openPanel();}catch(e){say(e.message||'Expansion unavailable.');}};
    $('dialogBody').append(b);
  }
}
$('modeBtn').onclick=modes;
function files(){
  const campaignVisit=visitFor({...profile,mode:'base:campaign'}),v=campaignVisit;
  const rows=v.route.map(({chapter,chapterIndex,encounter},i)=>{
    const status=i<v.index || i===v.index&&v.run.cleared.length===encounter.count?'CLEARED':i===v.index?'IN PROGRESS':'LOCKED';
    return (chapter.encounters[0]===encounter.id?'<div class="chapter-row">CH. '+pad(chapterIndex+1)+' / '+escape(chapter.name.toUpperCase())+'</div>':'')+
      '<div class="file-row '+(i===v.index?'current':'')+'"><span>'+pad(i+1)+'</span><strong>'+escape(encounter.boss?content.get('bosses',encounter.boss).name:encounter.name)+'</strong><small>'+status+'</small></div>';
  }).join('');
  const achievements=content.list('achievements').map(a=>'<p class="'+(profile.achievements.includes(a.id)?'achievement':'')+'">'+(profile.achievements.includes(a.id)?'✓ ':'○ ')+escape(a.name)+' · '+Math.min(profile.stats[a.stat]||0,a.threshold)+'/'+a.threshold+'</p>').join('');
  const upgrades=content.list('upgrades').map(u=>'<p>'+escape(u.name)+' · '+(profile.xp>=u.xp?'Fitted':u.xp+' XP')+'</p>').join('');
  modal('Case files','<p>'+rank(profile.xp)+' · '+profile.xp+' XP · '+profile.score+' points · '+profile.stats.total+' scored extractions</p>'+rows+
    '<details><summary>Achievements · '+profile.achievements.length+'</summary><div class="record-grid">'+achievements+'</div></details><details><summary>Equipment upgrades</summary>'+upgrades+'</details>'+(world?.recordsForFiles?.()||'')+(clinic?.recordsForFiles?.()||'')+(spa?.recordsForFiles?.()||''),
    [['Return to shift',close],['Reset game',resetPrompt,true]],'CAMPAIGN RECORD');
}
$('filesBtn').onclick=files;
function resetPrompt(){
  modal('Reset all shifts?','<p>This clears the three saved fields, previous checkpoint, achievements, XP, and equipment unlocks on this device.</p>',[['Keep progress',files],['Reset all shifts',()=>{
    const {revision,settings,checkpointId}=profile;
    profile={...fresh(),revision,settings,checkpointId};save(true);loadField();expansion?.reset();clinic?.reset();world?.reset();spa?.reset();close();
  },true]]);
}
function settings(){
  const prefs=profile.settings;
  const checks=[['sound','Sound effects and timing cue'],['haptics','Vibration on supported devices'],['assist','Slower pressure and wider release band'],
    ['toggle','Press twice instead of holding'],['contrast','High-contrast controls'],['reducedMotion','Reduced extraction motion']];
  modal('Operator settings','<div class="prefs"><label>Volume <input id="volume" type="range" min="0" max="100" step="5" value="'+Math.round(prefs.volume*100)+'"><output id="volLabel">'+Math.round(prefs.volume*100)+'%</output></label>'+
    checks.map(([k,label])=>'<label>'+label+'<input type="checkbox" data-pref="'+k+'" '+(prefs[k]?'checked':'')+'></label>').join('')+'</div>'+(world?.settingsHTML?.()||'')+(clinic?.settingsHTML?.()||'')+(spa?.settingsHTML?.()||''),
    [['Done',()=>{close();cue(rest());}]],'AUDIO & ACCESSIBILITY');
  $('volume').oninput=e=>{prefs.volume=e.target.value/100;audio.volume(prefs.volume);$('volLabel').textContent=e.target.value+'%';};
  world?.bindSettings?.();clinic?.bindSettings?.();spa?.bindSettings?.();
  $('volume').onchange=()=>{save();if(prefs.sound){audio.wake();play('zone');}};
  for(const input of $('dialogBody').querySelectorAll('[data-pref]'))input.onchange=()=>{
    prefs[input.dataset.pref]=input.checked;save();renderUI();if(prefs.sound){audio.wake();play('touch');}
  };
}
$('settingsBtn').onclick=settings;
function report(){
  const last=visit.mode.strategy==='campaign' && visit.index===visit.route.length-1;
  const next=visit.mode.strategy==='campaign'?'Begin next case':'Next patient';
  const expanded=expansion?.report(visit)||null;
  const title=expanded?.title||(last?'Campaign complete':visit.boss?'Boss shift cleared':visit.zen?'Patient complete':'Case cleared');
  modal(title,'<p>'+escape(visit.patient.name)+' · '+field.length+' targets cleared.</p><h3>'+
    (visit.zen?'A quiet moment.':run().points+' points · '+profile.xp+' career XP')+'</h3><p>'+
    (expanded?.flavor||(last?'Four chapters down. Dani is officially off the clock.':visit.zen?'Take another shift whenever you feel like it.':'Your next patient is ready for inspection.'))+'</p>',
    last?[['View campaign',files],['Choose another mode',modes,true]]:[[next,()=>{if(advance(visit)){save();loadField();}close();}]],'EXTRACTION REPORT');
}
new ResizeObserver(schedule).observe($('stage'));
$('stage').addEventListener('redraw',schedule);
// Keep both registrations file-scoped on the shared Junkdrawer origin.
async function installOffline(){
  const canonical=new URL('./dani-the-pimple-popper.html',location.href);
  const legacy=new URL('./danny-the-pimple-popper.html',location.href);
  const workers=navigator.serviceWorker;
  const viaLegacy=location.pathname===legacy.pathname;
  const adoptCanonical=()=>history.replaceState(history.state,'',canonical.pathname+location.search+location.hash);
  const registration=await workers.register('./danny-sw.js',{scope:canonical.pathname});
  if(viaLegacy){
    // Wait for the canonical offline shell before changing an installed player's address.
    const worker=registration.active||registration.installing||registration.waiting;
    if(worker){
      const adoptWhenReady=()=>{
        if(worker.state==='activated'){worker.removeEventListener('statechange',adoptWhenReady);adoptCanonical();}
        if(worker.state==='redundant')worker.removeEventListener('statechange',adoptWhenReady);
      };
      worker.addEventListener('statechange',adoptWhenReady);adoptWhenReady();
    }
  }
  await workers.register('./danny-sw.js',{scope:legacy.pathname});
}
// Shared API handed to every first-party expansion. The engine reads the active mode itself, so the
// same deep game serves the Pore Explorer and the Midnight Clinic.
function expansionApi(){
  return {profile:()=>profile, visit:()=>visit, run:()=>run(), field:()=>field, active:()=>active, tool:()=>tool,
    getPaint:()=>draw, paint:()=>{if(ready)draw(view());}, cue, play, save, modal, close,
    selectMode, replayEncounter, audio, packs:['pore-explorer','midnight-clinic']};
}
// Selectable campaign entry. The pack, module and plates download here, not at startup.
async function ensureExpansion(){
  if(expansion && content.versions()['pore-explorer'])return expansion;
  expansionLoading??=(async()=>{
    await content.load('./pore-explorer/pack.json');
    const mod=await import('./pore-explorer/expansion.js');
    mod.attach(expansionApi());
    expansion=mod;mod.mount();
    // Fill the expansion runtime cache once a worker controls this page. On a first visit the
    // assets were fetched before activation, so this is the moment they can be stored.
    if('serviceWorker' in navigator){
      const prime=()=>expansion?.primeOffline?.();
      if(navigator.serviceWorker.controller)prime();
      else navigator.serviceWorker.addEventListener('controllerchange',prime,{once:true});
    }
    return mod;
  })();
  try{return await expansionLoading;}catch(e){expansionLoading=null;throw e;}
}
function selectMode(id){
  switchMode(profile,id);loadField();save();
}
// Replaying an encountered case resets only that case, never the campaign checkpoint.
function replayEncounter(modeId,encounterId,seed){
  switchMode(profile,modeId);
  const slot=profile.slots[modeId];
  Object.assign(slot,{encounter:encounterId,seed,cleared:[],layers:{},deep:{},streak:0,points:0});
  save();loadField();
}
async function ensureWorld(){
  if(world && content.versions()['world-book-of-pores'])return world;
  worldLoading??=(async()=>{
    // Legendary content references every installed campaign, so register those packs first.
    await content.load('./pore-explorer/pack.json');
    await content.load('./midnight-clinic/pack.json');
    await content.load('./world-book/pack.json');
    const mod=await import('./world-book/expansion.js');
    mod.attach(expansionApi());
    expansion??=await import('./pore-explorer/expansion.js');
    expansion.mount();mod.mount();
    world=mod;
    if('serviceWorker' in navigator){
      const prime=()=>world?.primeOffline?.();
      if(navigator.serviceWorker.controller)prime();
      else navigator.serviceWorker.addEventListener('controllerchange',prime,{once:true});
    }
    return mod;
  })();
  try{return await worldLoading;}catch(e){worldLoading=null;throw e;}
}
async function ensureSpa(){
  if(spa && content.versions()['disgusting-day-spa'])return spa;
  spaLoading??=(async()=>{
    await ensureWorld();
    await content.load('./day-spa/pack.json');
    const mod=await import('./day-spa/expansion.js');
    mod.attach(expansionApi());
    expansion??=await import('./pore-explorer/expansion.js');
    expansion.mount();mod.mount();
    spa=mod;
    if('serviceWorker' in navigator){
      const prime=()=>spa?.primeOffline?.();
      if(navigator.serviceWorker.controller)prime();
      else navigator.serviceWorker.addEventListener('controllerchange',prime,{once:true});
    }
    return mod;
  })();
  try{return await spaLoading;}catch(e){spaLoading=null;throw e;}
}
$('spaBtn').onclick=async()=>{
  try{await ensureSpa();spa.open();}
  catch(e){
    say(e.message||'The Day Spa could not be opened.');
    modal('The Day Spa is unavailable','<p>The management module could not be downloaded on this visit. Existing campaigns, records and business state are unaffected. Reconnect, then open it again.</p>',[['Return to shift',close]],'EXPANSION 5');
  }
};
$('bookBtn').onclick=async()=>{
  try{await ensureWorld();world.open();}
  catch(e){
    say(e.message||'The World Book could not be opened.');
    modal('The World Book is unavailable','<p>The first-party expansion could not be downloaded on this visit. Existing campaigns and records are unaffected. Reconnect, then open it again.</p>',[['Return to shift',close]],'EXPANSION 4');
  }
};
async function ensureClinic(){
  if(clinic && content.versions()['midnight-clinic'])return clinic;
  clinicLoading??=(async()=>{
    // The clinic shares the deep engine and the PoreScope, so both first-party packs load here.
    await content.load('./pore-explorer/pack.json');
    await content.load('./midnight-clinic/pack.json');
    const mod=await import('./midnight-clinic/expansion.js');
    mod.attach(expansionApi());
    // The clinic imports the shared engine, which attaches on import; keep one reference for game calls.
    expansion??=await import('./pore-explorer/expansion.js');
    expansion.mount();mod.mount();
    clinic=mod;
    if('serviceWorker' in navigator){
      const prime=()=>clinic?.primeOffline?.();
      if(navigator.serviceWorker.controller)prime();
      else navigator.serviceWorker.addEventListener('controllerchange',prime,{once:true});
    }
    return mod;
  })();
  try{return await clinicLoading;}catch(e){clinicLoading=null;throw e;}
}
$('clinicBtn').onclick=async()=>{
  try{await ensureClinic();clinic.openPanel();}
  catch(e){
    say(e.message||'The clinic could not be opened.');
    modal('The Midnight Clinic is dark','<p>The first-party expansion could not be downloaded on this visit. Nothing in the base campaign or The Pore Explorer has changed. Reconnect, then open it again.</p>',[['Return to shift',close]],'EXPANSION 3');
  }
};
$('poreBtn').onclick=async()=>{
  try{await ensureExpansion();expansion.openPanel();}
  catch(e){
    say(e.message||'The expansion could not be loaded.');
    modal('The Pore Explorer is unavailable','<p>The first-party expansion could not be downloaded on this visit. The base campaign and its checkpoints are unaffected. Reconnect, then open it again.</p>',[['Return to shift',close]],'EXPANSION');
  }
};
async function init(){
  document.querySelector('main').inert=true;document.querySelector('header').inert=true;
  try{
    await baseReady;
    let recovery=false;
    try{
      database=await openCampaign();
      const {state,recovered}=await database.read();
      await restoreContent(state);
      profile=migrate(state);visit=visitFor(profile);content.get('equipment',profile.tool);
      // A checkpoint inside the expansion needs its module before the first field is built.
      if(String(profile.mode).startsWith('pore-explorer:'))await ensureExpansion();
      if(String(profile.mode).startsWith('midnight-clinic:'))await ensureClinic();
      if(String(profile.mode).startsWith('world-book-of-pores:'))await ensureWorld();
      if(String(profile.mode).startsWith('disgusting-day-spa:'))await ensureSpa();
      recovery=recovered||!!state&&!state.schema;
      if(recovered)say('Recovered your previous checkpoint.');
    }catch(e){
      database=null;profile=fresh();say((e.message||'Local saves unavailable.')+' Playing a temporary session.');
    }
    visit=visitFor(profile);
    draw=await createRenderer($('stage'),$('skin'),$('effects'),content.get('assets',visit.region.image).url);
    expansion?.mount();clinic?.mount();world?.mount();spa?.mount();
    ready=true;loadField();if(recovery)save();
    // Read-only inspection surface for the automated suites and production smoke checks.
    // It exposes snapshots only: no writes, no content control, no network access.
    window.daniInspect=Object.freeze({
      profile:()=>structuredClone(profile),
      session:()=>({mode:visit.mode.id,encounter:visit.encounter.id,index:visit.index,seed:visit.seed}),
      run:()=>structuredClone(run()),
      field:()=>field.map(l=>({id:l.id,name:l.name,boss:l.boss,layers:l.layers,passes:run().layers[l.id]||0,
        cleared:run().cleared.includes(l.id),
        pattern:l.deep?.graph?.pattern||null,nodes:l.deep?.graph?.nodes.length||0,
        remaining:l.deep?.state?.remaining??null,found:l.deep?.state?.found??null,complete:l.deep?.state?.complete??null})),
      scope:()=>{const s=expansion?.overlayContext?.();return s?{mode:s.mode,shown:s.shown,found:s.state.found,remaining:s.state.remaining,
        pattern:s.graph.pattern,edges:s.graph.edges.length,hidden:s.graph.hidden,
        nodes:s.graph.nodes.map(n=>{const live=s.state.nodes.find(item=>item.key===n.key);return {key:n.key,x:n.x,y:n.y,depth:n.depth,
          volume:n.volume,remaining:live.remaining,hidden:n.hidden,revealed:live.revealed,exposed:live.exposed,
          phased:!!n.phased,phaseOffset:n.phaseOffset,dormant:!!n.dormant,active:live.active};}),
        tick:s.state.tick,phaseClosed:s.state.phaseClosed,dormant:s.state.dormant,pending:s.state.pending,
        scan:{c:s.scan.c,d:s.scan.d},gates:s.state.gates.map(g=>({type:g.type,broken:g.broken})),held:s.state.held}:null;},
      bursts:()=>burst?(burst.streams||[burst]).map(stream=>({color:stream.mat.color,particles:stream.particles.length})):[],
      totals:()=>({xp:profile.xp,stats:structuredClone(profile.stats),achievements:[...profile.achievements]}),
      world:()=>world?.snapshotForTests?.()||null,
      spa:()=>spa?.snapshotForTests?.()||null
    });
    document.querySelector('main').inert=false;document.querySelector('header').inert=false;$('feedStatus').textContent='Optics online';
  }catch(e){$('feedStatus').textContent='Optics unavailable';cue('Could not load game assets. Reload to retry.');console.error(e);}
  if('serviceWorker' in navigator){
    try{await installOffline();}
    catch{
      const legacyLaunch=location.pathname.endsWith('/danny-the-pimple-popper.html') && navigator.serviceWorker.controller;
      const notice=legacyLaunch?'Reopen online to finish updating the offline launch address.':'Offline installation could not finish.';
      say([$('saveStatus').textContent,notice].filter(Boolean).join(' '));
    }
  }
}
init();
