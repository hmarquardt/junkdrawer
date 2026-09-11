const {test,expect}=require('@playwright/test');
const fs=require('fs'), path=require('path'),os=require('os');
test.use({channel:'chrome'});
const fixture=process.env.BERRY_CLONE_PRODUCTION_FIXTURE||path.join(os.homedir(),'Downloads','Website comparison - 0007.mhtml');
async function open(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));await page.goto(`file://${path.resolve('ui-berry-3r-visual-evaluator.html')}`);return errors}
async function load(page,file){await page.locator('#archiveFile').setInputFiles(file);await expect(page.locator('#notice')).toContainText('Archive visual reconstruction complete',{timeout:60000})}

test('real production archive: semantic identity, reference, zero behavior and reconstructed PNGs',async({page})=>{
 test.skip(!fs.existsSync(fixture),'Private production fixture unavailable');test.setTimeout(90000);const errors=await open(page);await load(page,fixture);
 const result=await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,t=T.state.task;return{taskId:t.taskId,title:t.displayTitle,metadata:T.buildDebugReport().task.metadata,refs:t.referenceImages.map(i=>({width:i.width,height:i.height,hash:i.hash})),candidates:Object.fromEntries(['A','B'].map(k=>{const c=t.candidates[k];return[k,{url:c.url,association:c.association,html:c.snapshotHtml.length,resources:c.resourceMap.byContentLocation.size,images:c.images.map(i=>({width:i.width,height:i.height,source:i.source,size:i.blob.size})),viewport:c.viewport,reconstruction:c.reconstruction,behavior:c.behaviorEvidence,captured:c.capturedStates,render:c.renderStatus}]}))}});
 console.log(JSON.stringify(result,null,2));
 expect(result.taskId).toBe('d7c28f26-a8dd-4282-9a21-74ccab643378');expect(result.title).toBe('Website comparison - 0007');expect(result.metadata.displayId).toBe('0007');expect(result.metadata.referenceCopies).toBe(3);expect(result.refs).toEqual([{width:960,height:600,hash:'125b942e9cf689696811a720d45eda6d67b6ee0901dd677ce1ade60548977b06'}]);
 expect(result.candidates.A.url).toBe('https://pf26zl5r4wvmnvy.c.msft.feather-prod.azure.com/');expect(result.candidates.B.url).toBe('https://mpbaooer2z3jat6.c.msft.feather-prod.azure.com/');
 for(const k of ['A','B']){const c=result.candidates[k];expect(c.images).toHaveLength(1);expect(c.images[0]).toMatchObject({width:960,height:600,source:'mhtml:reconstructed'});expect(c.images[0].size).toBeGreaterThan(10000);expect(c.viewport).toEqual({width:960,height:600,source:'reference-derived'});expect(c.behavior).toEqual([]);expect(c.render).toBe('unknown');expect(c.captured).toEqual({status:'empty',count:0});expect(c.html).toBeGreaterThan(9000)}
 for(const k of ['R','A','B']){const encoded=await page.evaluate(async k=>{const t=__BERRY3VISUAL_TEST__.state.task,i=k==='R'?t.referenceImages[0]:t.candidates[k].images[0];return new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(i.blob)})},k);fs.writeFileSync('/private/tmp/berry-production-'+k+'.png',Buffer.from(encoded,'base64'))}
 await page.locator('#visualPanel').screenshot({path:'/private/tmp/berry-production-workspace.png'});expect(errors).toEqual([]);
});
const sanitized=path.resolve('tests/fixtures/berry-visual/clone-sanitized.mhtml');
async function parse(page,raw){return page.evaluate(async raw=>{const t=await __BERRY3VISUAL_TEST__.parseCloneTaskArchive(raw);return{taskId:t.taskId,display:t.displayTitle,metadata:__BERRY3VISUAL_TEST__.buildDebugReport().task.metadata,ref:t.referenceImages.map(i=>({hash:i.hash,width:i.width,height:i.height})),copies:t.metadata.referenceCopies,candidates:Object.fromEntries(['A','B'].map(k=>[k,{url:t.candidates[k].url,css:[...t.candidates[k].resourceMap.byContentLocation.keys()],snapshot:t.candidates[k].snapshotHtml,association:t.candidates[k].association,captured:t.candidates[k].capturedStates,images:t.candidates[k].images.map(i=>({source:i.source,sequence:i.sequence})),behavior:t.candidates[k].behaviorEvidence}]))}},raw)}
// The shell is quoted-printable, so mutate the decoded part text and rebuild the MIME rather than string-replacing the wrapped source.
async function mutateShell(page,raw,mutation){return page.evaluate(async({raw,mutation})=>{const T=__BERRY3VISUAL_TEST__,a=T.parseMhtml(raw),shell=a.parts.find(p=>p.contentId==='shell@fixture');const mutations={swapLabels:html=>html.replace(/Website A/g,'TEMP WEBSITE').replace(/Website B/g,'Website A').replace(/TEMP WEBSITE/g,'Website B').replace(/panel-a/g,'different-opaque-id'),duplicateATab:html=>html.replace(/Website B/g,'Website A'),sameFrame:html=>html.replace(/cid:frame-b@fixture/g,'cid:frame-a@fixture'),wrongSchema:html=>html.replace(/root_reference_fidelity_preference/g,'root_aesthetics_preference')};shell.text=mutations[mutation](shell.text);const b='mutation-boundary';return 'Snapshot-Content-Location: '+a.headers.snapshotContentLocation+'\r\nContent-Type: multipart/related; boundary="'+b+'"\r\n\r\n'+a.parts.map(p=>'--'+b+'\r\nContent-Type: '+p.contentType+'\r\nContent-ID: <'+p.contentId+'>\r\nContent-Location: '+p.contentLocation+'\r\n\r\n'+p.text+'\r\n').join('')+'--'+b+'--\r\n'},{raw,mutation})}

