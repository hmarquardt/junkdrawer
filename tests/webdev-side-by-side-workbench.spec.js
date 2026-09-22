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

async function configureAI(page) {
  await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 mini' }, { id: 'anthropic/claude-test', name: 'Claude test' }] }) }));
  await page.locator('#orKey').fill('test-local-key');
  await page.locator('#orKey').press('Tab');
  await expect(page.locator('#orModelStatus')).toContainText('2 models loaded');
  await page.locator('#orEnabled').check();
}

const aiReply = value => ({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] });

test('AI requirements are strict, quoted, staged, and out-of-scope text is warned', async ({ page }) => {
  const errors = await open(page);
  let answer = aiReply({ requirements: [{ label: 'Pricing table', wording: 'a pricing table', category: 'Component', explicit: true, testable: false, notes: '' }] });
  const requests = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => { requests.push(route.request().postDataJSON());return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }); });
  await configureAI(page);
  await expect(page.locator('#orModel optgroup[label="openai"] option')).toHaveCount(1);
  await expect(page.locator('#orModel optgroup[label="anthropic"] option')).toHaveCount(1);
  await page.locator('#orModel').selectOption('anthropic/claude-test');
  await page.locator('#prompt').fill('Build a pricing table. No authentication is required.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(0);
  expect(requests[0].model).toBe('anthropic/claude-test');
  expect(requests[0].response_format.type).toBe('json_schema');
  expect(requests[0].response_format.json_schema.strict).toBe(true);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('webdev-sbs.openrouter.v1')))).toEqual({ enabled: true, apiKey: 'test-local-key', model: 'anthropic/claude-test' });

  answer = aiReply({ requirements: [{ label: 'Authentication', wording: 'Add authentication', category: 'Interaction', explicit: true, testable: true, notes: '' }] });
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('not quoted from the prompt');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);

  answer = aiReply({ requirements: [{ label: 'Authentication', wording: 'No authentication is required.', category: 'Other', explicit: true, testable: false, notes: '' }] });
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  await expect(page.locator('#aiStage')).toContainText('negative or conditional instruction');
  expect(errors).toEqual([]);
});

test('malformed AI and network failures preserve manual workflow', async ({ page }) => {
  const errors = await open(page);
  let answer = aiReply('{not json');
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ status: answer === 'failure' ? 503 : 200, contentType: 'application/json', body: answer === 'failure' ? JSON.stringify({ error: { message: 'Unavailable' } }) : JSON.stringify(answer) }));
  await configureAI(page);
  await page.locator('#prompt').fill('Build a calculator that updates the total when Calculate is clicked.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('malformed structured JSON');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  answer = 'failure';
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('OpenRouter HTTP 503');
  await page.locator('#extractRequirements').click();
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(1);
  expect(errors).toEqual([expect.stringContaining('503')]);
});

test('AI evidence stays staged, protects edited text, and enforces 200 characters', async ({ page }) => {
  const errors = await open(page);
  let answer;
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply(answer)) }));
  await configureAI(page);
  const id = await page.evaluate(() => {
    const t=window.__WEBDEV_SBS_TEST__,s=t.state(),r=t.requirement('Calculate','Calculate updates the total');
    r.category='Interaction';r.testable=true;r.left={presence:'Present',function:'Works',note:'Calculate updates the monthly total'};
    r.right={presence:'Present',function:'Works',note:'Calculate updates the monthly total'};
    s.prompt='Calculate updates the total';s.requirements=[r];s.evaluation.functional_correctness.left.evidence='The Calculate control updates the total.';t.renderAll();return r.id;
  });
  answer={ suggestions: [{ field: 'functional_correctness.left', evidence: 'The Calculate button updates the displayed monthly total.', source_ids: [`obs:${id}:left`] }] };
  const before=await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()));
  await page.locator('#aiEvidence').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()))).toBe(before);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#aiStage [data-ai-apply]').click();
  expect(await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()))).toBe(before);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#e_functional_correctness_left')).toHaveValue('The Calculate button updates the displayed monthly total.');
  answer={ suggestions: [{ field: 'functional_correctness.left', evidence: 'X'.repeat(200)+'.', source_ids: [`obs:${id}:left`] }] };
  await page.locator('#aiEvidence').click();
  await expect(page.locator('#aiStatus')).toContainText('Over 200 characters');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#e_functional_correctness_left')).toHaveValue('The Calculate button updates the displayed monthly total.');
  expect(errors).toEqual([]);
});

