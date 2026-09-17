const {test,expect}=require('@playwright/test');
const path=require('path');
const fs=require('fs');

/* Validation for common-capacity.html — single-file civic information tool.
   Loads over file:// to prove the artifact works with no server. */

function watchErrors(page){
  const errs=[];
  page.on('pageerror',e=>errs.push('pageerror: '+e.message));
  page.on('console',m=>{
    if(m.type()!=='error') return;
    errs.push('console: '+m.text());
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

/* ---------------------------------------------------------------------------
   Regression guards added after an independent audit found that the original
   mobile test checked only 390px. Real horizontal overflow existed at 320/360
   (the benefits grid) and at 1024 (the header), so the suite now sweeps widths.
   --------------------------------------------------------------------------- */
test('no horizontal overflow at any audited viewport width', async ({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto(URL);
  await page.waitForTimeout(700);
  const bad=[];
  for(const w of [320,360,390,414,768,834,1024,1180,1280,1440]){
    await page.setViewportSize({width:w,height:900});
    await page.waitForTimeout(250);
    const r=await page.evaluate(()=>{
      const de=document.documentElement, vw=de.clientWidth, offenders=[];
      document.querySelectorAll('body *').forEach(el=>{
        const rc=el.getBoundingClientRect();
        if(rc.width===0||rc.height===0) return;
        if(rc.right>vw+1){
          // an element inside an intentional horizontal scroller is not a defect
          let a=el.parentElement,clipped=false;
          while(a&&a!==document.body){
            const ox=getComputedStyle(a).overflowX;
            if(ox==='auto'||ox==='scroll'||ox==='hidden'){clipped=true;break;}
            a=a.parentElement;
          }
          if(!clipped) offenders.push(el.tagName+'.'+(el.className||'').toString().split(' ')[0]);
        }
      });
      return {overflow:de.scrollWidth-vw,offenders:[...new Set(offenders)].slice(0,5)};
    });
    if(r.overflow>1) bad.push(`${w}px: overflow ${r.overflow}px from [${r.offenders.join(', ')}]`);
  }
  expect(bad,bad.join('\n')).toHaveLength(0);
});

test('the full nav yields to the menu button exactly where it stops fitting', async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto(URL);
  await page.waitForTimeout(700);

  // Wide: inline nav shown, menu button must NOT be visible. The button also carries
  // .btn{display:inline-flex}, which is why the hide rule must out-specify .btn.
  await expect(page.locator('nav.top')).toBeVisible();
  await expect(page.locator('#navToggle')).toBeHidden();

  // Narrow: brand (176) + links (903) exceed the viewport, so the inline nav must go.
  await page.setViewportSize({width:1024,height:900});
  await page.waitForTimeout(250);
  await expect(page.locator('nav.top')).toBeHidden();
  await expect(page.locator('#navToggle')).toBeVisible();
  await page.locator('#navToggle').click();
  await expect(page.locator('#mobileNav')).toBeVisible();
});

test('with no principles selected the composer asks for a position instead of asserting one', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(700);
  expect(await page.locator('#prinList input:checked').count()).toBe(0);

  const draft=await page.locator('#cText').inputValue();
  // It may say the visitor has not settled on a position...
  expect(draft).toMatch(/not yet settled|ask for the office's position|ask a question/);
  // ...but it must not present the site's own policy asks as the visitor's own.
  for(const phrase of [
    'scale with demonstrated capability and risk',
    'keep compliance achievable for smaller developers',
    'thresholds would trigger obligations',
    'I do support serious safeguards'
  ]){
    expect(draft,`"${phrase}" must not appear before the visitor selects a principle`).not.toContain(phrase);
  }

  // Every style must behave the same way when nothing is selected.
  for(const id of ['call','short','smallbiz','oss','research','competitiveness','riskaware','long']){
    await page.locator(`#styleList button[data-style="${id}"]`).click();
    await page.waitForTimeout(150);
    const t=await page.locator('#cText').inputValue();
    expect(t,`style ${id} must not assert an unselected principle`).not.toContain('scale with demonstrated capability and risk');
    expect(t).toMatch(/ask|question|not yet settled/i);
  }

  // Selecting a principle is exactly what introduces the substantive ask.
  await page.locator('#styleList button[data-style="short"]').click();
  await page.locator('#prinList input[value="proportional"]').check();
  await page.waitForTimeout(250);
  expect(await page.locator('#cText').inputValue()).toContain('scale with demonstrated capability and risk');
});

test('the congressional dataset contains no malformed or non-https contact URLs', async ({page})=>{
  // The page wraps its script in an IIFE, so MEMBERS is deliberately not on window.
  // Read the shipped data block from source instead of widening the artifact's surface.
  const src=fs.readFileSync(path.resolve('common-capacity.html'),'utf8');
  const arr=src.match(/var MEMBERS = (\[[\s\S]*?\]);/);
  expect(arr, 'MEMBERS data block must exist').toBeTruthy();
  const rows=JSON.parse(arr[1]);
  expect(rows.length).toBeGreaterThan(400);

  const problems=[];
  const missingSite=[];
  rows.forEach(r=>{
    const [bg,name,type,state,dist,party,site,form]=r;
    expect(bg,`${name}: missing bioguide id`).toBeTruthy();
    expect(['H','S']).toContain(type);
    expect(state,`${name}: missing state`).toBeTruthy();
    expect(['D','R','I'],`${name}: unexpected party code`).toContain(party);
    // a Washington office number is published for every office
    expect(r[8],`${name}: missing Washington office phone`).toMatch(/^202-\d{3}-\d{4}$/);
    if(!site) missingSite.push(`${name} (${state}-${dist})`);
    [['site',site],['form',form]].forEach(([field,u])=>{
      if(!u) return;
      if(!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) problems.push(`${name}: ${field} is not an absolute https URL -> ${u}`);
    });
  });
  expect(problems,problems.join('\n')).toHaveLength(0);

  // Every office now carries an official site. The three newest members whose pages had
  // not yet propagated into the upstream dataset were verified directly against their
  // official house.gov sites and their /contact pages; nothing was pattern-guessed.
  expect(missingSite,`unexpectedly many members without a site:\n${missingSite.join('\n')}`).toHaveLength(0);

  // the specific record repaired after the audit: a stray "h" had made it unparseable,
  // and the underlying /contact/email-me path 404s on that member's site.
  const fine=rows.find(r=>r[0]==='F000484');
  expect(fine).toBeTruthy();
  expect(fine[7]).toBe('https://fine.house.gov/contact');

  // rendered links must be https only, and an office with no known website must
  // still expose a working call route and the write-to-this-office action.
  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.selectOption('#mState','CA');
  await page.waitForTimeout(300);
  const badHrefs=await page.locator('#memberList a[data-form],#memberList a[data-site]')
    .evaluateAll(as=>as.map(a=>a.getAttribute('href')).filter(h=>!/^https:\/\//.test(h)));
  expect(badHrefs,badHrefs.join(', ')).toHaveLength(0);

  const gallagher=page.locator('#m-G000607');
  if(await gallagher.count()){
    await expect(gallagher.locator('a.call')).toHaveCount(1);
    await expect(gallagher.locator('button[data-write]')).toHaveCount(1);
    // verified official site and contact page, not invented
    await expect(gallagher.locator('a[data-site]')).toHaveCount(1);
    await expect(gallagher.locator('a[data-form]')).toHaveCount(1);
    await expect(gallagher.locator('a[data-site]')).toHaveAttribute('href','https://gallagher.house.gov');
  }
});

test('counterfactual baselines quote verifiable figures and state their limits', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  const pc=await page.locator('#cfpanel-pc').innerText();
  expect(pc).toContain('$439');
  expect(pc).toContain('$621');
  expect(pc).not.toContain('$395');
  for(const id of ['cfpanel-pc','cfpanel-net','cfpanel-oss','cfpanel-cloud']){
    const t=await page.locator('#'+id).innerText();
    // each panel must be flagged hypothetical (innerText reflects text-transform,
    // so this label renders in capitals)
    expect(t,id).toMatch(/hypothetical overlay/i);
    expect(t,id).toMatch(/where the analogy breaks/i);
    // and it must state uncertainty rather than assert an outcome
    expect(t,id).toMatch(/cannot be known|can only reason|conceivable|plausible/i);
    // and cite a source affordance
    expect(t,id).toMatch(/sources/i);
  }
});

test('muted body text meets WCAG AA contrast on the page background', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  const results=await page.evaluate(()=>{
    const parse=c=>c.match(/[\d.]+/g).map(Number).slice(0,3);
    const lum=rgb=>{const [r,g,b]=rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const ratio=(a,b)=>{const la=lum(a),lb=lum(b);return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);};
    const bgOf=el=>{let e=el;while(e){const c=getComputedStyle(e).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)')return parse(c);e=e.parentElement;}return [255,255,255];};
    const out=[];
    ['.smeta','.chint','.m','.pcard dt','.srctier','.tl-item em','footer.jf','.mcard .mmeta','.bcard .caveat','.prov .lbl'].forEach(sel=>{
      const el=document.querySelector(sel);
      if(!el) return;
      const cs=getComputedStyle(el);
      out.push({sel,size:cs.fontSize,ratio:+ratio(parse(cs.color),bgOf(el)).toFixed(2)});
    });
    return out;
  });
  const fails=results.filter(r=>r.ratio<4.5).map(r=>`${r.sel} (${r.size}) = ${r.ratio}:1`);
  expect(fails,fails.join('\n')).toHaveLength(0);
});

test('heading levels never skip, so screen-reader navigation stays intact', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(800);
  const skips=await page.evaluate(()=>{
    const hs=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const out=[];
    for(let i=1;i<hs.length;i++){
      const prev=+hs[i-1].tagName[1], cur=+hs[i].tagName[1];
      if(cur-prev>1) out.push(`${hs[i-1].tagName} -> ${hs[i].tagName} "${hs[i].textContent.trim().slice(0,40)}"`);
    }
    return out;
  });
  expect(skips,skips.join('\n')).toHaveLength(0);
  // and the converted label headings keep their compact uppercase treatment
  const styled=await page.locator('#capture h3.clabel').first().evaluate(el=>{
    const c=getComputedStyle(el);
    return {transform:c.textTransform,weight:+c.fontWeight};
  });
  expect(styled.transform).toBe('uppercase');
  expect(styled.weight).toBeGreaterThanOrEqual(700);
});


/* ------------------------------------------------------------------
   Regression tests added by the independent red-team audit. Each one pins a
   defect that actually shipped, so it cannot come back silently.
   Convention matches the rest of this file: read the shipped data from source,
   because the artifact keeps its data inside an IIFE and off `window`.
   ------------------------------------------------------------------ */

function readSourceItems(){
  const src=fs.readFileSync(path.resolve('common-capacity.html'),'utf8');
  const items=[];
  const re=/id:"([A-Za-z0-9-]+)"([^}]*?)url:"([^"]+)"/g;
  let m;
  while((m=re.exec(src))){
    const claim=(m[2].match(/claim:"((?:\\.|[^"\\])*)"/)||[])[1]||'';
    items.push({id:m[1],url:m[3],claim});
  }
  return {src,items};
}