test('sanitized fixture preserves schema, duplicate references, CID CSS, and identity despite B-first MIME order',async({page})=>{
 const errors=await open(page);await load(page,sanitized);
 const t=await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state.task;return{type:s.taskType,id:s.taskId,display:s.metadata.displayId,metadata:s.metadata,ref:s.referenceImages.map(i=>({hash:i.hash,width:i.width,height:i.height})),candidates:Object.fromEntries(['A','B'].map(k=>[k,{css:[...s.candidates[k].resourceMap.byContentLocation.keys()],source:s.candidates[k].snapshotHtml,url:s.candidates[k].url,images:s.candidates[k].images.map(i=>({source:i.source,mimeType:i.mimeType,width:i.width,height:i.height})),behavior:s.candidates[k].behaviorEvidence}]))}});
 expect(t.type).toBe('clone');expect(t.id).toBe('d7c28f26-a8dd-4282-9a21-74ccab643378');expect(t.display).toBe('0007');expect(t.metadata.scoringSchema.keys).toEqual(['functionality','reference_fidelity','overall']);expect(t.metadata.scoringSchema.rationaleFields).toEqual(['functionality_scoring_reason','reference_fidelity_scoring_reason','overall_scoring_reason']);expect(t.metadata.referenceCopies).toBe(3);expect(t.ref).toHaveLength(1);expect(t.ref[0]).toMatchObject({width:960,height:600});expect(t.ref[0].hash).toMatch(/^[a-f0-9]{64}$/);
 expect(t.candidates.A.css).toContain('cid:style-a@fixture');expect(t.candidates.B.css).toContain('cid:style-b@fixture');expect(t.candidates.A.source).toContain('Saved candidate A');expect(t.candidates.B.source).toContain('Saved candidate B');expect(t.candidates.A.url).toContain('pf26zl5r4wvmnvy');expect(t.candidates.B.url).toContain('mpbaooer2z3jat6');
 for(const k of ['A','B']){expect(t.candidates[k].behavior).toEqual([]);expect(t.candidates[k].images[0]).toMatchObject({source:'mhtml:reconstructed',mimeType:'image/png',width:960,height:600})}expect(errors).toEqual([]);
});

test('identity follows tab labels across MIME/frame reordering and changing opaque DOM IDs',async({page})=>{
 await open(page);const raw=fs.readFileSync(sanitized,'utf8');const swapped=await mutateShell(page,raw,'swapLabels');const t=await parse(page,swapped);expect(t.candidates.A.url).toContain('mpbaooer2z3jat6');expect(t.candidates.B.url).toContain('pf26zl5r4wvmnvy');
});

test('candidate identity ambiguity and inconsistent schema fail rather than guessing',async({page})=>{
 await open(page);const raw=fs.readFileSync(sanitized,'utf8');for(const mutation of ['duplicateATab','sameFrame','wrongSchema']){
 const bad=await mutateShell(page,raw,mutation);
 const result=await page.evaluate(async raw=>{try{await __BERRY3VISUAL_TEST__.parseCloneTaskArchive(raw);return 'UNEXPECTED SUCCESS'}catch(e){return e.message}},bad);expect(result).toMatch(/ambiguity|WRONG TASK TYPE/);
 }
});