test('visual judgment receives only visual notes; overall suggestion waits for acceptance', async ({ page }) => {
  const errors = await open(page);
  let answer,requests=[];
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => { requests.push(route.request().postDataJSON());return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply(answer)) }); });
  await configureAI(page);
  await page.evaluate(() => {
    let t=window.__WEBDEV_SBS_TEST__,s=t.state(),r=t.requirement('Responsive cards','Keep cards readable on mobile');
    r.category='Visual/layout';r.left.presence='Present';r.right.presence='Present';s.prompt='Keep cards readable on mobile';s.requirements=[r];
    for(let side of ['left','right'])for(let view of ['desktop','mobile'])s.inspections[side][view]=true;
    s.visual.left.mobile.flags=['clipping/cutoff'];s.visual.left.mobile.note='Third card clips at the viewport edge';
    s.visual.right.mobile.note='Three cards stack without clipping';
    Object.assign(s.evaluation.functional_correctness.left,{choice:'No testable functionality',evidence:'The prompt specifies a static responsive card layout.'});
    Object.assign(s.evaluation.functional_correctness.right,{choice:'No testable functionality',evidence:'The prompt names no interaction to test.'});
    Object.assign(s.evaluation.requirements_coverage,{choice:'About equal',evidence:'Both candidates include the requested cards.'});
    Object.assign(s.evaluation.product_depth,{choice:'About equal',evidence:'Neither candidate adds a useful working extra.'});
    t.renderAll();
  });
  answer={choice:'Right',evidence:'The right cards stack on mobile while the left third card clips at the edge.',rationale:'The mobile difference is decisive.',source_ids:['visual:left:mobile','visual:right:mobile']};
  await page.locator('#aiAesthetics').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  const visualRequest=JSON.parse(requests[0].messages[1].content);
  expect(Object.keys(visualRequest)).toEqual(['facts']);
  expect(visualRequest.facts.every(f => f.id.startsWith('visual:'))).toBe(true);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('#e_aesthetics')).toHaveValue(answer.evidence);
  answer={choice:'Right',primary_reason:'Visual quality',rationale:'The right mobile layout keeps all cards readable.',source_ids:['visual:left:mobile','visual:right:mobile']};
  const before=await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()));
  await page.locator('#aiOverall').click();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(window.__WEBDEV_SBS_TEST__.canonical()))).toBe(before);
  await page.locator('#aiStage [data-ai-apply]').click();
  await expect(page.locator('input[name="overall_choice"][value="Right"]')).toBeChecked();
  await expect(page.locator('#primaryReason')).toHaveValue('Visual quality');
  expect(requests[1].messages[1].content).toContain('rubric');
  expect(errors).toEqual([]);
});

test('clear data removes the local OpenRouter key and keeps deterministic suggestions available', async ({ page }) => {
  const errors = await open(page);
  await configureAI(page);
  await page.evaluate(() => {let t=window.__WEBDEV_SBS_TEST__,s=t.state(),r=t.requirement('Static cards','Show three cards');r.testable=false;s.prompt='Show three cards';s.requirements=[r];t.renderAll()});
  await page.locator('#aiRubric').click();
  await expect(page.locator('#aiStage')).toContainText('No testable functionality');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearData').click();
  await expect(page.locator('#orKey')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('webdev-sbs.openrouter.v1'))).toBeNull();
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an AI result is discarded when the evaluation changes during its request', async ({ page }) => {
  const errors = await open(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiReply({ requirements: [{ label: 'Pricing table', wording: 'a pricing table', category: 'Component', explicit: true, testable: false, notes: '' }] })) });
  });
  await configureAI(page);
  await page.locator('#prompt').fill('Build a pricing table.');
  await page.locator('#aiExtract').click();
  await expect(page.locator('#aiStatus')).toContainText('Extracting requirements');
  await page.locator('#prompt').fill('Build a calculator.');
  release();
  await expect(page.locator('#aiStatus')).toContainText('suggestions were discarded');
  await expect(page.locator('#aiStage .ai-proposal')).toHaveCount(0);
  await expect(page.locator('#requirementsList .req-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