test('every member office has an official site and a Washington phone — no blank routes', async ({page})=>{
  /* Regression: three of the newest members shipped with an empty website field, leaving a
     visitor no route to the office except the phone number. Every office must now carry an
     official congressional site, and no client-era record may be left blank. */
  const src=fs.readFileSync(path.resolve('common-capacity.html'),'utf8');
  const arr=src.match(/var MEMBERS = (\[[\s\S]*?\]);/);
  expect(arr,'MEMBERS data block must exist').toBeTruthy();
  const rows=JSON.parse(arr[1]);

  const noSite=[], noPhone=[], offDomain=[];
  rows.forEach(r=>{
    const [bg,name,,, , ,site,form,phone]=r;
    if(!site) noSite.push(`${name} ${bg}`);
    if(!phone) noPhone.push(`${name} ${bg}`);
    [site,form].filter(Boolean).forEach(u=>{
      if(!/^https:\/\/([a-z0-9-]+\.)*(house|senate)\.gov(\/|$)/i.test(u)) offDomain.push(`${name}: ${u}`);
    });
  });
  expect(noSite,noSite.join(', ')).toHaveLength(0);
  expect(noPhone,noPhone.join(', ')).toHaveLength(0);
  expect(offDomain,offDomain.join('\n')).toHaveLength(0);

  // the three records repaired in this revision, pinned exactly
  const expectSite={'B001328':'https://blair.house.gov','G000607':'https://gallagher.house.gov','W000832':'https://wahab.house.gov'};
  Object.entries(expectSite).forEach(([bg,site])=>{
    const r=rows.find(x=>x[0]===bg);
    expect(r,`${bg} should still be present`).toBeTruthy();
    expect(r[6]).toBe(site);
    expect(r[7]).toBe(site+'/contact');
  });

  // and the repaired office renders a live website action, not just a phone
  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.selectOption('#mState','CA');
  await page.waitForTimeout(300);
  const gallagher=page.locator('#m-G000607');
  if(await gallagher.count()){
    await expect(gallagher.locator('a[data-site]')).toHaveCount(1);
    await expect(gallagher.locator('a[data-form]')).toHaveCount(1);
  }
});