test('different target references are retained as explicit alternatives with warning',async({page})=>{
 await open(page);const raw=fs.readFileSync(sanitized,'utf8');const alt=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=200;c.getContext('2d').fillRect(0,0,320,200);return c.toDataURL()});
 // Decode and re-encode MIME instead of modifying wrapped quoted-printable image bytes.
 const result=await page.evaluate(async({raw,alt})=>{const T=__BERRY3VISUAL_TEST__,a=T.parseMhtml(raw),shell=a.parts.find(p=>p.contentId==='shell@fixture');shell.text=shell.text.replace(/src="data:image\/png;base64,[^"]+"/,`src="${alt}"`);const boundary='new-ref-test';const m='Snapshot-Content-Location: '+a.headers.snapshotContentLocation+'\r\nContent-Type: multipart/related; boundary="'+boundary+'"\r\n\r\n'+a.parts.map(p=>'--'+boundary+'\r\nContent-Type: '+p.contentType+'\r\nContent-ID: <'+p.contentId+'>\r\nContent-Location: '+p.contentLocation+'\r\n\r\n'+p.text+'\r\n').join('')+'--'+boundary+'--\r\n';const t=await T.parseCloneTaskArchive(m);return{refs:t.referenceImages.length,alternatives:t.metadata.referenceAlternatives.length,hashes:t.metadata.referenceHashes,warnings:t.metadata.warnings}}, {raw,alt});expect(result.refs).toBe(1);expect(result.alternatives).toBe(1);expect(new Set(result.hashes).size).toBe(2);expect(result.warnings.join(' ')).toContain('non-identical');
});

test('future platform captures stay semantically scoped, ordered and preferred over reconstruction',async({page})=>{
 await open(page);const raw=fs.readFileSync(sanitized,'utf8');await page.evaluate(async raw=>{
 const T=__BERRY3VISUAL_TEST__,a=T.parseMhtml(raw),shell=a.parts.find(p=>p.contentId==='shell@fixture');const d=new DOMParser().parseFromString(shell.text,'text/html'),src=d.querySelector('img').src,panel=d.getElementById('panel-a'),empty=[...panel.querySelectorAll('div')].find(e=>e.textContent==='No outputs captured yet');empty.innerHTML=`<img alt="Above fold actual" src="${src}"><img alt="Lower actual" src="${src}">`;shell.text=d.documentElement.outerHTML;const b='capture-test';const m='Snapshot-Content-Location: '+a.headers.snapshotContentLocation+'\r\nContent-Type: multipart/related; boundary="'+b+'"\r\n\r\n'+a.parts.map(p=>'--'+b+'\r\nContent-Type: '+p.contentType+'\r\nContent-ID: <'+p.contentId+'>\r\nContent-Location: '+p.contentLocation+'\r\n\r\n'+p.text+'\r\n').join('')+'--'+b+'--\r\n';await T.loadArchive(m)},raw);
 const out=await page.evaluate(()=>{const s=__BERRY3VISUAL_TEST__.state;return{A:s.task.candidates.A.images.map(i=>({source:i.source,label:i.label,sequence:i.sequence})),B:s.task.candidates.B.images.map(i=>i.source),selected:s.selected.A,behavior:s.task.candidates.A.behaviorEvidence}});expect(out.A.map(i=>i.source)).toEqual(['platform-captured','platform-captured','mhtml:reconstructed']);expect(out.A.slice(0,2).map(i=>i.sequence)).toEqual([0,1]);expect(out.B).toEqual(['mhtml:reconstructed']);expect(out.selected).toBe(0);expect(out.behavior).toEqual([]);
});

