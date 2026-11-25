// Run with node tests/danny-popper.cjs. A localhost Pages-style subpath enables service workers.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
const server = http.createServer(async (req,res) => {
  const file = new URL(req.url,'http://localhost').pathname.replace(/^\/junkdrawer\//,'');
  if(!/^(danny\/[\w.-]+|andi-the-rat-slayer\/three.min.js|danny-sw.js|danny-the-pimple-popper.html|analytics-lite.js)$/.test(file)) {
    res.writeHead(404).end(); return;
  }
  try {
    const mime = {js:'text/javascript',json:'application/json',html:'text/html',css:'text/css',webmanifest:'application/manifest+json',png:'image/png',jpg:'image/jpeg',ttf:'font/ttf'};
    res.setHeader('Content-Type',mime[file.split('.').pop()]);
    res.end(await fs.readFile(path.join(root,file)));
  } catch {res.writeHead(404).end();}
});
async function run() {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port+'/junkdrawer/danny-the-pimple-popper.html';
  const browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
  try {
    const errors=[];
    const context=await browser.newContext();
    async function open(ctx) {
      await ctx.route('**/api/analytics/**',r=>r.fulfill({status:204}));
      const p=await ctx.newPage();
      p.on('pageerror',e=>errors.push(e.message));
      p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await p.goto(url);
      await p.waitForFunction(()=>document.querySelector('#feedStatus').textContent==='Optics online');
      await p.clock.install({time:new Date('2030-01-01T00:00:00Z')});
      await p.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
      return p;
    }
    const p=await open(context);
    assert.equal(await p.locator('#stage').getAttribute('data-renderer'),'webgl2');
    // A data-only fixture exercises the loader without shipping an expansion or fetching media.
    const manifest={namespace:'fixture',version:'1.0.0',engineMajor:1,
      assets:[{id:'fixture:photo',kind:'image',src:'unused-fixture.jpg'}],
      regions:[{id:'fixture:site',name:'Test site',image:'fixture:photo',oil:1,elasticity:1}]};
    let mediaRequests=0;
    await p.route('**/unused-fixture.jpg',r=>{mediaRequests++;return r.abort();});
    await p.route('**/fixture-content.json',r=>r.fulfill({json:manifest}));
    await p.route('**/invalid-content.json',r=>r.fulfill({json:{namespace:'invalid',version:'1.0.0',engineMajor:1,
      regions:[{id:'invalid:site',name:'Test',image:'fixture:missing'}]}}));
    const contract=await p.evaluate(async()=>{
      const {createRegistry}=await import('./danny/content.js'),reg=createRegistry();
      await Promise.all([reg.load('./fixture-content.json'),reg.load('./fixture-content.json')]);
      let failed=false;try{await reg.load('./invalid-content.json');}catch{failed=true;}
      return [reg.get('regions','fixture:site').image,reg.list('regions').length,failed,reg.versions()];
    });
    assert.deepEqual(contract,['fixture:photo',1,true,{fixture:'1.0.0'}]);assert.equal(mediaRequests,0);
    const phrase=()=>p.locator('#cue').textContent();
    const button=p.locator('#extract');
    await button.focus();await p.keyboard.press('Space');
    assert.match(await phrase(),/early/);
    await p.keyboard.down('Space');await p.clock.fastForward(250);
    await p.locator('#pauseBtn').focus();await p.keyboard.up('Space');
    assert.equal(await p.locator('#targetCount').textContent(),'0 / 3');
    await p.locator('#zoomIn').click();assert.equal(await p.locator('#zoomValue').textContent(),'1.5×');
    // Pick a release time from the published physics, then exercise normal input. The
    // persistence transaction is read back after every successful pass, including boss seals.
    async function snapshot(page) {
      await page.waitForFunction(()=>document.querySelector('#feedStatus').dataset.save!=='pending');
      return page.evaluate(async()=>{
        const {openCampaign}=await import('./danny/storage.js');
        const store=await openCampaign();return (await store.read()).state;
      });
    }
    async function timing(page,targetId) {
      return page.evaluate(async targetId=>{
        const {openCampaign}=await import('./danny/storage.js');
        const {migrate,visitFor,calibrated}=await import('./danny/progression.js');
        const {makeField,pressure,band}=await import('./danny/simulation.js');
        const profile=migrate((await (await openCampaign()).read()).state);
        const visit=visitFor(profile),tool=calibrated(profile,visit),l=makeField(visit)[targetId],pass=visit.run.layers[targetId]||0;
        for(let ms=1;ms<16000;ms++){
          const elapsed=ms/1000,z=band(elapsed,l,tool,pass);
          if(Math.abs(pressure(elapsed,l,tool,pass)-z.center)<.002)return ms;
        }
        throw Error('Unplayable release band');
      },targetId);
    }
    const mode=async(page,name)=>{
      await page.locator('#modeBtn').click();await page.locator('.mode-option').filter({has:page.locator('strong',{hasText:name})}).click();
    };
    const clear=async(page,mouse=false)=>{
      const marker=page.locator('.marker.current'),id=Number(await marker.getAttribute('data-target')),ms=await timing(page,id);
      const before=await snapshot(page);
      if(mouse){
        const box=await marker.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
        await page.mouse.down();await page.clock.fastForward(ms);await page.mouse.up();
      }else{
        await page.locator('#extract').focus();await page.keyboard.down('Space');await page.clock.fastForward(ms);await page.keyboard.up('Space');
      }
      assert.doesNotMatch(await page.locator('#cue').textContent(),/early|Too much|Release when/);
      const after=await snapshot(page);
      assert.equal(after.revision,(before?.revision||0)+1);
    };
    let passes=0,bosses=0;
    for(let i=0;i<8;i++){
      if(i%2===1){assert.equal(await p.locator('.marker.boss:disabled').count(),1);bosses++;}
      while(await p.locator('#extract').isVisible()){
        await clear(p,passes===0);passes++;assert.ok(passes<50);
      }
      await p.locator('#review').click();
      if(i<7){
        await p.getByRole('button',{name:'Begin next case'}).click();
        if(i<2)await p.locator('.tool').nth(i+1).click();
      }
    }
    assert.equal(bosses,4);assert.equal(passes,42);
    assert.equal(await p.locator('#dialogTitle').textContent(),'Campaign complete');
    await p.locator('#dismiss').click();
    const finished=await snapshot(p);
    assert.equal(finished.stats.chapters,4);assert.equal(finished.stats.bosses,4);
    assert.equal(finished.stats.total,38);assert.equal(finished.xp,1460);
    assert.ok(finished.achievements.includes('base:graduate'));assert.ok(finished.score>7000);
    await mode(p,'Endless Clinic');
    for(let i=0;i<3;i++) {
      while(await p.locator('#extract').isVisible())await clear(p);
      await p.locator('#review').click();await p.getByRole('button',{name:'Next patient'}).click();
    }
    const endless=await snapshot(p),endlessPatient=await p.locator('#patient').textContent();
    assert.equal(endless.stats.endlessFields,3);assert.ok(endless.achievements.includes('base:after-hours'));
    assert.equal(await p.locator('.marker.boss:disabled').count(),1);
    await mode(p,'Zen');
    while(await p.locator('#extract').isVisible()){await p.locator('#extract').focus();await p.keyboard.press('Space');}
    let zen=await snapshot(p);assert.equal(zen.score,endless.score);assert.equal(zen.xp,endless.xp);
    assert.ok(zen.achievements.includes('base:quiet-shift'),JSON.stringify(zen));
    await p.locator('#review').click();await p.getByRole('button',{name:'Next patient'}).click();
    await p.locator('#settingsBtn').click();
    for(const pref of ['toggle','assist','contrast','reducedMotion'])await p.locator('[data-pref="'+pref+'"]').check();
    await p.getByRole('button',{name:'Done'}).click();
    await button.click();assert.match(await button.textContent(),/Release pressure/);await button.click();
    assert.equal(await p.locator('#targetCount').textContent().then(t=>t.split(' / ')[0]),'1');
    await mode(p,'Endless Clinic');assert.equal(await p.locator('#patient').textContent(),endlessPatient);
    await mode(p,'Campaign');
    await p.evaluate(()=>navigator.serviceWorker.ready);
    await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await snapshot(p);await context.setOffline(true);await p.reload();await p.locator('#review:visible').waitFor();
    assert.equal(await p.locator('#caseTitle').textContent(),'Last call at the lab');
    assert.equal(await p.locator('body.contrast').count(),1);
    await p.locator('#filesBtn').click();await p.getByRole('button',{name:'Reset game'}).click();
    await p.getByRole('button',{name:'Reset all shifts',exact:true}).click();
    assert.equal(await p.locator('#targetCount').textContent(),'0 / 3');
    await context.close();
    const mobile=await browser.newContext({viewport:{width:375,height:800},isMobile:true,hasTouch:true});
    await mobile.addInitScript(()=>{
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};
    });
    const m=await open(mobile);
    assert.equal(await m.locator('#stage').getAttribute('data-renderer'),'canvas2d');
    assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const touch=await mobile.newCDPSession(m);
    const other=await m.locator('.marker').nth(1).boundingBox();
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:other.x+other.width/2,y:other.y+other.height/2}]});
    const ms=await timing(m,1);
    await m.clock.fastForward(ms);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal(await m.locator('#targetCount').textContent(),'1 / 3');
    // Corrupt only the latest record, retaining a genuine previous checkpoint.
    await m.locator('#soundBtn').click();
    await m.evaluate(()=>new Promise((resolve,reject)=>{
      const req=indexedDB.open('danny-popper');req.onsuccess=()=>{
        const tx=req.result.transaction('campaign','readwrite');tx.objectStore('campaign').put({revision:2,broken:true},'current');
        tx.oncomplete=resolve;tx.onerror=reject;};
    }));
    await m.reload();await m.locator('#extract:enabled').waitFor();
    assert.match(await m.locator('#saveStatus').textContent(),/Recovered/);
    assert.equal(await m.locator('#targetCount').textContent(),'1 / 3');
    // Simulate an installed six-case preview and verify its IDs and completed targets survive.
    await m.evaluate(()=>new Promise((resolve,reject)=>{
      const req=indexedDB.open('danny-popper');req.onsuccess=()=>{
        const tx=req.result.transaction('campaign','readwrite');tx.objectStore('campaign').put({
          caseIndex:4,cleared:[1,3],xp:650,total:21,tool:2,sound:false,revision:11},'current');
        tx.oncomplete=resolve;tx.onerror=reject;};
    }));
    await m.reload();await m.locator('#extract:enabled').waitFor();
    assert.equal(await m.locator('#targetCount').textContent(),'2 / 5');
    const migrated=await snapshot(m);assert.equal(migrated.schema,2);assert.equal(migrated.revision,12);
    assert.equal(migrated.xp,650);assert.equal(migrated.tool,'base:vacuum');
    const stale=await open(mobile);
    await m.locator('#soundBtn').click();await snapshot(m);
    await stale.locator('#soundBtn').click();
    await stale.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Another tab'));
    assert.equal((await snapshot(m)).revision,13);
    await mobile.close();
    assert.deepEqual(errors,[]);
    console.log('Passed four chapters, four bosses, all modes, upgrades, score, achievements, offline, save migration and recovery, conflict protection, accessibility settings, touch, keyboard, WebGL2 and Canvas.');
  } finally {await browser.close();server.close();}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1;});
