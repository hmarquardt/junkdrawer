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
    const mime = {js:'text/javascript',html:'text/html',css:'text/css',webmanifest:'application/manifest+json',png:'image/png',jpg:'image/jpeg',ttf:'font/ttf'};
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
    const phrase=()=>p.locator('#cue').textContent();
    const button=p.locator('#extract');
    await button.focus();await p.keyboard.press('Space');
    assert.match(await phrase(),/early/);
    await p.keyboard.down('Space');await p.clock.fastForward(250);
    await p.locator('#pauseBtn').focus();await p.keyboard.up('Space');
    assert.equal(await p.locator('#targetCount').textContent(),'0 / 3');
    await p.locator('#zoomIn').click();assert.equal(await p.locator('#zoomValue').textContent(),'1.5×');
    let toolId=0;
    for(let i=0;i<6;i++) {
      const count=await p.locator('.marker').count();
      for(let j=0;j<count;j++) {
        const target=p.locator('.marker.current');
        const ms=await p.evaluate(async({i,j,toolId})=>{
          const {makeField,tools}=await import('./danny/simulation.js');
          const t=makeField(i)[j];
          return Math.round(1000*t.goal*t.resistance/tools[toolId].speed);
        },{i,j,toolId});
        // Use a real mouse on the reticle, then play the rest from the keyboard.
        if(i===0 && j===0) {
          const box=await target.boundingBox();
          await p.mouse.move(box.x+box.width/2,box.y+box.height/2);
          await p.mouse.down();await p.clock.fastForward(ms);await p.mouse.up();
        } else {
          await button.focus();await p.keyboard.down('Space');
          await p.clock.fastForward(ms);await p.keyboard.up('Space');
        }
        assert.equal(await p.locator('#targetCount').textContent(),(j+1)+' / '+count);
      }
      await p.locator('#review').click();
      if(i<5){
        await p.getByRole('button',{name:'Begin next case'}).click();
        if(i<2){toolId=i+1;await p.locator('.tool').nth(toolId).click();}
      }
    }
    assert.equal(await p.locator('#dialogTitle').textContent(),'Campaign complete');
    await p.locator('#dismiss').click();
    await p.evaluate(()=>navigator.serviceWorker.ready);
    await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await context.setOffline(true);await p.reload();
    await p.locator('#review:visible').waitFor();
    assert.equal(await p.locator('#caseTitle').textContent(),'The grand expulsion');
    await p.locator('#filesBtn').click();
    assert.match(await p.locator('#dialogBody').textContent(),/1050 XP · 27 extractions/);
    await p.getByRole('button',{name:'Reset campaign'}).click();
    await p.getByRole('button',{name:'Reset campaign',exact:true}).click();
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
    const ms=await m.evaluate(async()=>{const {makeField,tools}=await import('./danny/simulation.js');const t=makeField(0)[1];return Math.round(1000*t.goal*t.resistance/tools[0].speed);});
    await m.clock.fastForward(ms);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.equal(await m.locator('#targetCount').textContent(),'1 / 3');
    await mobile.close();
    assert.deepEqual(errors,[]);
    console.log('Passed: WebGL2, all six cases, precision scoring, unlocks, cancellation, pointer and keyboard controls, offline reload, IndexedDB recovery, reset, mobile touch and Canvas fallback.');
  } finally {await browser.close();server.close();}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1;});