test('resource graph rewrites nested CSS, images, fonts and SVG; missing assets are diagnosed and never fetched',async({page})=>{
 const errors=await open(page);const external=[];page.on('request',r=>{if(r.url().startsWith('https://missing.example'))external.push(r.url())});
 const out=await page.evaluate(async()=>{const T=__BERRY3VISUAL_TEST__,te=new TextEncoder();const parts=[{contentId:'<child-css>',contentLocation:'https://assets.example/child.css',contentType:'text/css',text:'.tile{background:url(pic.png)}',bytes:te.encode('.tile{}'),size:20},{contentId:'picture',contentLocation:'https://assets.example/pic.png',contentType:'image/png',bytes:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),size:68}];const graph=T.resourceGraph({parts});const c={snapshotHtml:'<html><head><style>@import url("cid:child-css");@font-face{font-family:Missing;src:url(https://missing.example/font.woff2)}.x{background:url(https://missing.example/a.png)}</style></head><body><img src="cid:picture"><img src="https://missing.example/missing.png"><div class="tile">Hello</div><script>parent.__unsafe=true;<\/script></body></html>',snapshotBase:'https://assets.example/index.html',resourceMap:{byContentId:new Map(),byContentLocation:new Map()},reconstruction:{resolved:[],unresolved:[],warnings:[]}};const html=await T.prepareSnapshot(c,graph);return{html,diag:c.reconstruction,cid:graph.resolve('cid:<picture>')===parts[1],relative:graph.resolve('pic.png','https://assets.example/child.css')===parts[1]} });expect(out.cid).toBe(true);expect(out.relative).toBe(true);expect(out.html).toContain('data:image/png;base64,');expect(out.html).not.toContain('parent.__unsafe');expect(out.diag.unresolved.map(i=>i.kind)).toEqual(expect.arrayContaining(['font','css-image','image']));expect(out.diag.quality).toBe('compromised');expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('viewport override and additional full page retain manual and reference-sized captures',async({page})=>{
 const errors=await open(page);await load(page,sanitized);await page.evaluate(async()=>{const T=__BERRY3VISUAL_TEST__;await T.addImage('A',T.state.task.referenceImages[0].blob,'Manual capture');await T.reconstructCandidates({fullPage:true})});
 let out=await page.evaluate(()=>__BERRY3VISUAL_TEST__.state.task.candidates.A.images.map(i=>({source:i.source,label:i.label,width:i.width,height:i.height})));expect(out.find(i=>i.label==='Reference viewport · reconstructed').height).toBe(600);expect(out.find(i=>i.label==='Full page · reconstructed').height).toBeGreaterThan(600);expect(out.some(i=>i.label==='Manual capture')).toBe(true);
 await page.locator('#reconstructionPanel summary').click();await page.locator('#viewportWidth').fill('720');await page.locator('#viewportHeight').fill('480');await page.locator('#reconstruct').click();await expect(page.locator('#notice')).toContainText('Archive visual reconstruction complete');expect(await page.evaluate(()=>__BERRY3VISUAL_TEST__.state.task.candidates.A.viewport)).toEqual({width:720,height:480,source:'user-override'});expect(errors).toEqual([]);
});

test('source, account breadcrumbs, raw archive and image payloads never enter history/debug or localStorage',async({page})=>{
 const errors=await open(page);await load(page,sanitized);const result=await page.evaluate(async()=>{const T=__BERRY3VISUAL_TEST__;await T.saveHistory();return{history:await T.historyRows(),debug:T.buildDebugReport(),storage:Object.entries(localStorage)}});const serialized=JSON.stringify(result);expect(serialized).not.toContain('PRIVATE ACCOUNT DO NOT STORE');expect(serialized).not.toContain('snapshotHtml');expect(serialized).not.toContain('preparedHtml');expect(serialized).not.toContain('resourceMap');expect(serialized).not.toContain('data:image');expect(serialized).not.toContain('Saved candidate A');expect(JSON.stringify(result.history)).toContain('d7c28f26-a8dd-4282-9a21-74ccab643378');expect(errors).toEqual([]);
});

test('fidelity-only analysis is available with zero behavioral facts, full synthesis stays gated',async({page})=>{
 const errors=await open(page);await load(page,sanitized);await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state;T.settings.apiKey='test-key';s.models=[{id:T.settings.model,architecture:{input_modalities:['text','image'],output_modalities:['text']}}];window.__visualCalls=[];T.setAiTransport(async(stage,messages)=>{window.__visualCalls.push({stage,messages});if(stage==='visual observation')return{features:[{feature:'Saved panels',location:'Main region',importance:'core',reference:'The reference contains a dark blue rectangular field.',A:'Dark blue background and rectangular panel.',B:'Purple background and rectangular panel.',imageIds:[s.task.referenceImages[0].id,s.task.candidates.A.images[0].id,s.task.candidates.B.images[0].id],confidence:'high'}]};if(stage==='fidelity QA')return{issues:[],referenceFeatures:true,lensIsolation:true,allClaimsEvidenced:true};const reason='Website A is better because the reference image has a dark blue background, which Website A preserves around the main rectangular panel. Website B replaces that large background field with purple, changing a prominent part of the supplied image. The matching background gives Website A the closer visible resemblance despite differences in panel proportions.';return{fidelity:{option:'A is better',reason,claims:reason.split(/(?<=[.])\s+/).map(text=>({text,evidenceIds:s.features.map(f=>f.id)}))}}})});
  await page.locator('#visualOnly').click();await expect(page.locator('#notice')).toContainText('Fidelity analysis complete');await expect(page.locator('[data-final=fidelityReason]')).not.toHaveValue('');await expect(page.locator('[data-final=functionalityReason]')).toHaveValue('');await expect(page.locator('[data-final=overallReason]')).toHaveValue('');const calls=await page.evaluate(()=>window.__visualCalls);expect(calls.map(c=>c.stage)).toEqual(['visual observation','fidelity synthesis','fidelity QA']);expect(calls[0].messages[1].content.filter(p=>p.type==='image_url')).toHaveLength(3);expect(JSON.stringify(calls)).toContain('reconstruction');await page.locator('#generate').click();await expect(page.locator('#notice')).toContainText('Add confirmed behavior observations');await expect(page.locator('[data-final=functionalityReason]')).toHaveValue('');await expect(page.locator('[data-final=overallReason]')).toHaveValue('');expect(errors).toEqual([]);
});

