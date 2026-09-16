const {test,expect}=require('@playwright/test');
const path=require('path');

/* Validation for common-capacity.html — single-file civic information tool.
   Loads over file:// to prove the artifact works with no server. */

function watchErrors(page){
  const errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{
    if(m.type()!=='error') return;
    const t=m.text();
    // the page-view counter is a third-party beacon; under file:// the browser
    // blocks it on CORS. That is expected and not a defect in this artifact.
    if(/aismallbizguru\.com|ERR_FAILED|CORS policy/.test(t)) return;
    errs.push('console: '+t);
  });
  return errs;
}

const URL='file://'+path.resolve('common-capacity.html');

test('loads with no console errors and renders every section', async ({page})=>{
  const errs=watchErrors(page);
  await page.goto(URL);
  await page.waitForTimeout(700);

  for(const id of ['argument','counterfactual','capture','benefits','competition','opensource',
                   'steelman','principles','policy','committees','congress','composer','sources']){
    await expect(page.locator('#'+id)).toHaveCount(1);
  }
  expect(await page.locator('#prinList label.prin').count()).toBe(16);
  expect(await page.locator('#policyList .pcard').count()).toBeGreaterThanOrEqual(10);
  expect(await page.locator('#commBody tr').count()).toBeGreaterThanOrEqual(10);
  expect(await page.locator('#memberList .mcard').count()).toBeGreaterThanOrEqual(20);
  expect(await page.locator('#srcGroups .sitem').count()).toBeGreaterThanOrEqual(20);

  const body=await page.locator('body').innerText();
  expect(body).not.toContain('<!--');
  expect(body).not.toContain('MEMBERS_DATA');
  expect(errs,errs.join('\n')).toHaveLength(0);
});

test('counterfactual tabs switch and are keyboard operable', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(500);
  await expect(page.locator('#cfpanel-pc')).toBeVisible();
  await page.locator('#cftab-cloud').click();
  await expect(page.locator('#cfpanel-cloud')).toBeVisible();
  await expect(page.locator('#cfpanel-pc')).toBeHidden();
  for(const id of ['cfpanel-pc','cfpanel-net','cfpanel-oss','cfpanel-cloud']){
    expect(await page.locator('#'+id+' .breaks').count()).toBe(1);
  }
  await page.locator('#cftab-net').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#cfpanel-oss')).toBeVisible();
});

test('principles drive the composer and persist locally', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(500);
  expect(await page.locator('#prinList input:checked').count()).toBe(0);
  const firstText=await page.locator('#cText').inputValue();
  expect(firstText).toContain('Dear Representative or Senator');
  await page.locator('#prinList input[value="proportional"]').check();
  await page.locator('#prinList input[value="nolicense"]').check();
  const after=await page.locator('#cText').inputValue();
  expect(after).toContain('scale with demonstrated capability and risk');
  expect(after).toContain('general-purpose software development');
  expect(await page.locator('#prinSummary li').count()).toBeGreaterThan(0);

  await page.reload();
  await page.waitForTimeout(500);
  expect(await page.locator('#prinList input:checked').count()).toBe(2);

  await page.locator('#resetData').click();
  await page.waitForTimeout(200);
  expect(await page.locator('#prinList input:checked').count()).toBe(0);
});

test('congress console filters, and no mailto is ever fabricated', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  expect(await page.locator('#memberList .mcard').count()).toBeGreaterThan(0);

  await page.selectOption('#mState','MA');
  await page.waitForTimeout(300);
  expect(await page.locator('#memberList .mcard').count()).toBeGreaterThan(0);
  expect(await page.locator('#memberList').innerText()).toContain('Massachusetts');

  const callHrefs=await page.locator('#memberList a.call').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
  expect(callHrefs.length).toBeGreaterThan(0);
  for(const h of callHrefs) expect(h.startsWith('tel:+1')).toBe(true);

  const html=await page.content();
  expect(html).not.toMatch(/mailto:[a-z]/i);

  await page.locator('.chips .chip[data-filter="seat"]').click();
  await page.waitForTimeout(300);
  expect(await page.locator('#memberList .mcard').count()).toBeGreaterThan(0);
});

