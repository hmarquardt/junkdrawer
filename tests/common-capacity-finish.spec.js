const {test,expect}=require('@playwright/test');
const path=require('path');

/* Regression coverage added by the product finish pass:
   navigation reachability, the "Your Congress" location resolver and its
   failure paths, privacy of coordinates, composer integration, and the
   content additions. Loads over file:// like the main suite. */

function watchErrors(page){
  const errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  return errs;
}

const PAGE_URL='file://'+path.resolve('common-capacity.html');
const NAV_WIDTHS=[320,360,390,414,768,940,941,1024,1100,1180,1181,1280,1440];

test('navigation: exactly one system is reachable at every width, with no overflow', async ({page})=>{
  for(const w of NAV_WIDTHS){
    await page.setViewportSize({width:w,height:900});
    await page.goto(PAGE_URL);
    await page.waitForTimeout(220);
    const s=await page.evaluate(()=>{
      const nav=document.querySelector('nav.top'),btn=document.getElementById('navToggle');
      return {
        navVisible:!!nav&&nav.getBoundingClientRect().width>0,
        btnVisible:!!btn&&btn.getBoundingClientRect().width>0,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
      };
    });
    expect(s.navVisible&&s.btnVisible,`both navigation systems visible at ${w}px`).toBe(false);
    expect(s.navVisible||s.btnVisible,`no navigation reachable at ${w}px`).toBe(true);
    expect(s.btnVisible,`menu button should be the control at ${w}px`).toBe(w<1181);
    expect(s.overflow,`horizontal overflow at ${w}px`).toBe(0);
  }
});

test('mobile navigation opens, closes on Escape, and restores focus', async ({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);

  const nav=page.locator('#mobileNav'), btn=page.locator('#navToggle');
  await expect(nav).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded','false');

  await btn.click();
  await expect(nav).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded','true');

  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.activeElement.id)).toBe('navToggle');
});

test('mobile navigation closes when a destination is chosen', async ({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#navToggle').click();
  await expect(page.locator('#mobileNav')).toBeVisible();
  await page.locator('#mobileNav a[href="#sources"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#mobileNav')).toBeHidden();
});