test('future browser observation injection remains separate from snapshot rendering',async({page})=>{
 await open(page);await load(page,sanitized);await page.evaluate(()=>BerryVisual.addBehaviorObservation({candidate:'A',control:'Menu',action:'click',observedResult:'Opened navigation drawer',status:'pass',source:'browser-automation'}));const facts=await page.evaluate(()=>__BERRY3VISUAL_TEST__.retainedBehavior());expect(facts.A).toHaveLength(1);expect(facts.B).toEqual([]);expect(facts.A[0]).toMatchObject({control:'Menu',action:'click',observedResult:'Opened navigation drawer',status:'passed',source:'browser-automation'});
});

async function configureArchiveMock(page){return page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state;T.settings.apiKey='test-key';T.settings.chime=true;s.models=[{id:T.settings.model,name:'Mock Vision',architecture:{input_modalities:['text','image'],output_modalities:['text']}}];window.__calls=[];window.__chimeNotes=0;window.__audioContexts=0;const OrigAC=window.AudioContext;window.AudioContext=function(...a){window.__audioContexts++;return new OrigAC(...a)};window.AudioContext.prototype=OrigAC.prototype;const orig=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){window.__chimeNotes++;return orig.call(this)};const ids=['R','A','B'].map(k=>k==='R'?s.task.referenceImages[0].id:s.task.candidates[k].images[0].id);T.setAiTransport(async(stage,messages)=>{window.__calls.push({stage,messages});if(stage==='visual observation')return{features:[{feature:'Saved panels',location:'Main region',importance:'core',reference:'The reference contains a dark blue rectangular field.',A:'Dark blue background and rectangular panel.',B:'Purple background and rectangular panel.',imageIds:ids,confidence:'high'}]};if(stage==='fidelity QA')return{issues:[],referenceFeatures:true,lensIsolation:true,allClaimsEvidenced:true};const reason='Website A is better because the reference image has a dark blue background, which Website A preserves around the main rectangular panel. Website B replaces that large background field with purple, changing a prominent part of the supplied image. The matching background gives Website A the closer visible resemblance despite differences in panel proportions.';return{fidelity:{option:'A is better',reason,claims:reason.split(/(?<=[.])\s+/).map(text=>({text,evidenceIds:s.features.map(f=>f.id)}))}}})})}