test('no substantive source is cited only by a bare domain root', async ()=>{
  /* Regression: several sources named a specific primary document in the publisher field
     while linking a generic homepage or an encyclopedia, so a reader could not reach the
     evidence. Bare roots are now allowed only where the site itself IS the resource. */
  const {items}=readSourceItems();
  /* These are deliberately outlet-level pointers: the specific permalinks could not be
     verified from this build, so each entry carries an explicit citation note telling the
     reader that the primary record lives elsewhere. They are allowlisted rather than guessed.
     alphafold.ebi.ac.uk is allowlisted because the database root IS the resource, and
     w3.org/WAI because that section IS the accessibility resource being cited. */
  const allowed=new Set([
    'https://alphafold.ebi.ac.uk/',
    'https://www.cnbc.com/',
    'https://issueone.org/'
  ]);
  expect(items.length).toBeGreaterThan(30);
  // NB: `URL` is shadowed at the top of this file by the page's file:// URL, so the
  // parser must be resolved explicitly from globalThis.
  const roots=items.filter(({url})=>{
    try{
      const u=new globalThis.URL(url);
      return (u.pathname===''||u.pathname==='/') && !u.search;
    }catch(e){ return true; }
  });
  const unexpected=roots.filter(r=>!allowed.has(r.url)).map(r=>`${r.id} -> ${r.url}`);
  expect(unexpected,unexpected.join('\n')).toHaveLength(0);
});

