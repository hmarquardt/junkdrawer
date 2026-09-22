const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome' });
const url = `file://${path.resolve(process.cwd(), 'webdev-side-by-side-workbench.html')}`;

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('analytics-lite')) errors.push(message.text()); });
  await page.route('**/api/analytics/**', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__WEBDEV_SBS_TEST__));
  return errors;
}

test('draft round trip, legal choices, 200-character evidence, and sentence warnings', async ({ page }) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__;
    const initial = t.canonical();
    t.importPayload(JSON.parse(JSON.stringify(initial)));
    const roundTrip = JSON.stringify(t.canonical()) === JSON.stringify(initial);
    const legal = ['No testable functionality', 'Works', 'Partly works', 'Does not work'].map(choice => {
      const p = structuredClone(initial);
      p.functional_correctness.left.choice = choice;
      t.importPayload(p);
      return t.canonical().functional_correctness.left.choice;
    });
    const comparisons = ['Left', 'About equal', 'Right'].map(choice => {
      const p = structuredClone(initial);
      for (const key of ['requirements_coverage', 'product_depth', 'aesthetics']) p[key].choice = choice;
      p.overall_preference.choice = choice;
      t.importPayload(p);
      const out = t.canonical();
      return [out.requirements_coverage.choice, out.product_depth.choice, out.aesthetics.choice, out.overall_preference.choice];
    });
    const reasons = ['Functionality', 'Requirements coverage', 'Useful added capability', 'Visual quality', 'No meaningful difference'].map(primary_reason => {
      const p = structuredClone(initial);
      p.overall_preference.primary_reason = primary_reason;
      t.importPayload(p);
      return t.canonical().overall_preference.primary_reason;
    });
    const edge = t.evidenceFlags('requirements_coverage', 'x'.repeat(200) + '.');
    const exact = t.evidenceFlags('requirements_coverage', 'x'.repeat(199) + '.');
    const multi = t.evidenceFlags('requirements_coverage', 'First sentence. Second sentence.');
    return { roundTrip, legal, comparisons, reasons, edge, exact, multi };
  });
  expect(result.roundTrip).toBe(true);
  expect(result.legal).toEqual(['No testable functionality', 'Works', 'Partly works', 'Does not work']);
  expect(result.comparisons).toEqual(['Left', 'About equal', 'Right'].map(x => [x, x, x, x]));
  expect(result.reasons).toEqual(['Functionality', 'Requirements coverage', 'Useful added capability', 'Visual quality', 'No meaningful difference']);
  expect(result.edge).toContain('Over 200 characters');
  expect(result.exact).not.toContain('Over 200 characters');
  expect(result.multi).toContain('Use one sentence');
  expect(errors).toEqual([]);
});

test('requirements, observations, contradictions, and local restore', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#prompt').fill('Build a calculator that updates the total when Calculate is clicked.');
  await page.locator('#extractRequirements').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  await page.locator('#requirementsList [data-key=testable]').check();
  await page.locator('#observationRows [data-obs="left.presence"]').selectOption('Absent');
  const warnings = await page.evaluate(() => {
    const t = window.__WEBDEV_SBS_TEST__, s = t.state();
    s.requirements[0].left.function = 'Works';
    s.requirements[0].right.presence = 'Absent';
    s.evaluation.requirements_coverage.choice = 'Right';
    s.requirements[0].left.presence = 'Present';
    const coverage = t.lint();
    s.requirements[0].left.presence = 'Absent';
    return { coverage, absent: t.lint() };
  });
  expect(warnings.coverage.some(x => x.includes('Coverage favors Right'))).toBe(true);
  expect(warnings.absent.some(x => x.includes('absent but marked Works'))).toBe(true);
  await page.locator('#prompt').fill('A second prompt that should survive reload.');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('#prompt')).toHaveValue('A second prompt that should survive reload.');
  expect(errors).toEqual([]);
});