test('Analyze with zero confirmed behavior runs fidelity-only: immediate busy UI, passes, gated dimensions, chime, idle restore',async({page})=>{
 const errors=await open(page);await load(page,sanitized);await configureArchiveMock(page);
 const capability=await page.evaluate(()=>({visuals:__BERRY3VISUAL_TEST__.canAnalyzeVisuals(),behavior:__BERRY3VISUAL_TEST__.canAnalyzeBehavior(),full:__BERRY3VISUAL_TEST__.canSynthesizeFullEvaluation()}));
 expect(capability).toEqual({visuals:true,behavior:false,full:false});
 const sync=await page.evaluate(()=>{document.querySelector('#generate').click();const btn=document.querySelector('#generate');return{busy:__BERRY3VISUAL_TEST__.state.busy,disabled:btn.disabled,label:btn.textContent,aria:btn.getAttribute('aria-busy'),active:[...document.querySelectorAll('#pipeline .pipe.active')].map(e=>e.textContent),status:document.querySelector('#analysisStatus').textContent,gate:document.querySelectorAll('.gate').length,audio:window.__audioContexts}});
 expect(sync.busy).toBe(true);expect(sync.disabled).toBe(true);expect(sync.label).toBe('ANALYZING…');expect(sync.aria).toBe('true');expect(sync.active).toEqual(['Prepare Images']);expect(sync.status).toContain('Preparing Reference/Website A/Website B images');expect(sync.gate).toBe(2);expect(sync.audio).toBe(1);
 await expect(page.locator('#notice')).toContainText('Reference Fidelity complete');
 await expect(page.locator('#notice')).toContainText('Add confirmed behavior observations for Website A and Website B');
 const out=await page.evaluate(()=>({passes:__BERRY3VISUAL_TEST__.state.passes.map(p=>p.stage),visualAnalysis:!!__BERRY3VISUAL_TEST__.state.visualAnalysis,fidelity:__BERRY3VISUAL_TEST__.state.final.fidelityReason,functionality:__BERRY3VISUAL_TEST__.state.final.functionalityReason,overall:__BERRY3VISUAL_TEST__.state.final.overallReason,busy:__BERRY3VISUAL_TEST__.state.busy,disabled:document.querySelector('#generate').disabled,aria:document.querySelector('#generate').getAttribute('aria-busy'),label:document.querySelector('#generate').textContent,done:[...document.querySelectorAll('#pipeline .pipe.done')].map(e=>e.textContent),fail:document.querySelectorAll('#pipeline .pipe.fail').length,chimes:window.__chimeNotes,status:document.querySelector('#analysisStatus').textContent,gates:[...document.querySelectorAll('.gate')].map(e=>e.textContent)}));
 expect(out.passes).toEqual(['visual observation','fidelity synthesis','fidelity QA']);
 expect(out.visualAnalysis).toBe(true);expect(out.fidelity).toContain('Website A is better');expect(out.functionality).toBe('');expect(out.overall).toBe('');
 expect(out.busy).toBe(false);expect(out.disabled).toBe(false);expect(out.aria).toBe('false');expect(out.label).toBe('ANALYZE & GENERATE');
 expect(out.done).toEqual(['Prepare Images','Visual Evidence','Fidelity Decision','QA']);expect(out.fail).toBe(0);
 expect(out.gates).toEqual(['WAITING FOR BEHAVIOR EVIDENCE','WAITING FOR BEHAVIOR EVIDENCE']);expect(out.status).toContain('Reference Fidelity complete');
 expect(out.chimes).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('adding confirmed behavior after a fidelity run enables full six-field synthesis and chime',async({page})=>{
 const errors=await open(page);
 await page.evaluate(async()=>{await __BERRY3VISUAL_TEST__.loadDemo();window.__sample=structuredClone(__BERRY3VISUAL_TEST__.state.draft)});
 await load(page,sanitized);
 await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state;T.settings.apiKey='test-key';T.settings.chime=true;s.models=[{id:T.settings.model,name:'Mock Vision',architecture:{input_modalities:['text','image'],output_modalities:['text']}}];window.__chimeNotes=0;const orig=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){window.__chimeNotes++;return orig.call(this)};const ids=['R','A','B'].map(k=>k==='R'?s.task.referenceImages[0].id:s.task.candidates[k].images[0].id);window.__fullStages=[];T.setAiTransport(async(stage,messages)=>{window.__fullStages.push(stage);if(stage==='visual observation')return{features:[{feature:'Saved panels',location:'Main region',importance:'core',reference:'The reference contains a dark blue rectangular field.',A:'Dark blue background and rectangular panel.',B:'Purple background and rectangular panel.',imageIds:ids,confidence:'high'}]};if(stage==='adversarial QA'){const result=structuredClone(window.__sample);for(const d of T.DIMS)for(const c of result[d].claims)c.evidenceIds=d==='functionality'?[...T.retainedBehavior().A,...T.retainedBehavior().B].map(f=>f.id):d==='fidelity'?s.features.map(f=>f.id):[...s.features.map(f=>f.id),...T.retainedBehavior().A.map(f=>f.id),...T.retainedBehavior().B.map(f=>f.id)];return{result,issues:[],checked:{referenceFeatures:true,behaviorNotInferred:true,lensIsolation:true,tieConsistency:true,allClaimsEvidenced:true,overallTradeoff:true,wordCounts:true}}}return structuredClone(window.__sample)});const obs=(k,text)=>T.normalizeBehavior({[k]:[{observation:text,status:'passed',source:'browser-automation',confidence:'confirmed'}]})[k];s.task.candidates.A.behaviorEvidence=obs('A','Menu button opened the navigation drawer.');s.task.candidates.B.behaviorEvidence=obs('B','Menu button opened the navigation drawer.');T.setRenderStatus('A','rendered');T.setRenderStatus('B','rendered')});
 const capability=await page.evaluate(()=>({visuals:__BERRY3VISUAL_TEST__.canAnalyzeVisuals(),behavior:__BERRY3VISUAL_TEST__.canAnalyzeBehavior(),full:__BERRY3VISUAL_TEST__.canSynthesizeFullEvaluation()}));
 expect(capability).toEqual({visuals:true,behavior:true,full:true});
 await page.locator('#generate').click();
 await expect(page.locator('#notice')).toContainText('Analysis complete');
 const out=await page.evaluate(()=>({stages:window.__fullStages,final:__BERRY3VISUAL_TEST__.state.final,chimes:window.__chimeNotes,gates:document.querySelectorAll('.gate').length,disabled:document.querySelector('#generate').disabled,aria:document.querySelector('#generate').getAttribute('aria-busy')}));
 expect(out.stages).toEqual(['visual observation','decision synthesis','adversarial QA']);
 for(const d of ['functionality','fidelity','overall']){expect(['A is better','B is better','Both are good','Both are bad']).toContain(out.final[d+'Option']);expect(out.final[d+'Reason']).toBeTruthy()}
 expect(out.gates).toBe(0);expect(out.chimes).toBeGreaterThan(0);expect(out.disabled).toBe(false);expect(out.aria).toBe('false');
 expect(errors).toEqual([]);
});