test('no source cites a generic section root instead of the record itself', async ()=>{
  /* Regression: four sources named a specific document or finding in the publisher field
     while linking a section root — a journal homepage (/qje), a book publisher's front door,
     an outlet root, and a company news index. A reader following those links could not reach
     the evidence, which is citation laundering even when the underlying fact is true.
     A URL must now carry an identifier: a DOI, an article path, a record path, or a PDF. */
  const {items}=readSourceItems();
  /* Legitimate exceptions: the whole site IS the resource being cited. */
  const allowed=new Set([
    'https://alphafold.ebi.ac.uk/',
    'https://www.w3.org/WAI/',
    'https://www.cnbc.com/',
    'https://issueone.org/'
  ]);
  /* A path segment that names a format/container rather than a document. */
  const generic=new Set(['about','news','blog','press','contact','index.html','en','public','qje','core']);
  const shallow=items.filter(({url})=>{
    if(allowed.has(url)) return false;
    let u; try{ u=new globalThis.URL(url); }catch(e){ return true; }
    if(/\.pdf$/i.test(u.pathname)) return false;                 // a PDF is the document
    if(/(^|\.)doi\.org$/.test(u.hostname)) return false;         // a DOI is an identifier
    const segs=u.pathname.split('/').filter(Boolean);
    if(segs.length===0) return true;                             // bare root
    return segs.length===1 && generic.has(segs[0].toLowerCase());
  }).map(r=>`${r.id} -> ${r.url}`);
  expect(shallow,`these sources do not link the document they name:\n${shallow.join('\n')}`).toHaveLength(0);
});

