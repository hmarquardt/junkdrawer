const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const url = `file://${path.resolve(process.cwd(), 'fixed-income-desk.html')}`;
test.use({channel:'chrome'});
async function open(page) {
 await page.addInitScript(()=>{try{if(!localStorage.getItem('fixed-income-desk.tab'))localStorage.setItem('fixed-income-desk.tab','foundations')}catch{}});
 await page.route('**/interest-rates/pages/xml?**',r=>r.fulfill({contentType:'application/xml',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(path.join(__dirname,'fixtures/fixed-income',r.request().url().includes('real_yield')?'treasury-real.xml':'treasury-nominal.xml'),'utf8')}));
 await page.route('https://markets.newyorkfed.org/api/**',r=>r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(path.join(__dirname,'fixtures/fixed-income/nyfed.json'),'utf8')}));
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 await page.goto(url);
 await expect(page.locator('#concept-list .card')).toHaveCount(29);
 return errors;
}
for(const width of [390,768,1024,1440,1920]) {
 test(`all sections fit ${width}px, including expanded equations`,async({page})=>{
  const errors=await open(page);
  await page.setViewportSize({width,height:1000});
  await page.screenshot({path:`/private/tmp/fixed-income-${width}.png`});
  for(const tab of ['foundations','math','risk','modern','then','lab','glossary','sources']) {
   await page.locator('#tab-'+tab).click();
   await page.locator('#panel-'+tab+' details').evaluateAll(ds=>ds.forEach(d=>d.open=true));
   const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
   expect(dims.scroll,`${tab} overflow`).toBeLessThanOrEqual(dims.width);
   if(tab==='math') {
    const overflow=await page.locator('.equation').evaluateAll(es=>es.filter(e=>e.offsetWidth&&e.scrollWidth>e.clientWidth+1).length);
    expect(overflow).toBe(0);
   }
   if(tab==='lab') {
    const chart=page.locator('#curve-chart svg');
    expect((await chart.boundingBox()).width).toBeLessThan(width);
    if(width===390||width===1440){await page.locator('#lab-curve').scrollIntoViewIfNeeded();await page.screenshot({path:`/private/tmp/fixed-income-lab-${width}.png`});}
   }
  }
  expect(errors).toEqual([]);
 });
}
test('known prices, duration derivatives, shock, curve, loss and breakeven',async({page})=>{
 const errors=await open(page);
 const v=await page.evaluate(()=>{
  const t=__FIXED_INCOME_TEST__;
  const par=t.bondMetrics(1000,.05,10,.05,2),zero=t.bondMetrics(100,0,2,.05,1),zeroYield=t.bondMetrics(100,.05,2,0,2);
  const h=.00001,up=t.bondMetrics(1000,.05,10,.05+h,2).price,down=t.bondMetrics(1000,.05,10,.05-h,2).price;
  return {par,zero,zeroYield,derivative:(down-up)/(2*h*par.price),convexity:(down+up-2*par.price)/(h*h*par.price),shock:t.shockMetrics(100,5,30,100),f:t.forward(.04,1,.05,2)};
 });
 expect(v.par.price).toBeCloseTo(1000,8);
 expect(v.zero.price).toBeCloseTo(90.7029478458,8);
 expect(v.zero.modified).toBeCloseTo(2/1.05,8);
 expect(v.zeroYield.price).toBeCloseTo(110,8);
 expect(v.derivative).toBeCloseTo(v.par.modified,6);
 expect(v.convexity).toBeCloseTo(v.par.convexity,3);
 expect(v.shock.linearPrice).toBeCloseTo(95,8);
 expect(v.shock.price).toBeCloseTo(95.15,8);
 expect(v.f).toBeCloseTo(.060096153846,8);
 await page.locator('#tab-lab').click();
 await expect(page.locator('#bond-result')).toContainText('1,000.00');
 await expect(page.locator('#credit-result')).toContainText('$12,000.00');
 await expect(page.locator('#inflation-result')).toContainText('2.500%');
 await page.locator('#bond-coupon').fill('0');
 await page.locator('#bond-years').fill('2');
 await page.locator('#bond-frequency').selectOption('1');
 await expect(page.locator('#bond-result')).toContainText('907.03');
 await page.locator('#bond-years').fill('1.3');
 await expect(page.locator('#bond-result')).toContainText('whole number');
 await page.locator('#credit-pd').fill('101');
 await expect(page.locator('#credit-result')).toHaveClass(/error/);
 await page.locator('#credit-pd').fill('0');
 await expect(page.locator('#credit-result')).toContainText('$0.00');
 await page.locator('#shock-bp').fill('');
 await expect(page.locator('#shock-result')).toHaveClass(/error/);
 await page.locator('[data-shock="-100"]').click();
 await expect(page.locator('#shock-result')).toContainText('105.15');
 await page.locator('#curve-0').fill('');
 await expect(page.locator('#curve-result')).toHaveClass(/error/);
 await expect(page.locator('#curve-chart svg')).toHaveCount(0);
 await page.locator('[data-curve="reset"]').click();
 await expect(page.locator('#curve-chart svg')).toHaveCount(1);
 await page.locator('[data-curve="parallel"]').click();
 await expect(page.locator('#curve-0')).toHaveValue('4.550');
 expect(errors).toEqual([]);
});
test('keyboard tabs, search, filtered cross-links, copy and preferences',async({page})=>{
 const errors=await open(page);
 await page.locator('#tab-foundations').focus();
 await page.keyboard.press('ArrowRight');
 await expect(page.locator('#tab-math')).toBeFocused();
 await expect(page.locator('#tab-math')).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('End');
 await expect(page.locator('#tab-sources')).toBeFocused();
 await page.keyboard.press('Home');
 await expect(page.locator('#tab-markets')).toBeFocused();
 await page.keyboard.press('/');
 await expect(page.locator('#global-search')).toBeFocused();
 await page.locator('#global-search').fill('DV01');
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(page.locator('#panel-math')).toBeVisible();
 await expect(page.locator('#eq-dv01')).toBeFocused();
 await expect(page.locator('#eq-dv01 details').first()).toHaveAttribute('open','');
 await page.locator('#equation-search').fill('bootstrapping');
 await expect(page.locator('.equation-card')).toHaveCount(1);
 await page.locator('#global-search').fill('OAS');
 await page.locator('#search-results [data-target="eq-oas"]').click();
 await expect(page.locator('#eq-oas')).toBeVisible();
 await expect(page.locator('.equation-card')).toHaveCount(44);
 await page.evaluate(()=>{window.__copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>window.__copied=s}})});
 await page.locator('#eq-oas .copy').click();
 expect(await page.evaluate(()=>window.__copied)).toContain('Pmarket');
 await page.locator('#cheat').check();
 await expect(page.locator('#eq-oas details').first()).not.toBeVisible();
 await expect(page.locator('#eq-oas .variables')).toBeVisible();
 await page.locator('#cheat').uncheck();
 await page.locator('#theme').click();
 const theme=await page.locator('html').getAttribute('data-theme');
 await page.screenshot({path:'/private/tmp/fixed-income-dark.png'});
 await page.locator('#tab-glossary').click();
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 await expect(page.locator('#panel-glossary')).toBeVisible();
 await page.locator('#glossary-search').fill('zzzzzzz');
 await expect(page.locator('#glossary-count')).toContainText('0 of');
 await page.locator('#global-search').fill('haircut');
 await page.locator('#search-results .result').filter({hasText:'Haircut'}).first().click();
 await expect(page.locator('#glossary-list')).toContainText('Haircut');
 expect(errors).toEqual([]);
});
test('internal links, risk matrix and print layouts',async({page})=>{
 const errors=await open(page);
 const broken=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)).filter(id=>!document.getElementById(id)));
 expect(broken).toEqual([]);
 const cellCounts=await page.locator('#matrix-table tr').evaluateAll(rows=>rows.map(r=>r.children.length));
 expect(new Set(cellCounts)).toEqual(new Set([10]));
 await page.locator('#tab-math').click();
 await page.locator('#equation-search').fill('zero');
 await page.evaluate(()=>__FIXED_INCOME_TEST__.preparePrint());
 await page.emulateMedia({media:'print'});
 for(const tab of ['foundations','math','risk','modern','then','lab','glossary','sources'])await expect(page.locator('#panel-'+tab)).toBeVisible();
 await expect(page.locator('.equation-card')).toHaveCount(44);
 await expect(page.locator('#eq-oas .explanation').first()).toBeVisible();
 await page.pdf({path:'/private/tmp/fixed-income-reference.pdf',format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});
 await page.evaluate(()=>__FIXED_INCOME_TEST__.restorePrint());
 await page.emulateMedia({media:'screen'});
 await page.locator('#cheat').check();
 await page.evaluate(()=>__FIXED_INCOME_TEST__.preparePrint());
 await page.emulateMedia({media:'print'});
 await expect(page.locator('#panel-risk')).not.toBeVisible();
 await expect(page.locator('#eq-oas .variables')).toBeVisible();
 await expect(page.locator('#eq-oas details').first()).not.toBeVisible();
 await page.pdf({path:'/private/tmp/fixed-income-cheat-sheet.pdf',format:'A4',printBackground:true});
 expect(errors).toEqual([]);
});
test('storage denial does not prevent local work',async({page})=>{
 await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')};Storage.prototype.getItem=function(){throw new DOMException('Denied','SecurityError')}});
 const errors=await open(page);
 await page.locator('#theme').click();
 await expect(page.locator('#status')).toContainText('could not be saved');
 await page.locator('#tab-lab').click();
 await expect(page.locator('#credit-result')).toContainText('$12,000.00');
 expect(errors).toEqual([]);
});