test('mobile navigation does not survive a breakpoint transition into desktop', async ({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#navToggle').click();
  await expect(page.locator('#mobileNav')).toBeVisible();

  await page.setViewportSize({width:1280,height:900});
  await page.waitForTimeout(350);
  /* On desktop the toggle is display:none, so a panel left open would be undismissable. */
  await expect(page.locator('#mobileNav')).toBeHidden();
  expect(await page.evaluate(()=>document.querySelector('nav.top').getBoundingClientRect().width>0)).toBe(true);
});

/* ===========================================================================
   "Your Congress" — location resolution, failure paths, privacy.
   Geolocation is stubbed and the Census geocoder is intercepted so these
   tests are deterministic and never depend on the live Census service.
   =========================================================================== */
function censusBody(state,district){
  const fips=state==='CO'?'08':state==='AK'?'02':'06';
  const d=district<10?('0'+district):String(district);
  return {result:{geographies:{
    States:[{STUSAB:state,GEOID:'0'+fips}],
    '119th Congressional District':[{GEOID:fips+d,CD119:district}]
  }}};
}

async function stubCensus(page,mode,state,district){
  await page.route('**/geocoding.geo.census.gov/**',route=>{
    const parsed=/\bcallback=([^&]+)/.exec(route.request().url());
    const cb=parsed?decodeURIComponent(parsed[1]):'__ccMissing';
    const jsonp=b=>route.fulfill({status:200,contentType:'application/javascript',body:cb+'('+JSON.stringify(b)+')'});
    if(mode==='httpfail') return route.fulfill({status:503,body:'unavailable'});
    /* Loads successfully but never invokes the callback: the case that onerror misses. */
    if(mode==='malformed') return route.fulfill({status:200,contentType:'application/javascript',body:'window.__notTheCallback=1;'});
    if(mode==='empty') return jsonp({result:{geographies:{}}});
    return jsonp(censusBody(state,district));
  });
}

test('location: resolves a multi-district state and stores no coordinates', async ({browser})=>{
  const ctx=await browser.newContext({
    viewport:{width:1440,height:900},
    geolocation:{latitude:39.7392,longitude:-104.9903},permissions:['geolocation']
  });
  const page=await ctx.newPage();
  const errs=watchErrors(page);
  const remote=[];
  page.on('request',r=>{ if(!r.url().startsWith('file://')) remote.push(r.url()); });
  await stubCensus(page,'ok','CO',1);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#ycGeo').click();
  await page.waitForTimeout(1000);

  const names=await page.locator('#ycResults .yc-card .yc-name').allInnerTexts();
  expect(names.length,'one Representative plus two Senators').toBe(3);
  expect(names[0]).toContain('DeGette');                       /* CO-01 */
  expect(await page.locator('#ycResults .yc-card .yc-sub').first().innerText()).toContain('district 1');

  const store=await page.evaluate(()=>localStorage.getItem('common-capacity.v1'));
  expect(store).toContain('"state":"CO"');
  expect(store).toContain('"district":1');
  expect(store).not.toMatch(/latitude|longitude|"lat"|"lon"|\d+\.\d{4,}/);

  expect(remote.length,'only the Census geocoder should be requested').toBe(1);
  expect(remote[0]).toContain('geocoding.geo.census.gov');
  expect(errs,errs.join('\n')).toHaveLength(0);
  await ctx.close();
});

test('location: resolves an at-large district to a single House seat', async ({browser})=>{
  const ctx=await browser.newContext({
    viewport:{width:390,height:900},
    geolocation:{latitude:61.2181,longitude:-149.9003},permissions:['geolocation']
  });
  const page=await ctx.newPage();
  await stubCensus(page,'ok','AK',0);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#ycGeo').click();
  await page.waitForTimeout(1000);

  const names=await page.locator('#ycResults .yc-card .yc-name').allInnerTexts();
  expect(names.length).toBe(3);
  expect(names[0]).toContain('Begich');
  expect((await page.locator('#ycResults .yc-card .yc-sub').allInnerTexts())[0]).toContain('at-large');
  await ctx.close();
});

test('location: every failure path ends in specific guidance, never an endless spinner', async ({browser})=>{
  const cases=[
    {label:'permission denied',   mode:'ok',        deny:true,  expect:/blocked the location request/},
    {label:'Census malformed',    mode:'malformed', deny:false, expect:/could not read/},
    {label:'Census unreachable',  mode:'httpfail',  deny:false, expect:/could not be reached/},
    {label:'no district returned',mode:'empty',     deny:false, expect:/could not place inside a congressional district/}
  ];
  for(const c of cases){
    const ctx=await browser.newContext({
      viewport:{width:1280,height:900},
      geolocation:{latitude:39.7392,longitude:-104.9903},permissions:['geolocation']
    });
    const page=await ctx.newPage();
    await stubCensus(page,c.mode,'CO',1);
    if(c.deny){
      await page.addInitScript(()=>{
        navigator.geolocation.getCurrentPosition=(ok,err)=>err({code:1,message:'denied'});
      });
    }
    await page.goto(PAGE_URL);
    await page.waitForTimeout(400);
    await page.locator('#ycGeo').click();
    await page.waitForTimeout(1400);
    const status=await page.locator('#ycStatus').innerText();
    expect(status,c.label+' produced no guidance').toMatch(c.expect);
    expect(await page.locator('#ycManualBtn').isVisible(),c.label+' hid the manual fallback').toBe(true);
    await ctx.close();
  }
});
test('manual fallback: state alone yields both senators, then district adds the representative', async ({page})=>{
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#ycManualBtn').click();
  await expect(page.locator('#ycManual')).toBeVisible();
  await expect(page.locator('#ycManualBtn')).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#ycState option').count()).toBeGreaterThan(50);

  await page.selectOption('#ycState','CA');
  await page.waitForTimeout(400);
  let names=await page.locator('#ycResults .yc-card .yc-name').allInnerTexts();
  expect(names.length,'senators should appear before a district is chosen').toBe(2);
  await expect(page.locator('#ycDistWrap')).toBeVisible();

  await page.selectOption('#ycDistrict','12');
  await page.waitForTimeout(400);
  names=await page.locator('#ycResults .yc-card .yc-name').allInnerTexts();
  expect(names.length).toBe(3);
  expect(names[0]).toContain('Simon');                          /* CA-12 */
  /* the full directory remains available as an advanced fallback */
  expect(await page.locator('#congress').count()).toBe(1);
});

test('location persists state and district only, and Reset Local Data removes them', async ({page})=>{
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#ycManualBtn').click();
  await page.selectOption('#ycState','CA');
  await page.waitForTimeout(300);
  await page.selectOption('#ycDistrict','12');
  await page.waitForTimeout(400);

  const stored=await page.evaluate(()=>localStorage.getItem('common-capacity.v1'));
  expect(stored).toContain('"state":"CA"');
  expect(stored).toContain('"district":12');

  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.locator('#ycResults')).toBeVisible();
  expect((await page.locator('#ycResults .yc-card .yc-name').allInnerTexts()).length).toBe(3);

  await page.locator('#resetData').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(()=>localStorage.getItem('common-capacity.v1'))).toBeNull();
});