test('selecting an office addresses the message and reports the route honestly', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.selectOption('#mState','MA');
  await page.waitForTimeout(300);
  await page.locator('#memberList button[data-write]').first().click();
  await page.waitForTimeout(300);
  expect(await page.locator('#cRecipient').innerText()).not.toBe('no office selected');
  expect(await page.locator('#cText').inputValue()).toMatch(/Dear (Senator|Representative) /);
  expect(await page.locator('#cRecipientNote').innerText()).toMatch(/How this office receives messages/);

  await page.locator('#styleList button[data-style="call"]').click();
  await page.waitForTimeout(200);
  const script=await page.locator('#cText').inputValue();
  expect(script).toContain('PHONE SCRIPT');
  expect(script).not.toContain('Dear Senator');
  await expect(page.locator('#styleList button[data-style="call"]')).toHaveAttribute('aria-pressed','true');
});

test('no dead controls: a hidden action never renders, and no email route is faked', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);

  // No element carrying [hidden] may occupy layout — a dead href="#" button is worse than no button.
  const leaked=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('[hidden]').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width>0||r.height>0) out.push(el.id||el.tagName+'.'+el.className);
    });
    return out;
  });
  expect(leaked,leaked.join(', ')).toHaveLength(0);

  // The email route stays absent until an office publishes a constituent address, and
  // the page must never invent one. With no office selected it cannot be shown at all.
  await expect(page.locator('#cMail')).toBeHidden();
  expect(await page.locator('#cMail').getAttribute('href')).toBeNull();

  // Selecting an office still must not surface a guessed address.
  await page.selectOption('#mState','MA');
  await page.waitForTimeout(300);
  await page.locator('#memberList button[data-write]').first().click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cMail')).toBeHidden();
  const hrefs=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a=>a.getAttribute('href')));
  expect(hrefs).toHaveLength(0);
});

test('policy, sources and methodology stay honest', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  const policy=(await page.locator('#policyList').innerText()).toLowerCase();
  expect(policy).toContain('pending in committee');
  expect(policy).toMatch(/not law|draft released|recommendations to congress/);
  expect(policy).toMatch(/not verified|we did not verify/);

  const sources=await page.locator('#sources').innerText();
  expect(sources).toContain('Could not be verified');
  expect(sources).toContain('No cookies are set by this page');

  const cf=await page.locator('#counterfactual').innerText();
  expect(cf).toMatch(/hypothetical/i);
  expect(cf).toContain('Where the analogy breaks');
});

test('every in-page anchor resolves after the data renders', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(700);
  const missing=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('a[href^="#"]').forEach(a=>{
      const id=a.getAttribute('href').slice(1);
      if(id && !document.getElementById(id)) out.push(id);
    });
    return [...new Set(out)];
  });
  expect(missing,missing.join(', ')).toHaveLength(0);
});

test('section order reads as one argument, and each section closes its markup', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(700);
  const order=await page.evaluate(()=>{
    const ids=['argument','counterfactual','capture','benefits','competition','opensource',
               'steelman','principles','policy','committees','congress','composer','sources'];
    return ids.map(id=>{
      const el=document.getElementById(id);
      const sec=el.tagName==='SECTION'?el:el.closest('section');
      return {id,top:Math.round(sec.getBoundingClientRect().top)};
    });
  });
  for(let i=1;i<order.length;i++){
    expect(order[i].top,order[i-1].id+' should precede '+order[i].id).toBeGreaterThan(order[i-1].top);
  }
  // nesting sanity: no section may contain another section's opening content
  expect(await page.locator('section#opensource .os-split').count()).toBe(1);
  expect(await page.locator('section#competition .ruler + .g2').count()).toBe(1);
  expect(await page.locator('section#steelman .steel + .g2').count()).toBe(1);
  expect(await page.locator('section#steelman .card[class*="case"]').count()).toBe(2);
});

test('mobile layout does not scroll horizontally', async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(URL);
  await page.waitForTimeout(700);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#navToggle').click();
  await expect(page.locator('#mobileNav')).toBeVisible();
});
