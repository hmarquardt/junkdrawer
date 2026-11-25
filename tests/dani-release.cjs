// Exercise the installed 1.0 worker and database against the maintenance release on one origin.
// Run from a checkout containing the published 1.0 commit: node tests/dani-release.cjs
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname,'..');
const previousRelease = '8a6432c09660209572932074af5a9874d1ed21d3';
const legacy = 'danny-the-pimple-popper.html';
const canonical = 'dani-the-pimple-popper.html';
const title = 'Dani the Pimple Popper';
const publicUrl = 'https://hmarquardt.github.io/junkdrawer/'+canonical;
const types = {html:'text/html',js:'text/javascript',webmanifest:'application/manifest+json',
  css:'text/css',json:'application/json',jpg:'image/jpeg',png:'image/png',ttf:'font/ttf'};
function published(file) {
  return execFileSync('git',['show',previousRelease+':'+file],{cwd:root,stdio:['ignore','pipe','ignore']});
}

async function checkpoints(page) {
  return page.evaluate(async()=>{
    const db = await new Promise((resolve,reject)=>{
      const req=indexedDB.open('danny-popper');
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('campaign'),store=tx.objectStore('campaign');
      const current=store.get('current'),previous=store.get('previous');
      tx.oncomplete=()=>{db.close();resolve({current:current.result,previous:previous.result});};
      tx.onabort=()=>reject(tx.error);
    });
  });
}
async function seedInstalledGame(page) {
  // Use the original game's serializers to create a partially cleared boss and its backup.
  await page.evaluate(async()=>{
    const {fresh,switchMode}=await import('./danny/progression.js');
    const {openCampaign}=await import('./danny/storage.js');
    const profile=fresh(),storage=await openCampaign();
    switchMode(profile,'base:endless');switchMode(profile,'base:zen');switchMode(profile,'base:campaign');
    Object.assign(profile.slots[profile.mode],{encounter:'base:forecast',seed:20530,turn:2,cleared:[0,1,2],points:580,streak:4});
    Object.assign(profile,{xp:220,score:1180,tool:'base:vacuum',achievements:['base:first-pop'],revision:1,checkpointId:'prior'});
    profile.stats.total=6;profile.settings.sound=false;
    await storage.write(profile,0,null);
    profile.slots[profile.mode].layers[3]=1;profile.revision=2;profile.checkpointId='in-progress';
    await storage.write(profile,1,'prior');
    await caches.open('unrelated-app-shell');
    localStorage.setItem('andi.campaign','unrelated save sentinel');
  });
}
async function assertBrand(page) {
  assert.match(await page.title(),/^Dani the Pimple Popper/);
  assert.match(await page.locator('h1').textContent(),/^Dani the Pimple Popper/);
  assert.doesNotMatch(await page.locator('body').innerText(),/\bDanny\b/i);
  assert.match(await page.locator('.brand').getAttribute('aria-label'),/^Dani /);
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),publicUrl);
  assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'),publicUrl);
  assert.match(await page.locator('meta[property="og:title"]').getAttribute('content'),/^Dani /);
}
async function main(){
  let original=true,networkDown=false;
  const server=http.createServer(async(req,res)=>{
    if(networkDown){req.socket.destroy();return;}
    const file=new URL(req.url,'http://localhost').pathname.replace(/^\/junkdrawer\//,'');
    if(!/^(danny\/[\w.-]+|danny-sw\.js|dani-the-pimple-popper\.html|danny-the-pimple-popper\.html|andi-the-rat-slayer\/three\.min\.js|analytics-lite\.js)$/.test(file)){
      res.writeHead(404).end();return;
    }
    try{
      const bytes=original?published(file):await fs.readFile(path.join(root,file));
      res.writeHead(200,{'content-type':types[path.extname(file).slice(1)],'cache-control':'no-store'}).end(bytes);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',args:['--enable-unsafe-swiftshader']});
    const ctx=await browser.newContext(), page=await ctx.newPage();
    const base='http://127.0.0.1:'+server.address().port+'/junkdrawer/';
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await ctx.route('**/api/analytics/**',r=>r.fulfill({status:204}));
    const cdp=await ctx.newCDPSession(page);
    const appId=async()=>(await cdp.send('Page.getAppId')).appId;
    const boot=async()=>page.waitForFunction(()=>document.querySelector('#feedStatus')?.textContent==='Optics online');
    const offline=async value=>{networkDown=value;await ctx.setOffline(value);};
    await page.goto(base+legacy);await boot();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const installedId=await appId();assert.ok(installedId);
    await seedInstalledGame(page);
    const saved=await checkpoints(page);
    original=false;await offline(true);await page.reload();await boot();
    assert.match(await page.title(),/^Danny /);assert.deepEqual(await checkpoints(page),saved);

    // Trigger the update check the browser normally schedules on an online launch.
    await offline(false);
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;
      const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
      await r.update();await changed;});
    // Lose connectivity before the corrected URL has ever been visited or registered.
    await offline(true);
    await page.goto(base+legacy+'?from=bookmark#shift');await boot();await assertBrand(page);
    assert.deepEqual(await checkpoints(page),saved);
    assert.match(await page.locator('#bossHint').textContent(),/Pass 2\/2/);
    await offline(false);await page.reload();await boot();
    await page.waitForURL(base+canonical+'?from=bookmark#shift');
    await page.waitForFunction(async()=>{
      const regs=await navigator.serviceWorker.getRegistrations();
      return regs.length===2 && regs.every(r=>r.active?.state==='activated');
    });
    assert.equal(await appId(),installedId);
    await offline(true);await page.reload();await boot();await assertBrand(page);
    assert.deepEqual(await checkpoints(page),saved);
    await page.goto(base+legacy+'#installed');await boot();
    await page.waitForURL(base+canonical+'#installed');assert.deepEqual(await checkpoints(page),saved);
    const isolation=await page.evaluate(async()=>{
      const registrations=await navigator.serviceWorker.getRegistrations();
      const names=['andi-the-rat-slayer.html','storage-manager.html','index.html'];
      const controls=await Promise.all(names.map(name=>navigator.serviceWorker.getRegistration('./'+name)));
      return {scopes:registrations.map(r=>new URL(r.scope).pathname.split('/').pop()).sort(),
        unrelated:controls.some(Boolean),saved:localStorage.getItem('andi.campaign'),caches:await caches.keys()};
    });
    assert.deepEqual(isolation.scopes,[canonical,legacy].sort());
    assert.equal(isolation.unrelated,false);assert.equal(isolation.saved,'unrelated save sentinel');
    assert.ok(isolation.caches.includes('unrelated-app-shell'));
    await page.locator('#soundBtn').click();await page.waitForFunction(()=>document.querySelector('#feedStatus').dataset.save==='saved');
    const next=await checkpoints(page);assert.deepEqual(next.previous,saved.current);
    assert.deepEqual(next.current.slots,saved.current.slots);assert.deepEqual(next.current.achievements,saved.current.achievements);
    await offline(false);

    const fresh=await browser.newContext(),freshPage=await fresh.newPage();
    await freshPage.goto(base+legacy+'?fresh=1#first');
    await freshPage.waitForURL(base+canonical+'?fresh=1#first');await assertBrand(freshPage);
    const manifest=await freshPage.evaluate(async()=> (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    assert.equal(manifest.name,title);assert.equal(manifest.start_url,'../'+canonical);
    assert.equal(manifest.id,JSON.parse(published('danny/manifest.webmanifest')).id);
    const catalog=JSON.parse(await fs.readFile(path.join(root,'junk-drawer.json'))).pages;
    assert.equal(catalog[canonical].title,title);assert.equal(catalog[legacy].hide,true);
    const content=JSON.parse(await fs.readFile(path.join(root,'danny/base.json')));
    const oldContent=JSON.parse(published('danny/base.json'));
    for(const family of Object.keys(content)){
      if(Array.isArray(oldContent[family])){
        const ids=new Set(content[family].map(x=>x.id));
        for(const original of oldContent[family])assert.ok(ids.has(original.id),original.id);
      }
    }
    assert.doesNotMatch(JSON.stringify(content),/\bDanny\b/);
    assert.deepEqual(errors,[]);
    console.log('Passed original offline install, interrupted upgrade, canonical and legacy launches, PWA identity, both checkpoints, continued saves, branding and cross-app isolation.');
  }finally{await browser?.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
