const {test,expect}=require('@playwright/test'),path=require('node:path');
const capture=require('./fixtures/overhead-incident-2026-09-08.json');
test.use({channel:'chrome'});test.setTimeout(60000);
async function replay(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
 await page.clock.setFixedTime(new Date('2026-09-09T01:21:00Z'));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));await page.route('**celestrak.org/**',r=>r.fulfill({json:{error:'Deterministic captured replay'}}));await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:capture.weather}));await page.route('**wikidata.org/**',r=>r.fulfill({json:{results:{bindings:[]}}}));
 await page.goto('file://'+path.resolve('overhead.html'));await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
 await page.evaluate(c=>{const a=__OVERHEAD_TEST__,s=a.state;s.objects=[{NORAD_CAT_ID:25544,groups:['stations','visual'],EPOCH:new Date(c.pass.epoch).toISOString()}];s.nights=a.engine.nights(s.site,Date.now());s.results=Object.fromEntries(s.nights.map((_,i)=>[i,i===0?c.nightPasses:[]]));s.results[0]=s.results[0].map(p=>p.id===c.pass.id?c.pass:p);s.poolCount=7;s.excluded=0;s.loading=false;s.busy=false;s.limit=6;s.day=0;s.view='tonight';s.weather=c.weather;s.groups=new Set(['iss','stations','visual']);a.render();window.__capturedResults=s.results;},capture);
 return errors;
}
test('observed ISS at 8:21 PM stays prominent at score 0 while 4:18 AM wins recommendations',async({page})=>{
 const errors=await replay(page),id=capture.pass.id;
 for(const minute of [18,20,21]){
  await page.clock.setFixedTime(new Date('2026-09-09T01:'+minute+':00Z'));await page.evaluate(()=>__OVERHEAD_TEST__.render());
  const trace=await page.evaluate(()=>__OVERHEAD_TEST__.presentationTrace(__OVERHEAD_TEST__.state.results[0].find(p=>p.norad==='25544')));
  expect(trace.lifecycle).toBe('in-progress');expect(trace.score).toBe(0);expect(trace.recomputedScore).toBe(0);expect(trace.weatherHour.index).toBe(44);expect(trace.weatherHour.rawTime).toBe(1788915600);
  expect(trace.rankBeforeFilters).toBe(7);expect(trace.rankAfterScoreFilter).toBe(7);expect(trace.rankAfterShowFilter).toBe(7);expect(trace.rankAfterLimit).toBeNull();expect(trace.renderedInDOM).toBe(false);expect(trace.happeningNowInDOM).toBe(true);
  const active=page.locator('[data-happening="'+id+'"]');await expect(active).toBeVisible();await expect(active).toContainText('International Space Station');await expect(active).toContainText('IN PROGRESS');await expect(active).toContainText('Sighting score 0/100');await expect(active).toContainText('forecast conditions may make it difficult');
  expect(await page.evaluate(()=>__OVERHEAD_TEST__.best().id)).toBe('21088-1788945063564');await expect(page.locator('#brief')).toContainText('4:18 AM');
  const region=await page.locator('#happening-now').boundingBox(),brief=await page.locator('.briefing').boundingBox();expect(region.y+region.height).toBeLessThanOrEqual(brief.y);
 }
 await page.locator('[data-happening="'+id+'"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#event-dialog')).toBeVisible();await expect(page.locator('#detail-title')).toContainText('ISS');await expect(page.locator('#detail-content .sky')).toBeVisible();await expect(page.locator('.detail-route')).toContainText('peak');
 const pathBefore=await page.locator('#detail-content .sky').innerHTML();await page.evaluate(()=>__OVERHEAD_TEST__.render());expect(await page.locator('#detail-content .sky').innerHTML()).toBe(pathBefore);expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.selected.norad)).toBe('25544');await page.keyboard.press('Escape');
 for(const show of ['likely','great','all']){await page.evaluate(show=>{const s=__OVERHEAD_TEST__.state;s.settings.show=show;s.settings.score=99;__OVERHEAD_TEST__.render();},show);await expect(page.locator('[data-happening="'+id+'"]')).toBeVisible();}
 await page.getByRole('tab',{name:'NEXT 7 DAYS'}).click();await page.locator('[data-day="1"]').click();await expect(page.locator('[data-happening="'+id+'"]')).toBeVisible();
 await page.evaluate(()=>{__OVERHEAD_TEST__.state.favoriteOnly=true;__OVERHEAD_TEST__.render();});await expect(page.locator('[data-happening="'+id+'"]')).toBeVisible();
 await page.evaluate(()=>{__OVERHEAD_TEST__.state.groups.delete('iss');__OVERHEAD_TEST__.render();});await expect(page.locator('#happening-now')).toBeHidden();
 await page.evaluate(()=>{const s=__OVERHEAD_TEST__.state;s.groups.add('iss');s.view='tonight';s.day=0;s.settings.score=0;s.settings.show='likely';__OVERHEAD_TEST__.render();});
 // Clicking the previous minute's button just after the viewing interval ends still opens details.
 await page.clock.setFixedTime(new Date(capture.pass.end+1));await page.locator('[data-happening="'+id+'"]').click();await expect(page.locator('#event-dialog')).toBeVisible();await page.keyboard.press('Escape');await page.evaluate(()=>__OVERHEAD_TEST__.render());await expect(page.locator('#happening-now')).toBeHidden();expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.results===__capturedResults)).toBe(true);
 expect(errors).toEqual([]);
});
test('HAPPENING NOW is keyboard usable and readable at five widths in both themes',async({page})=>{
 const errors=await replay(page);const original=await page.evaluate(()=>JSON.stringify(__OVERHEAD_TEST__.state.results));
 for(const width of [390,768,1024,1440,1920]){await page.setViewportSize({width,height:950});let box;
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>document.querySelector('[data-theme-choice="'+theme+'"]').click(),theme);const button=page.locator('[data-happening]').first();await button.focus();await page.evaluate(()=>__OVERHEAD_TEST__.render());await expect(button).toBeFocused();expect(await button.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);const current=await page.locator('#happening-now').boundingBox();if(box)expect(current).toEqual(box);box=current;
   expect(current.y+current.height).toBeLessThan(950);await page.screenshot({path:'/private/tmp/overhead-awareness-'+theme+'-'+width+'.png'});
  }
 }
 expect(await page.evaluate(()=>JSON.stringify(__OVERHEAD_TEST__.state.results))).toBe(original);expect(errors).toEqual([]);
});
