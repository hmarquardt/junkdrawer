const {test,expect}=require('@playwright/test');
const fs=require('fs'),path=require('path');
const base=path.join(__dirname,'fixtures/fixed-income');
const nominal=fs.readFileSync(path.join(base,'treasury-nominal.xml'),'utf8');
const real=fs.readFileSync(path.join(base,'treasury-real.xml'),'utf8');
const fed=JSON.parse(fs.readFileSync(path.join(base,'nyfed.json'),'utf8'));
const app=fs.readFileSync(path.join(__dirname,'../fixed-income-desk.html'),'utf8');
const origin='https://hmarquardt.github.io/junkdrawer/fixed-income-desk.html';
test.use({channel:'chrome'});
async function start(page,options={}){
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>requests.push(r.url()));
 await page.clock.install({time:new Date('2026-09-10T17:00:00Z')});
 await page.route(origin,r=>r.fulfill({contentType:'text/html',body:app}));
 await page.route('**/interest-rates/pages/xml?**',r=>r.fulfill({contentType:'application/xml',headers:{'access-control-allow-origin':'*'},body:options.treasuryError?'invalid XML':r.request().url().includes('real_yield')?(options.realError?'invalid XML':real):nominal}));
 await page.route('https://markets.newyorkfed.org/api/**',r=>r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(options.fedError?{}:fed)}));
 await page.goto(origin);
 await page.waitForFunction(()=>window.__FIXED_INCOME_TEST__?.markets&&!__FIXED_INCOME_TEST__.markets.state.refreshing);
 return{errors,requests};
}
test('Treasury / NY Fed parsers preserve dates, optional tenors and units',async({page})=>{
 const {errors}=await start(page);
 const values=await page.evaluate(({nominal,real,fed})=>{const m=__FIXED_INCOME_TEST__.markets;return{n:m.Treasury.parse(nominal,'nominal'),r:m.Treasury.parse(real,'real'),f:m.NYFed.parse(fed)}},{nominal,real,fed});
 expect(values.n).toHaveLength(4);
 expect(values.n[0].values['6W']).toBe(3.9);
 expect(values.n[3].values['6W']).toBeUndefined();
 expect(values.n[3].date).toBe('2026-09-09');
 expect(values.r[1].values['10Y']).toBe(1.9);
 expect(values.f.find(r=>r.type==='SOFRAI')).toMatchObject({date:'2026-09-10',index:1.25,average30:3.65});
 expect(values.f.find(r=>r.type==='SOFR')).toMatchObject({volumeBillions:2800});
 expect(errors).toEqual([]);
});
test('dates, holiday staleness, aligned breakevens and deterministic curve metrics',async({page})=>{
 await start(page);
 const v=await page.evaluate(()=>{const m=__FIXED_INCOME_TEST__.markets,s=m.state;return{previous:m.comparison(s.nominal,'2026-09-08','previous'),missing:m.comparison(s.nominal,'2026-09-09','month'),week:m.comparison(s.nominal,'2026-09-09','week'),monthEnd:m.monthShift('2026-03-31',-1),weekend:m.freshness('2026-09-04','2026-09-06'),holiday:m.freshness('2026-09-04','2026-09-08'),stale:m.freshness('2026-09-02','2026-09-10'),snap:m.snapshot(s.nominal,s.real,s.refs,'previous','2026-09-10'),change:m.changeMeasures(s.nominal[3],s.nominal[1]),missingTenor:m.curveMeasures({'2Y':4}),bad:m.validDate('2026-02-30')}});
 expect(v.previous.date).toBe('2026-09-04');expect(v.week.date).toBe('2026-09-02');expect(v.missing).toBeNull();
 expect(v.monthEnd).toBe('2026-02-28');expect(v.weekend).toBe('current');expect(v.holiday).toBe('current');expect(v.stale).toBe('stale');expect(v.bad).toBe(false);
 expect(v.snap.curve).toMatchObject({'2s10s':30,'5s30s':50,'3m10y':50,'2s30s':60,levelPercent:4.45,frontBp:20,bellyBp:30,longBp:30,butterflyBp:-10});
 expect(v.snap.inflation).toMatchObject({date:'2026-09-08',be10Percent:2.5,be5Percent:2.5});
 expect(v.change.byTenorBp['10Y']).toBe(20);expect(v.change.classification).toBe('Bear steepening');expect(v.change.slopeChangeBp).toBe(10);expect(v.missingTenor['2s10s']).toBeNull();
});
for(const width of [390,768,1024,1440,1920])test(`Markets at ${width}px: charts, controls, themes, numerical alternatives`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const {errors,requests}=await start(page);
 await expect(page.locator('#panel-markets')).toBeVisible();
 await expect(page.locator('#market-status')).toHaveText('Current');
 await expect(page.locator('#market-metrics .market-metric')).toHaveCount(10);
 await expect(page.locator('#market-freshness')).toContainText('09/09/2026');
 expect(await page.locator('#market-curve-chart canvas').count()).toBeGreaterThan(0);
 await page.locator('#market-maturity').selectOption('10Y');
 await expect(page.locator('#market-curve-readout')).toContainText('4.500%');
 await page.locator('#market-compare').selectOption('week');
 await expect(page.locator('#comparison-date')).toContainText('09/02/2026');
 const check=page.locator('#curve-toggles input').first();await check.uncheck();await check.check();
 await page.locator('[data-range="3M"]').click();await expect(page.locator('#history-status')).toContainText('Requested');
 await page.locator('#rate-series').selectOption('SOFR');await expect(page.locator('#rate-readout')).toContainText('3.630');
 await page.locator('#spread-series').selectOption('be10');await expect(page.locator('#market-history-table')).toContainText('250.00');
 await page.locator('#theme').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 for(const tab of ['markets','foundations','math','risk','modern','then','lab','glossary','sources']){
  await page.locator('#tab-'+tab).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth),'overflow '+tab).toBeLessThanOrEqual(width);
 }
 expect(requests.filter(x=>x.includes('analytics')||x.includes('openrouter'))).toEqual([]);
 expect(errors).toEqual([]);
});
test('touch/cursor interaction and local observed-move lab bridge',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 const {errors}=await start(page);
 const over=page.locator('#market-curve-chart .u-over');await over.scrollIntoViewIfNeeded();const rect=await over.boundingBox();await page.touchscreen.tap(rect.x+rect.width*.8,rect.y+rect.height*.5);
 await expect(page.locator('#market-curve-readout')).toContainText('comparison');
 const dims=await page.locator('#market-curve-readout').boundingBox();expect(dims.x+dims.width).toBeLessThanOrEqual(391);
 await page.locator('#apply-duration').fill('8');await page.locator('#apply-convexity').fill('70');
 await expect(page.locator('#apply-result')).toContainText('-0.797%');
 await page.locator('#apply-to-lab').click();await expect(page.locator('#panel-lab')).toBeVisible();await expect(page.locator('#shock-duration')).toHaveValue('8');await expect(page.locator('#shock-bp')).toHaveValue('10');
 await page.locator('#portfolio-preset').selectOption('Bear steepener');await expect(page.locator('#portfolio-shock-0')).toHaveValue('25');await expect(page.locator('#portfolio-shock-2')).toHaveValue('75');
 await page.locator('#lab-use-current').click();await expect(page.locator('#bond-yield')).toHaveValue('4.5');await expect(page.locator('#inflation-nominal')).toHaveValue('4.4');await expect(page.locator('#inflation-real')).toHaveValue('1.9');await expect(page.locator('#curve-0')).toHaveValue('4.3');
 expect(errors).toEqual([]);await context.close();
});
test('independent failures, stale data, offline desk and successful retry',async({page})=>{
 const {errors}=await start(page,{fedError:true,realError:true});
 await expect(page.locator('#market-status')).toHaveText('Partially available');await expect(page.locator('#market-metrics')).toContainText('4.500%');await expect(page.locator('#reference-rates')).toContainText('unavailable');
 await page.evaluate(()=>{const m=__FIXED_INCOME_TEST__.markets;for(const k of ['nominal','real'])m.state[k]=m.state[k].map(r=>({...r,date:'2026-08-01'}));m.state.refs=[];m.render()});
 await page.route('https://markets.newyorkfed.org/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fed)}));await page.route('**/interest-rates/pages/xml?**',r=>r.fulfill({contentType:'application/xml',body:r.request().url().includes('real_yield')?real:nominal}));
 await page.locator('#market-refresh').click();await expect(page.locator('#market-status')).toHaveText('Current');
 await page.context().setOffline(true);await page.locator('#market-refresh').click();await expect(page.locator('#market-status')).toHaveText('Offline');await page.locator('#tab-lab').click();await expect(page.locator('#credit-result')).toContainText('$12,000.00');await page.locator('#tab-math').click();await page.locator('#equation-search').fill('convexity');expect(await page.locator('.equation-card').count()).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});
test('AI packet, grouped models, explicit calls, grounded response and credential deletion',async({page})=>{
 const {errors}=await start(page);const key='test-secret-never-in-packet';let chats=[];
 await page.route('https://openrouter.ai/api/v1/models',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:'openai/gpt-4.1-mini',name:'Mini',context_length:100000,pricing:{prompt:'0.000001',completion:'0.000002'}},{id:'openrouter/free',name:'Free',context_length:32000,pricing:{prompt:'0',completion:'0'}}]})}));
 await page.route('https://openrouter.ai/api/v1/key',r=>r.fulfill({contentType:'application/json',body:'{"data":{}}'}));
 const response={marketInOneMinute:'Supplied Treasury observations show a positive 2s10s slope.',curve:'The supplied change is a steepening.',ratesFunding:'Reference effective dates differ.',inflationSignal:'Use the aligned date.',fixedIncomeConsequences:'Duration connects a yield shock to approximate price loss.',risksWorthNoticing:'Curve risk remains.',conceptsToRevisit:['duration','javascript:bad','breakeven'],thoughtExperiment:{question:'What if yields rise another 50 bp?',analysis:'Use the duration equation; this answer stays hidden.'}};
 await page.route('https://openrouter.ai/api/v1/chat/completions',r=>{chats.push(r.request().postDataJSON());return r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}],usage:{prompt_tokens:1000,completion_tokens:500}})})});
 await page.locator('#analyst-settings summary').click();await page.locator('#analyst-key').fill(key);await page.locator('#analyst-save').click();await expect(page.locator('#model-status')).toContainText('models loaded');await expect(page.locator('#analyst-model optgroup')).toHaveCount(2);
 await page.locator('#model-search').fill('free');await expect(page.locator('#analyst-model')).toHaveValue('openai/gpt-4.1-mini');await page.locator('#model-search').fill('');
 await page.locator('#analyst-test').click();await expect(page.locator('#model-status')).toContainText('authenticated');expect(chats).toHaveLength(0);
 await page.locator('#analyst-analyze').click();await expect(page.locator('#analyst-status')).toContainText('complete');expect(chats).toHaveLength(1);expect(JSON.stringify(chats[0])).not.toContain(key);expect(chats[0].messages[0].content).toContain('Do not silently recalculate');
 const packet=JSON.parse(chats[0].messages[1].content).market;expect(packet.curveMeasures['2s10s']).toBe(30);expect(packet.breakevens.date).toBe('2026-09-08');expect(packet.referenceRates.SOFRAI.date).toBe('2026-09-10');
 await expect(page.locator('#analyst-result')).toContainText('0.002000');await expect(page.locator('#analyst-result a[href="javascript:bad"]')).toHaveCount(0);await expect(page.getByText('Use the duration equation; this answer stays hidden.',{exact:true})).not.toBeVisible();await page.getByText('Reveal analysis',{exact:true}).click();await expect(page.getByText('Use the duration equation; this answer stays hidden.',{exact:true})).toBeVisible();
 const sent=await page.locator('#analyst-packet').textContent();await page.locator('#market-compare').selectOption('week');await expect(page.locator('#analyst-packet')).toHaveText(sent);
 await page.locator('#analyst-clear').click();expect(await page.evaluate(()=>localStorage.getItem('fixed-income-desk.openrouter'))).not.toContain(key);await expect(page.locator('#analyst-key')).toHaveValue('');
 expect(errors).toEqual([]);
});
test('model/catalog errors preserve fallback; source error retains educational navigation',async({page})=>{
 await start(page,{treasuryError:true,fedError:true});await expect(page.locator('#market-status')).toHaveText('Source error');
 await page.locator('#analyst-settings summary').click();await page.route('https://openrouter.ai/api/v1/models',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));await page.locator('#analyst-key').fill('invalid-test');await page.locator('#analyst-save').click();await expect(page.locator('#model-status')).toContainText('failed');await expect(page.locator('#analyst-model')).toHaveValue('openai/gpt-4.1-mini');
 await page.locator('#global-search').fill('Treasury curve');await page.locator('#search-results [data-target="market-curve"]').first().click();await expect(page.locator('#market-curve')).toBeFocused();await page.locator('#global-search').fill('DV01');await page.locator('#search-results [data-target="eq-dv01"]').click();await expect(page.locator('#eq-dv01')).toBeVisible();
});
test('failed second analysis keeps its own packet and does not mislabel an old result',async({page})=>{
 await start(page);await page.route('https://openrouter.ai/api/v1/models',r=>r.fulfill({contentType:'application/json',body:'{"data":[]}'}));await page.locator('#analyst-settings summary').click();await page.locator('#analyst-key').fill('test-key');await page.locator('#analyst-save').click();
 const response={marketInOneMinute:'First result',curve:'Curve',ratesFunding:'Funding',inflationSignal:'Inflation',fixedIncomeConsequences:'Consequences',risksWorthNoticing:'Risks',conceptsToRevisit:['constructor','__proto__','duration'],thoughtExperiment:{question:'Question?',analysis:'Answer'}};
 let count=0;await page.route('https://openrouter.ai/api/v1/chat/completions',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:++count===1?JSON.stringify(response):'invalid JSON response'}}]})}));
 await page.locator('#analyst-analyze').click();await expect(page.locator('#analyst-result')).toContainText('First result');await expect(page.locator('#analyst-result a')).toHaveCount(1);
 await page.locator('#analyst-mode').selectOption('Risk lens');await page.locator('#analyst-analyze').click();await expect(page.locator('#analyst-status')).toContainText('unavailable');await expect(page.locator('#analyst-result')).toBeEmpty();const packet=await page.locator('#analyst-packet').textContent();await page.locator('#market-compare').selectOption('week');await expect(page.locator('#analyst-packet')).toHaveText(packet);expect(packet).toContain('Risk lens');
});
test('required reference rates missing means partial; stale status and no date substitution',async({page})=>{
 await start(page);await page.evaluate(()=>{const m=__FIXED_INCOME_TEST__.markets;m.state.refs=m.state.refs.filter(r=>r.type==='SOFRAI');m.render()});await expect(page.locator('#market-status')).toHaveText('Partially available');
 await page.evaluate(()=>{const m=__FIXED_INCOME_TEST__.markets;m.state.refs=[{type:'SOFR',date:'2026-08-03',rate:4},{type:'EFFR',date:'2026-08-03',rate:4}];m.state.nominal=m.state.nominal.map(r=>({...r,date:'2026-08-03'}));m.state.real=m.state.real.map(r=>({...r,date:'2026-08-03'}));m.render()});await expect(page.locator('#market-status')).toHaveText('Stale');await expect(page.locator('#market-freshness')).toContainText('08/03/2026');await expect(page.locator('#market-metrics')).toContainText('stale');
});
test('all range controls remain bounded and historical failures preserve current values',async({page})=>{
 const {requests}=await start(page);for(const range of ['6M','YTD','1Y','3Y','5Y','Max']){await page.locator(`[data-range="${range}"]`).click();await expect(page.locator('#history-status')).toContainText('Requested')}
 expect(requests.filter(u=>u.includes('field_tdr_date_value=')).every(u=>Number(new URL(u).searchParams.get('field_tdr_date_value'))>=2021)).toBe(true);
 await page.route('**/interest-rates/pages/xml?**',r=>r.fulfill({contentType:'application/xml',body:'unavailable'}));await page.evaluate(()=>__FIXED_INCOME_TEST__.markets.state.cache.clear());await page.locator('[data-range="3M"]').click();await expect(page.locator('#history-status')).toContainText('Partially available');await expect(page.locator('#market-metrics')).toContainText('4.500%');
});
test('existing tab preference avoids eager market fetch; key-save failure stays visible',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('fixed-income-desk.tab','risk'));
 const {requests}=await start(page);await expect(page.locator('#panel-risk')).toBeVisible();expect(requests.filter(u=>u.includes('treasury.gov')||u.includes('newyorkfed.org'))).toEqual([]);
 await page.locator('#tab-markets').click();await expect(page.locator('#market-status')).toHaveText('Current');await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')}});await page.route('https://openrouter.ai/api/v1/models',r=>r.fulfill({contentType:'application/json',body:'{"data":[]}'}));await page.locator('#analyst-settings summary').click();await page.locator('#analyst-key').fill('session-only-key');await page.locator('#analyst-save').click();await expect(page.locator('#model-status')).toContainText('models loaded');await expect(page.locator('#key-storage-status')).toContainText('Could not save');
});