test('OpenRouter HTTP failure is visible with safe provider detail, fails the active stage, restores the button, and does not chime',async({page})=>{
 const errors=await open(page);await load(page,sanitized);
 await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state;T.settings.apiKey='test-key';T.settings.chime=true;s.models=[{id:T.settings.model,name:'Mock Vision',architecture:{input_modalities:['text','image'],output_modalities:['text']}}];window.__chimeNotes=0;const orig=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){window.__chimeNotes++;return orig.call(this)}});
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{message:'No auth credentials found'}})}));
 const sync=await page.evaluate(()=>{document.querySelector('#generate').click();return{busy:__BERRY3VISUAL_TEST__.state.busy,label:document.querySelector('#generate').textContent,aria:document.querySelector('#generate').getAttribute('aria-busy')}});
 expect(sync).toEqual({busy:true,label:'ANALYZING…',aria:'true'});
 await expect(page.locator('#notice')).toContainText('OpenRouter request failed: HTTP 401');
 await expect(page.locator('#notice')).toContainText('No auth credentials found');
 await expect(page.locator('#analysisStatus')).toContainText('Analyze failed');
 const out=await page.evaluate(()=>({busy:__BERRY3VISUAL_TEST__.state.busy,disabled:document.querySelector('#generate').disabled,aria:document.querySelector('#generate').getAttribute('aria-busy'),label:document.querySelector('#generate').textContent,failed:[...document.querySelectorAll('#pipeline .pipe.fail')].map(e=>e.textContent),passes:__BERRY3VISUAL_TEST__.state.passes.map(p=>({stage:p.stage,status:p.status,httpStatus:p.httpStatus,providerError:p.providerError,imageCount:p.imageCount,finished:!!p.finishedAt})),chimes:window.__chimeNotes,debug:__BERRY3VISUAL_TEST__.buildDebugReport(),visualAnalysis:__BERRY3VISUAL_TEST__.state.visualAnalysis}));
 expect(out.busy).toBe(false);expect(out.disabled).toBe(false);expect(out.aria).toBe('false');expect(out.label).toBe('ANALYZE & GENERATE');
 expect(out.failed).toEqual(['Visual Evidence']);expect(out.visualAnalysis).toBe(null);
 expect(out.passes).toEqual([{stage:'visual observation',status:'failed',httpStatus:401,providerError:'No auth credentials found',imageCount:3,finished:true}]);
 expect(out.chimes).toBe(0);
 expect(out.debug.passes[0].httpStatus).toBe(401);expect(JSON.stringify(out.debug)).not.toContain('test-key');
 expect(errors.filter(e=>!/Failed to load resource/.test(e))).toEqual([]);
});