test('bookmarklet validates before touching form, maps every field, and never submits', async ({ page }) => {
  await open(page);
  const source = await page.evaluate(() => window.__WEBDEV_SBS_TEST__.webdevAutofill.toString());
  const payload = {
    schema: 'webdev-sbs-v1',
    functional_correctness: { left: { choice: 'Works', evidence: 'The Calculate control updates the total.' }, right: { choice: 'Partly works', evidence: 'The Calculate control updates once but ignores a changed term.' } },
    requirements_coverage: { choice: 'Left', evidence: 'The right candidate omits the requested pricing table.' },
    product_depth: { choice: 'Right', evidence: 'The right candidate adds a working cart quantity stepper.' },
    aesthetics: { choice: 'About equal', evidence: 'Both candidates keep readable layouts on desktop and mobile.' },
    overall_preference: { choice: 'Left', primary_reason: 'Requirements coverage', optional_comment: '' }
  };
  const cases = [
    { raw: '{bad', controls: true, expected: 'malformed JSON' },
    { raw: JSON.stringify({ ...payload, schema: 'other' }), controls: true, expected: 'validation failed' },
    { raw: JSON.stringify({ ...payload, aesthetics: { ...payload.aesthetics, evidence: 'x'.repeat(201) } }), controls: true, expected: 'validation failed' },
    { raw: JSON.stringify(payload), controls: false, expected: 'incompatible form DOM' },
    { raw: JSON.stringify(payload), controls: true, expected: 'Fields verified: 13/13' }
  ];
  for (const c of cases) {
    const result = await page.evaluate(async ({ source, c }) => {
      const map = {
        root_functional_correctness_left: ['No testable functionality', 'Works', 'Partly works', 'Does not work'],
        root_functional_correctness_right: ['No testable functionality', 'Works', 'Partly works', 'Does not work'],
        root_requirements_coverage_choice: ['Left', 'About equal', 'Right'],
        root_product_depth_choice: ['Left', 'About equal', 'Right'],
        root_aesthetics_choice: ['Left', 'About equal', 'Right'],
        root_overall_preference_choice: ['Left', 'About equal', 'Right'],
        root_overall_preference_primary_reason: ['Functionality', 'Requirements coverage', 'Useful added capability', 'Visual quality', 'No meaningful difference']
      };
      const texts = ['root_functional_correctness_left_evidence','root_functional_correctness_right_evidence','root_requirements_coverage_evidence','root_product_depth_evidence','root_aesthetics_evidence','root_overall_preference_optional_comment'];
      const host = document.createElement('div');host.id = 'mockForm';document.body.append(host);
      if (c.controls) {
        for (const [id, values] of Object.entries(map)) {
          const group = document.createElement('div');group.id = id;
          for (const value of values) { const b = document.createElement('button');b.value=value;b.type='button';b.textContent=value;b.onclick=()=>{group.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed', 'false'));b.setAttribute('aria-pressed','true')};group.append(b) }
          host.append(group);
        }
        for (const id of texts) {const t=document.createElement('textarea');t.id=id;host.append(t)}
      }
      const submit=document.createElement('button');submit.textContent='Submit';submit.onclick=()=>window.__submitCount++;host.append(submit);
      window.__submitCount=0;const alerts=[];window.alert=s=>alerts.push(s);
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>c.raw}});
      Function('return ('+source+')')()();
      await new Promise(r=>setTimeout(r,180));
      const values=Object.keys(map).map(id=>[id,document.getElementById(id)?.querySelector('button[aria-pressed="true"]')?.value]);
      const textValues=texts.map(id=>[id,document.getElementById(id)?.value]);
      const output={alerts,submitCount:window.__submitCount,values,textValues};host.remove();return output;
    }, { source, c });
    expect(result.alerts.join(' ')).toContain(c.expected);
    expect(result.submitCount).toBe(0);
    if (c.expected === 'Fields verified: 13/13') {
      expect(result.values).toEqual([
        ['root_functional_correctness_left','Works'],['root_functional_correctness_right','Partly works'],
        ['root_requirements_coverage_choice','Left'],['root_product_depth_choice','Right'],
        ['root_aesthetics_choice','About equal'],['root_overall_preference_choice','Left'],
        ['root_overall_preference_primary_reason','Requirements coverage']
      ]);
      expect(result.textValues[0][1]).toBe(payload.functional_correctness.left.evidence);
      expect(result.textValues[5][1]).toBe('');
    } else expect(result.values.every(([,value]) => !value)).toBe(true);
  }
  expect(source).not.toMatch(/querySelector\([^)]*submit|\.submit\(/i);
});

test('native textarea setter emits bubbling input and change, with narrow mobile layout', async ({ page }) => {
  const errors = await open(page);
  await page.screenshot({ path: '/tmp/webdev-workbench-desktop.png', fullPage: true });
  const events = await page.evaluate(() => {
    const t=document.createElement('textarea'),seen=[];document.body.append(t);
    for(const type of ['input','change'])t.addEventListener(type,e=>seen.push([e.type,e.bubbles]));
    window.__WEBDEV_SBS_TEST__.nativeSet(t,'React-safe value');
    t.remove();return {value:t.value,seen};
  });
  expect(events).toEqual({value:'React-safe value',seen:[['input',true],['change',true]]});
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/webdev-workbench-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