test('the corrected research and baseline citations point at the record', async ()=>{
  const {items}=readSourceItems();
  const url=id=>{const it=items.find(x=>x.id===id);return it?it.url:null;};
  /* Each of these previously pointed somewhere that did not carry the cited claim. */
  expect(url('s-brynjolfsson'),'QJE study must resolve to the article, not the journal root').toMatch(/^https:\/\/doi\.org\/10\.1093\/qje\//);
  expect(url('s-capture-book'),'capture text must resolve to the book, not the publisher root').toMatch(/^https:\/\/doi\.org\/10\.1017\//);
  expect(url('s-cern-www'),'the CERN baseline linked a dead URL').toMatch(/^https:\/\/info\.cern\.ch\//);
  expect(url('src-ft-lobbying'),'lobbying item must point at the primary disclosure database').toMatch(/^https:\/\/lda\.senate\.gov\//);
  const rento=items.find(x=>x.id==='s-rentosertib');
  expect(rento,'s-rentosertib must exist').toBeTruthy();
  expect(rento.url,'the drug-discovery item must cite a peer-reviewed record, not a company news index').toMatch(/^https:\/\/doi\.org\//);
  expect(rento.claim,'the unverifiable journal attribution must not survive').not.toMatch(/Nature Medicine/);
  /* And the visible card must not claim a provenance label the citation cannot support. */
  const src=fs.readFileSync(path.resolve('common-capacity.html'),'utf8');
  const card=src.match(/<h3>AI-assisted drug discovery<\/h3>[\s\S]{0,1400}?<\/div>\s*<\/div>/);
  expect(card,'the drug-discovery card must exist').toBeTruthy();
  expect(card[0]).not.toMatch(/Nature Medicine/);
});

test('counterfactual baselines cite the record that carries the number', async ()=>{
  /* Regression: the Altair baseline displayed a primary price list as its source while
     linking an encyclopedia, and the Bernstein baseline did the same while claiming court
     records. The linked page must now be described accurately, and the primary litigation
     record linked directly. */
  const {src,items}=readSourceItems();
  const url=id=>{const it=items.find(x=>x.id===id);return it?it.url:null;};

  const altairBlock=src.match(/id:"s-altair"[^}]*?publisher:"((?:\\.|[^"\\])*)"/);
  expect(altairBlock, 's-altair entry must exist').toBeTruthy();
  expect(altairBlock[1]).toMatch(/Wikipedia/i);
  expect(altairBlock[1]).toMatch(/tertiary/i);

  expect(url('s-crypto-export')).toMatch(/^https:\/\/www\.eff\.org\/cases\//);
  expect(url('s-crypto-export-court')).toMatch(/^https:\/\/law\.justia\.com\//);

  // specific records replaced generic roots for the research citations
  expect(url('s-synthesis')).toMatch(/\.pdf$/);
  expect(url('s-metr')).toMatch(/\/blog\//);
  expect(url('s-alab')).toMatch(/nature\.com\/articles\//);
  expect(url('s-aitutor')).toMatch(/nature\.com\/articles\//);
  expect(url('s-stigler')).toMatch(/jstor\.org\/stable\//);
  expect(url('s-cloud-2006')).toMatch(/aws\.amazon\.com\/about-aws\/whats-new\/2006\//);
});

test('nothing pending is described as law, and every policy item is dated', async ()=>{
  const src=fs.readFileSync(path.resolve('common-capacity.html'),'utf8');
  // Split on record boundaries so each record's own url is inspected, not a neighbour's.
  const chunks=src.split(/\n\s*\{\s*name:/).slice(1);
  const rows=chunks.filter(c=>/cls:"(law|pending|draft|exec)"/.test(c)).map(c=>{
    const field=re=>(c.match(re)||[])[1]||'';
    return {
      cls:(c.match(/cls:"(law|pending|draft|exec)"/)||[])[1],
      status:field(/status:"((?:\\.|[^"\\])*)"/),
      date:field(/date:"((?:\\.|[^"\\])*)"/),
      url:field(/url:"(https?:\/\/[^"]+)"/),
      name:field(/^((?:\\.|[^"\\])*)"/)
    };
  });
  expect(rows.length,'every policy record should be found').toBeGreaterThanOrEqual(12);

  const bad=[];
  let laws=0, pending=0;
  rows.forEach(({cls,status,date,url,name})=>{
    if(!date.trim()) bad.push(`no date on "${name}"`);
    if(!/^https:\/\//.test(url)) bad.push(`no primary-source URL on "${name}"`);
    if(cls==='law'){ laws++; if(!/enacted|law/i.test(status)) bad.push(`law not described as enacted: ${status}`); }
    if(cls==='pending'||cls==='draft'){
      pending++;
      if(/\benacted\b|\bis law\b/i.test(status)) bad.push(`pending item described as law: "${name}" — ${status}`);
    }
  });
  expect(bad,bad.join('\n')).toHaveLength(0);
  expect(laws,'at least one enacted law should be listed').toBeGreaterThan(0);
  expect(pending,'at least one pending proposal should be listed').toBeGreaterThan(0);
});

/* ============================================================
   "Your Congress" — personalized representation
   ============================================================ */

const CENSUS_GLOB='**/geocoder/geographies/coordinates**';

/* NOTE: this file defines a top-level `const URL`, which shadows the global URL
   constructor inside module scope. Parse the callback name with a regex instead. */
function callbackName(u){
  const m=/[?&]callback=([^&]+)/.exec(u||'');
  return m?decodeURIComponent(m[1]):'';
}

/* Answer the Census JSONP call the way the service does: the callback name is chosen by
   the page, so the stub has to echo it back or the loader (correctly) reports malformed. */
async function mockCensus(page,{state,geoid,layer='119th Congressional Districts',raw=null}){
  await page.route(CENSUS_GLOB,async route=>{
    const cb=callbackName(route.request().url());
    if(raw!==null){ await route.fulfill({status:200,contentType:'application/javascript',body:raw}); return; }
    const body=`/**/${cb}({"result":{"geographies":{"States":[{"STUSAB":"${state}","NAME":"S"}],`+
               `"${layer}":[{"GEOID":"${geoid}","NAME":"District"}]}}})`;
    await route.fulfill({status:200,contentType:'application/javascript',body});
  });
}

/* Deterministic geolocation: the browser permission prompt is not what is under test. */
async function mockGeolocation(page,lat,lon,outcome='ok'){
  await page.addInitScript(([la,lo,kind])=>{
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition:(ok,err)=>{
        if(kind==='ok')        setTimeout(()=>ok({coords:{latitude:la,longitude:lo}}),5);
        else if(kind==='denied') setTimeout(()=>err({code:1}),5);
        else if(kind==='timeout') setTimeout(()=>err({code:3}),5);
        /* 'silent' never calls back — exercises the page's own hard timeout. */
      }
    }});
  },[lat,lon,outcome]);
}

async function locate(page){
  await page.locator('#ycGeo').click();
  await page.waitForFunction(()=>{
    const s=document.querySelector('#ycStatus');
    return s && s.textContent.trim().length>0 && !/Asking|Identifying/.test(s.textContent);
  },{timeout:15000});
}

function storedBlob(page){
  return page.evaluate(()=>{
    const k=Object.keys(localStorage).find(x=>/capacity/i.test(x));
    return k?localStorage.getItem(k):'';
  });
}

test('coordinates resolve to exactly one Representative and two Senators, and are never stored', async ({page})=>{
  await mockGeolocation(page,39.0639,-107.5505);
  await mockCensus(page,{state:'CO',geoid:'0803'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await locate(page);

  await expect(page.locator('.yc-group-head h3')).toHaveText([
    'Your U.S. Representative','Your two U.S. Senators'
  ]);
  // 1 House + 2 Senate cards, and the House card is the district the Census returned.
  expect(await page.locator('.yc-card').count()).toBe(3);
  await expect(page.locator('.yc-card .yc-sub').first()).toContainText('Colorado district 3');
  expect(await page.locator(".yc-card[id^='yc-']").count()).toBe(3);

  // The two Senate cards must both be Senate seats for the same state.
  const subs=await page.locator('.yc-card .yc-sub').allInnerTexts();
  expect(subs.filter(s=>/\bColorado\b/.test(s)&&!/district|at-large/.test(s))).toHaveLength(2);

  // Privacy: only state + district may persist. Coordinates must not appear anywhere.
  const blob=await storedBlob(page);
  expect(blob).toContain('CO');
  expect(blob).not.toMatch(/lat|lon|-107\.55|39\.06/i);
});

test('at-large districts (GEOID 00 and delegate codes) map to the single statewide House seat', async ({page})=>{
  // Alaska reports an at-large district as GEOID 0200; the directory stores it as district 0.
  await mockGeolocation(page,61.2181,-149.9003);
  await mockCensus(page,{state:'AK',geoid:'0200'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await locate(page);

  expect(await page.locator('.yc-card').count()).toBe(3);
  await expect(page.locator('.yc-card .yc-sub').first()).toContainText('Alaska at-large');
  await expect(page.locator('#ycStatus')).toContainText('at-large');

  // A delegate code (DC reports 98) must also collapse to the stored single seat.
  await page.unroute(CENSUS_GLOB);
  await mockCensus(page,{state:'DC',geoid:'1198',layer:'119th Congressional Districts'});
  await locate(page);
  await expect(page.locator('.yc-card .yc-sub').first()).toContainText('District of Columbia');
});

test('every location failure path falls back to the manual chooser instead of spinning', async ({page})=>{
  // 1. Permission denied.
  await mockGeolocation(page,0,0,'denied');
  await page.goto(URL);
  await page.waitForTimeout(500);
  await locate(page);
  await expect(page.locator('#ycStatus')).toContainText('blocked the location request');
  await expect(page.locator('#ycManual')).toBeVisible();
  expect(await storedBlob(page)).not.toContain('location');

  // 2. Geocoder unreachable.
  await page.unroute(CENSUS_GLOB);
  await page.route(CENSUS_GLOB,r=>r.abort());
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition:(ok)=>setTimeout(()=>ok({coords:{latitude:39,longitude:-105}}),5)
    }});
  });
  await locate(page);
  await expect(page.locator('#ycStatus')).toContainText(/could not be reached|discarded/);
  await expect(page.locator('#ycManual')).toBeVisible();
  expect(await storedBlob(page)).not.toContain('location');

  // 3. JSONP that loads but never calls back = malformed, not an endless spinner.
  await page.unroute(CENSUS_GLOB);
  await mockCensus(page,{raw:'/* no callback */'});
  await locate(page);
  await expect(page.locator('#ycStatus')).toContainText(/could not read|form this page could not read/i);
  await expect(page.locator('#ycManual')).toBeVisible();

  // 4. A point the geocoder cannot place in any district.
  await page.unroute(CENSUS_GLOB);
  await page.route(CENSUS_GLOB,async route=>{
    const cb=callbackName(route.request().url());
    await route.fulfill({status:200,contentType:'application/javascript',
      body:`/**/${cb}({"result":{"geographies":{"States":[{"STUSAB":"CO"}]}}})`});
  });
  await locate(page);
  await expect(page.locator('#ycStatus')).toContainText(/could not place inside a congressional district/);
  await expect(page.locator('#ycManual')).toBeVisible();
});

test('the manual fallback reaches both Senators from the state alone, then the House seat', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  // No geolocation gesture at all: the manual route must stand on its own.
  await page.locator('#ycManualBtn').click();
  await page.locator('#ycState').selectOption('VT');
  await page.waitForTimeout(300);
  // State alone is enough for the Senate.
  await expect(page.locator('.yc-group-head h3').nth(1)).toContainText('Your two U.S. Senators');
  expect(await page.locator('.yc-card').count()).toBe(2);
  // ...but the House seat is explicitly deferred, not silently guessed.
  await expect(page.locator('#ycResults')).toContainText('Choose your congressional district');

  // A district then completes the trio. Vermont is at-large, so it is pre-selected.
  await page.locator('#ycDistrict').selectOption('0');
  await page.waitForTimeout(300);
  expect(await page.locator('.yc-card').count()).toBe(3);
  await expect(page.locator('.yc-card .yc-sub').first()).toContainText('Vermont at-large');
  const blob=await storedBlob(page);
  expect(blob).not.toMatch(/lat|lon/i);
});

test('a jurisdiction with a delegate and no Senators says so instead of inventing seats', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.locator('#ycManualBtn').click();
  await page.locator('#ycState').selectOption('DC');
  await page.locator('#ycDistrict').selectOption('0');
  await page.waitForTimeout(400);
  expect(await page.locator('.yc-card').count()).toBe(1);
  await expect(page.locator('#ycResults')).toContainText('no voting Senators');
});

test('Reset local data clears the saved location, principles, and any stored coordinates', async ({page})=>{
  await mockGeolocation(page,39.0639,-107.5505);
  await mockCensus(page,{state:'CO',geoid:'0803'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.locator('#prinList input[value="proportional"]').check();
  await locate(page);
  await expect(page.locator('.yc-card').first()).toBeVisible();
  expect(await storedBlob(page)).toContain('location');

  await page.locator('#resetData').click();
  await page.waitForTimeout(400);
  const blob=await storedBlob(page);
  expect(blob).not.toContain('location');
  expect(blob).not.toMatch(/lat|lon|-107|39\.06/i);
  await expect(page.locator('#ycResults')).toBeHidden();
  expect(await page.locator('#prinList input:checked').count()).toBe(0);

  // And it stays cleared across a reload.
  await page.reload();
  await page.waitForTimeout(600);
  await expect(page.locator('#ycResults')).toBeHidden();
});

test('the page contacts no third party at load, and ships no analytics collector', async ({page})=>{
  const external=[];
  page.on('request',r=>{ if(/^https?:/i.test(r.url())) external.push(r.url()); });
  await page.goto(URL);
  await page.waitForTimeout(1200);
  // Scrolling the whole document must not wake a tracker either.
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await page.waitForTimeout(800);
  expect(external,'page load must not contact any third party').toHaveLength(0);

  // Nothing is loaded from another origin, and no collector is referenced in the source.
  const srcs=await page.locator('script[src]').evaluateAll(n=>n.map(e=>e.getAttribute('src')));
  expect(srcs).toHaveLength(0);
  const html=fs.readFileSync('common-capacity.html','utf8');
  expect(html).not.toMatch(/analytics-lite|googletagmanager|\/api\/analytics|navigator\.sendBeacon/i);
});

test('switching recipient keeps the visitor\u2019s own words and only re-addresses them', async ({page})=>{
  await mockGeolocation(page,39.0639,-107.5505);
  await mockCensus(page,{state:'CO',geoid:'0803'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await locate(page);

  const writeCards=page.locator('.yc-card button[data-write]');
  await writeCards.first().click();
  await page.waitForTimeout(250);
  const addressed=await page.locator('#cText').inputValue();
  expect(addressed.split('\n')[0]).toMatch(/^Dear Representative /);

  // The visitor keeps the greeting but rewrites the body in their own words.
  const mine=addressed.split('\n');
  mine.splice(2, mine.length-2, '', 'My own words, unedited. Please keep these.');
  await page.locator('#cText').fill(mine.join('\n'));
  await writeCards.nth(1).click();
  await page.waitForTimeout(300);
  const after=await page.locator('#cText').inputValue();
  expect(after,'hand-written text must survive a recipient change').toContain('My own words, unedited');
  expect(after.split('\n')[0],'the greeting is the only line that changes').toMatch(/^Dear Senator /);
  expect(after).not.toContain('Dear Representative');

  // A message with no recognisable greeting is left completely untouched rather than mangled.
  await page.locator('#cText').fill('My own words, unedited. No greeting at all.');
  await writeCards.nth(2).click();
  await page.waitForTimeout(300);
  expect(await page.locator('#cText').inputValue()).toBe('My own words, unedited. No greeting at all.');
});

test('rebuilding from a generation control replaces edited text only with notice', async ({page})=>{
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.locator('#cText').fill('Text I wrote myself.');
  await page.locator('#styleList button[data-style="oss"]').click();
  await page.waitForTimeout(300);
  expect(await page.locator('#cText').inputValue()).not.toContain('Text I wrote myself.');
  await expect(page.locator('#toast')).toContainText(/replaced the text you had edited/);
});

test('personalizing keeps the chosen principles and never implies a message was sent', async ({page})=>{
  await mockGeolocation(page,61.2181,-149.9003);
  await mockCensus(page,{state:'AK',geoid:'0200'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.locator('#prinList input[value="proportional"]').check();
  await page.locator('#prinList input[value="opensource"]').check();
  await locate(page);

  await page.locator('.yc-card button[data-write]').first().click();
  await page.waitForTimeout(300);
  expect(await page.locator('#prinList input:checked').count(),'principles survive personalization').toBe(2);
  await expect(page.locator('#cRecipient')).not.toContainText('no office selected');
  expect(await page.locator('#cText').inputValue()).toContain('scale with demonstrated capability and risk');
  // Personalizing is not sending. The text stays fully editable and copyable.
  await expect(page.locator('#cCopy')).toBeVisible();
  await expect(page.locator('#cText')).toBeEditable();
  expect(await page.locator('.yc-saved').innerText()).toContain('no coordinates');
});

test('the mobile menu opens, closes on Escape and on selection, and yields at the breakpoint', async ({page})=>{
  await page.setViewportSize({width:390,height:780});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await expect(page.locator('nav.top')).toBeHidden();
  await expect(page.locator('#navToggle')).toBeVisible();
  await expect(page.locator('#mobileNav')).toBeHidden();

  await page.locator('#navToggle').click();
  await expect(page.locator('#mobileNav')).toBeVisible();
  await expect(page.locator('#navToggle')).toHaveAttribute('aria-expanded','true');

  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileNav')).toBeHidden();
  await expect(page.locator('#navToggle')).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.activeElement.id),'focus returns to the control').toBe('navToggle');

  await page.locator('#navToggle').click();
  await page.locator('#mobileNav a').first().click();
  await page.waitForTimeout(300);
  await expect(page.locator('#mobileNav')).toBeHidden();

  // Widening while the panel is open must not leave two navigation systems on screen.
  await page.locator('#navToggle').click();
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(400);
  await expect(page.locator('#mobileNav')).toBeHidden();
  await expect(page.locator('#navToggle')).toBeHidden();
  await expect(page.locator('nav.top')).toBeVisible();
});

test('a Census layer from a newer Congress is refused instead of matched to a stale roster', async ({page})=>{
  /* Transition guard: district lines can be redrawn between Congresses, so a layer named
     for the 120th must not be matched against a roster built for the 119th. */
  await mockGeolocation(page,39.0639,-107.5505);
  await mockCensus(page,{state:'CO',geoid:'0803',layer:'120th Congressional Districts'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await locate(page);

  // It must not name a member from the 119th roster for a 120th district.
  await expect(page.locator('#ycStatus')).toContainText(/newer Congress|automatic matching has been stopped/i);
  await expect(page.locator('#ycStatus')).toHaveAttribute('data-tone','warn');
  expect(await page.locator('.yc-card').count(),'no member may be matched across Congresses').toBe(0);
  await expect(page.locator('#ycManual')).toBeVisible();
  // Nothing was persisted as this visitor's representation.
  expect(await storedBlob(page)).not.toContain('location');
  // The manual path still works and still reaches both Senators.
  await page.locator('#ycState').selectOption('CO');
  await page.waitForTimeout(300);
  expect(await page.locator('.yc-card').count()).toBe(2);

  // The normal path is unchanged: a 119th layer still resolves automatically.
  await page.unroute(CENSUS_GLOB);
  await mockCensus(page,{state:'CO',geoid:'0803'});
  await page.goto(URL);
  await page.waitForTimeout(600);
  await locate(page);
  expect(await page.locator('.yc-card').count()).toBe(3);
  await expect(page.locator('#ycStatus')).toContainText('Located.');
});

test('the embedded roster declares which Congress it represents, so the guard can compare', async ()=>{
  /* The page script is an IIFE, so META is not reachable from page.evaluate. Assert on
     the source that the property exists inside META and is an integer the guard can use. */
  const html=fs.readFileSync('common-capacity.html','utf8');
  const meta=html.slice(html.indexOf('var META = {'), html.indexOf('var META = {')+1200);
  const m=/congressSession:\s*(\d+)/.exec(meta);
  expect(m,'META must declare congressSession as an integer').not.toBeNull();
  expect(Number(m[1])).toBeGreaterThanOrEqual(119);
  // And the resolver must actually read it, or the property is decorative.
  expect(html).toMatch(/found\.congress\s*!==\s*META\.congressSession/);
});