test('provider 400 body, provider name and request shape are visible in diagnostics without secrets or image payloads',async({page})=>{
 const errors=await open(page);await load(page,sanitized);
 await page.evaluate(()=>{const T=__BERRY3VISUAL_TEST__,s=T.state;T.settings.apiKey='test-key-400';T.settings.chime=false;s.models=[{id:'openai/gpt-6-astra',name:'GPT-6 Astra',architecture:{input_modalities:['text','image'],output_modalities:['text']}}];T.renderModels()});
 await page.route('**openrouter.ai/api/v1/chat/completions',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{message:'Provider returned error',code:400,metadata:{provider_name:'OpenAI',raw:JSON.stringify({error:{message:'Unsupported parameter: temperature',type:'invalid_request_error',code:'unsupported_parameter'}})}}})}));
 await page.locator('[data-view=admin]').click();await page.locator('#orModel').selectOption('openai/gpt-6-astra');await page.locator('[data-view=evaluate]').click();
 await page.locator('#generate').click();
 await expect(page.locator('#notice')).toContainText('OpenRouter request failed: HTTP 400');
 await expect(page.locator('#notice')).toContainText('Provider returned error');
 await expect(page.locator('#notice')).toContainText('provider: OpenAI');
 const out=await page.evaluate(()=>({debug:__BERRY3VISUAL_TEST__.buildDebugReport(),status:document.querySelector('#analysisStatus').textContent}));
 const pass=out.debug.passes[0];
 expect(pass.httpStatus).toBe(400);expect(pass.providerError).toBe('Provider returned error');expect(pass.providerName).toBe('OpenAI');expect(pass.providerCode).toBe(400);expect(pass.providerBody).toContain('Unsupported parameter: temperature');
 expect(pass.requestShape).toMatchObject({temperature:'OMITTED',top_p:'OMITTED',logprobs:'OMITTED',response_format:'json_object'});
 expect(out.status).toContain('Analyze failed');
 expect(JSON.stringify(out.debug)).not.toContain('test-key-400');
 expect(JSON.stringify(out.debug)).not.toContain('data:image');
 expect(errors.filter(e=>!/Failed to load resource/.test(e))).toEqual([]);
});

test('completion chime preference can disable the success sound without affecting analysis',async({page})=>{
 const errors=await open(page);await load(page,sanitized);await configureArchiveMock(page);
 await page.evaluate(()=>{__BERRY3VISUAL_TEST__.settings.chime=false});
 await page.locator('#generate').click();
 await expect(page.locator('#notice')).toContainText('Reference Fidelity complete');
 expect(await page.evaluate(()=>window.__chimeNotes)).toBe(0);
 expect(await page.evaluate(()=>__BERRY3VISUAL_TEST__.state.final.fidelityReason)).toBeTruthy();
 expect(errors).toEqual([]);
});

test('candidate snapshot scripts cannot execute and the reconstruction sandbox never allows scripts',async({page})=>{
 const errors=await open(page);
 const out=await page.evaluate(async()=>{const T=__BERRY3VISUAL_TEST__;const html='<html><head><style>body{background:#123}</style></head><body><p>Static</p><script>window.__CANDIDATE_XSS=(window.__CANDIDATE_XSS||0)+1<\/script><img src="x.png" onclick="window.__CANDIDATE_XSS=99"><a href="javascript:window.__CANDIDATE_XSS=99">x</a><template><script>window.__CANDIDATE_XSS=42<\/script></template></body></html>';const c={snapshotHtml:html,snapshotBase:'https://candidate.example/',resourceMap:{byContentId:new Map(),byContentLocation:new Map()},reconstruction:{resolved:[],unresolved:[],warnings:[]}};const graph=T.resourceGraph({parts:[]});const prepared=await T.prepareSnapshot(c,graph);const sandboxes=[];const orig=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(n==='sandbox')sandboxes.push(v);return orig.call(this,n,v)};let result;try{result=await T.rasterizeSnapshot({...c,preparedHtml:prepared},{width:320,height:200})}finally{Element.prototype.setAttribute=orig}return{hasScript:/<script/i.test(prepared),hasHandler:/onclick/i.test(prepared),hasJsUrl:/javascript:/i.test(prepared),xss:window.__CANDIDATE_XSS||0,sandboxes,blobSize:result.blob.size,width:result.width,height:result.height}});
 expect(out.hasScript).toBe(false);expect(out.hasHandler).toBe(false);expect(out.hasJsUrl).toBe(false);expect(out.xss).toBe(0);
 expect(out.sandboxes).toEqual(['allow-same-origin']);expect(out.sandboxes[0]).not.toContain('allow-scripts');
 expect(out.blobSize).toBeGreaterThan(1000);expect(out.width).toBe(320);expect(out.height).toBe(200);
 expect(errors).toEqual([]);
});