/* ===========================================================================
   Privacy / network behaviour.
   =========================================================================== */
test('privacy: no network request occurs on load, and analytics is absent', async ({page})=>{
  const remote=[];
  page.on('request',r=>{ if(!r.url().startsWith('file://')) remote.push(r.url()); });
  await page.goto(PAGE_URL);
  await page.waitForTimeout(1400);
  expect(remote,'the artifact should make no network request on load').toHaveLength(0);
  expect((await page.content()).includes('analytics-lite.js'),'analytics should be removed').toBe(false);
});

test('privacy: precise coordinates never reach localStorage', async ({browser})=>{
  const ctx=await browser.newContext({
    viewport:{width:1280,height:900},
    geolocation:{latitude:39.7392,longitude:-104.9903},permissions:['geolocation']
  });
  const page=await ctx.newPage();
  await stubCensus(page,'ok','CO',1);
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);
  await page.locator('#ycGeo').click();
  await page.waitForTimeout(1000);
  const dump=await page.evaluate(()=>{
    const out={};
    for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); out[k]=localStorage.getItem(k); }
    return JSON.stringify(out);
  });
  expect(dump).not.toContain('39.7392');
  expect(dump).not.toContain('-104.9903');
  await ctx.close();
});

/* ===========================================================================
   Composer integration with a personalized member.
   =========================================================================== */
test('composer: a personalized member sets the salutation and keeps the chosen principles', async ({page})=>{
  await page.goto(PAGE_URL);
  await page.waitForTimeout(400);

  await page.locator('#prinList input[value="proportional"]').check();
  await page.locator('#prinList input[value="competition"]').check();
  await page.waitForTimeout(250);

  await page.locator('#ycManualBtn').click();
  await page.selectOption('#ycState','CA');
  await page.waitForTimeout(300);
  await page.selectOption('#ycDistrict','12');
  await page.waitForTimeout(400);

  await page.locator('#ycResults button[data-write]').first().click();
  await page.waitForTimeout(400);

  expect((await page.locator('#cText').inputValue()).split('\n')[0]).toBe('Dear Representative Simon,');
  await expect(page.locator('#cRecipient')).toContainText('Simon');
  /* the principles the visitor chose must survive recipient selection */
  expect(await page.locator('#prinList input:checked').count()).toBe(2);
  await expect(page.locator('#cText')).toBeEditable();
});

/* ===========================================================================
   Content additions required by the finish pass.
   =========================================================================== */
test('policy: export controls are represented with a primary-source citation', async ({page})=>{
  await page.goto(PAGE_URL);
  await page.waitForTimeout(700);
  const card=page.locator('#policyList .pcard',{hasText:'export controls'}).first();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Who it covers');
  await expect(card.locator('dl dd a').last()).toHaveAttribute('href',/federalregister\.gov|bis\.gov/);
});

test('capture: advocacy is documented as multi-sided with disclosed figures', async ({page})=>{
  await page.goto(PAGE_URL);
  await page.waitForTimeout(700);
  const table=page.locator('table.lda');
  await expect(table).toHaveCount(1);
  await expect(table.locator('tbody tr')).toHaveCount(3);
  /* both industry and a safety-focused advocacy organisation must appear */
  await expect(table).toContainText('Center for AI Safety Action Fund');
  await expect(table).toContainText('Anthropic');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
});

test('layout: no section pushes the page into horizontal overflow at any width', async ({page})=>{
  for(const w of [320,360,390,414,768,1024,1440]){
    await page.setViewportSize({width:w,height:900});
    await page.goto(PAGE_URL);
    await page.waitForTimeout(450);
    const ov=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(ov,`horizontal overflow at ${w}px`).toBe(0);
  }
});
