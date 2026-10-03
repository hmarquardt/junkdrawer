/* Wildlife Field Recorder — CFLab sign-in / session UX regression suite.
 *
 * These tests are deterministic and offline: every CFLab call is intercepted.
 * They pin the behavior that turned a real 401 into an apparently inert button:
 * a sign-in attempt must always produce a visible, sanitized outcome, the
 * button must show a busy state, and a missing/expired session must never
 * silently strand pending captures or spray one error per record.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

test.use({ channel: 'chrome', headless: true, actionTimeout: 45000, navigationTimeout: 45000 });

const PAGE_URL = `file://${path.resolve(process.cwd(), 'wildlife-field-recorder.html')}`;
const WFR_ORIGIN = 'https://hmarquardt.github.io';
const EMAIL = 'field@example.com';
const PASSWORD = 'correct horse battery staple 42';
const TOKEN = 'cflu_test_token_abc123xyz';

// Cross-origin mocks need CORS headers, including for the preflight the browser
// sends for a JSON POST from the file:// page.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-filename, x-file-id, x-record-id, x-resource',
};

async function openAdmin(page) {
  await page.route('**/analytics-lite.js', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/lab.aismallbizguru.com/api/analytics/**', r => r.fulfill({ status: 204, body: '' }));
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__WFR_TEST__);
  await page.click('nav#tabs button[data-tab="admin"]');
  await expect(page.locator('#cfg-sign-in')).toBeVisible();
}

/** Install one CFLab mock. `handler(route, request)` decides each response. */
async function mockCflab(page, handler) {
  await page.route('**/cflab.aismallbizguru.com/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return handler(route, request);
  });
}

function json(route, status, body, extraHeaders = {}) {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
}

async function fillCredentials(page) {
  await page.fill('#cfg-auth-email', EMAIL);
  await page.fill('#cfg-auth-password', PASSWORD);
}

const statusEl = page => page.locator('#cfg-auth-status');
const signInBtn = page => page.locator('#cfg-sign-in');

test.describe('CFLab sign-in UX', () => {
  test('1. tapping Sign in actually invokes the login flow', async ({ page }) => {
    const calls = [];
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      calls.push({ url: request.url(), method: request.method(), body: request.postDataJSON() });
      return json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] });
    });
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].url).toBe('https://cflab.aismallbizguru.com/api/auth/login');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ email: EMAIL, password: PASSWORD });
  });

  test('2. pressing Enter in the password field invokes login', async ({ page }) => {
    const calls = [];
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      calls.push(request.method() + ' ' + request.url());
      return json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] });
    });
    await fillCredentials(page);
    await page.locator('#cfg-auth-password').press('Enter');
    await expect.poll(() => calls.length).toBe(1);
    await expect(statusEl(page)).toHaveText('Signed in as ' + EMAIL);
  });

  test('3. the button enters and leaves its busy state', async ({ page }) => {
    let releaseRoute;
    const gate = new Promise(resolve => { releaseRoute = resolve; });
    await openAdmin(page);
    await mockCflab(page, async route => {
      await gate;
      return json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] });
    });
    await fillCredentials(page);
    const clickDone = signInBtn(page).click();
    await expect(signInBtn(page)).toBeDisabled();
    await expect(signInBtn(page)).toHaveText('Signing in…');
    await expect(statusEl(page)).toHaveText('Signing in…');
    await expect(statusEl(page)).toHaveAttribute('data-state', 'busy');
    releaseRoute();
    await clickDone;
    await expect(signInBtn(page)).toBeEnabled();
    await expect(signInBtn(page)).toHaveText('Sign in');
  });

  test('4. successful login stores the session and updates the UI', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(signInBtn(page)).toHaveText('Sign in');
    expect(await page.evaluate(() => sessionStorage.getItem('wfr_session_v1'))).toBe(TOKEN);
    await expect(page.locator('#cfg-auth-signed-in')).toBeVisible();
    await expect(page.locator('#cfg-auth-signed-out')).toBeHidden();
    await expect(page.locator('#cfg-auth-user')).toHaveText(EMAIL);
    await expect(statusEl(page)).toHaveText('Signed in as ' + EMAIL);
    await expect(statusEl(page)).toHaveAttribute('data-state', 'success');
    expect(await page.locator('#cfg-auth-password').inputValue()).toBe('');
    await expect(page.locator('#sync-banner')).toBeHidden();
  });


  test('5. HTTP 401 displays visible invalid-credential feedback', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 401, { error: { code: 'invalid_credentials', message: 'Invalid email or password' } }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(signInBtn(page)).toHaveText('Sign in');
    await expect(statusEl(page)).toBeVisible();
    await expect(statusEl(page)).toContainText('Invalid email or password');
    await expect(statusEl(page)).toHaveAttribute('data-state', 'error');
    expect(await page.locator('#cfg-auth-email').inputValue()).toBe(EMAIL);
    expect(await page.locator('#cfg-auth-password').inputValue()).toBe('');
    expect(await page.evaluate(() => sessionStorage.getItem('wfr_session_v1'))).toBeNull();
    await expect(page.locator('#cfg-auth-signed-out')).toBeVisible();
  });

  test('6. HTTP 429 displays visible rate-limit feedback', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 429, { error: { code: 'rate_limited', message: 'Too many requests; try again later' } }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toContainText('Too many sign-in attempts');
    await expect(statusEl(page)).toHaveAttribute('data-state', 'error');
  });

  test('7. a network / CORS failure displays actionable visible feedback', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => route.abort('failed'));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toContainText('Could not reach CFLab from this page. Check network/CFLab origin authorization.');
    await expect(statusEl(page)).toHaveAttribute('data-state', 'error');
    await expect(signInBtn(page)).toHaveText('Sign in');
  });

  test('7b. an origin rejection (403) is reported distinctly', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 403, { error: { code: 'origin_not_allowed', message: 'Origin not allowed' } }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toContainText('CFLab refused this page origin');
    await expect(statusEl(page)).toHaveAttribute('data-state', 'error');
  });

  test('7c. a generic backend error is surfaced', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 500, { error: { code: 'internal_error', message: 'Internal server error' } }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toHaveAttribute('data-state', 'error');
    await expect(statusEl(page)).toContainText('HTTP 500');
  });

  test('7d. empty fields show a visible prompt instead of silence', async ({ page }) => {
    const calls = [];
    await openAdmin(page);
    await mockCflab(page, (route, request) => { calls.push(request.url()); return json(route, 200, {}); });
    await signInBtn(page).click();
    await expect(statusEl(page)).toContainText('Enter your CFLab email and password');
    expect(calls).toEqual([]);
  });

  test('8. never leaks the password or session token into the UI or logs', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, route => json(route, 401, { error: { code: 'invalid_credentials', message: 'Invalid email or password' } }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(signInBtn(page)).toHaveText('Sign in');
    const failureState = await page.evaluate(async () => ({
      body: document.body.innerText,
      status: document.getElementById('cfg-auth-status').textContent,
      logs: (await window.__WFR_TEST__.db.logs.toArray()).map(r => r.level + ' ' + r.message).join('\n'),
    }));
    expect(failureState.body).not.toContain(PASSWORD);
    expect(failureState.status).not.toContain(PASSWORD);
    expect(failureState.logs).not.toContain(PASSWORD);
    expect(failureState.body).not.toContain(TOKEN);

    // Now a successful sign-in: the token must exist in sessionStorage but never
    // appear in diagnostics.
    await page.unroute('**/cflab.aismallbizguru.com/**');
    await mockCflab(page, route => json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] }));
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toHaveText('Signed in as ' + EMAIL);
    const successState = await page.evaluate(async () => ({
      token: sessionStorage.getItem('wfr_session_v1'),
      body: document.body.innerText,
      logs: (await window.__WFR_TEST__.db.logs.toArray()).map(r => r.level + ' ' + r.message).join('\n'),
    }));
    expect(successState.token).toBe(TOKEN);
    expect(successState.body).not.toContain(TOKEN);
    expect(successState.logs).not.toContain(TOKEN);
    expect(successState.logs).not.toContain(PASSWORD);
  });
});

test.describe('CFLab session state', () => {
  test('9. a missing / expired session leaves pending captures intact and conspicuous', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      if (request.url().includes('/api/auth/me')) return json(route, 401, { error: { code: 'unauthenticated', message: 'Invalid or expired session' } });
      return json(route, 401, { error: { code: 'invalid_credentials', message: 'Invalid email or password' } });
    });
    await page.evaluate(async () => {
      const T = window.__WFR_TEST__;
      for (const id of ['obs-a', 'obs-b']) {
        await T.db.observations.put({ localId: id, submitStatus: 'ready', createdAt: Date.now(), updatedAt: Date.now(), category: 'bird' });
      }
      T.showAuthState();
    });
    const before = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).map(o => o.submitStatus));
    expect(before).toEqual(['ready', 'ready']);

    await expect(page.locator('#sync-banner')).toBeVisible();
    await expect(page.locator('#sync-banner .sync-banner-text')).toHaveText('CFLab signed out — captures are safe locally; sign in to sync.');
    await expect(page.locator('#sync-banner .sync-banner-count')).toContainText('2');

    // Reload with no session: nothing may be mutated or reclassified.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__WFR_TEST__);
    const after = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).map(o => o.submitStatus));
    expect(after.sort()).toEqual(['ready', 'ready']);
    await expect(page.locator('#sync-banner')).toBeVisible();
  });

  test('9b. restoring a valid session keeps pending records eligible without mutating them', async ({ page }) => {
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      if (request.url().includes('/api/auth/me')) return json(route, 200, { user: { email: EMAIL, is_admin: true }, memberships: [] });
      return json(route, 200, { token: TOKEN, user: { email: EMAIL }, memberships: [] });
    });
    await page.evaluate(async () => {
      const T = window.__WFR_TEST__;
      await T.db.observations.put({ localId: 'obs-ready', submitStatus: 'ready', createdAt: Date.now(), updatedAt: Date.now() });
      await T.db.observations.put({ localId: 'obs-local', submitStatus: 'local', createdAt: Date.now(), updatedAt: Date.now() });
    });
    await fillCredentials(page);
    await signInBtn(page).click();
    await expect(statusEl(page)).toHaveText('Signed in as ' + EMAIL);
    const rows = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).map(o => [o.localId, o.submitStatus]).sort());
    expect(rows).toEqual([['obs-local', 'local'], ['obs-ready', 'ready']]);
    await expect(page.locator('#sync-banner')).toBeHidden();
  });

  test('10. batch submit stops once when authentication is missing', async ({ page }) => {
    const recordAttempts = [];
    let authMeCalls = 0;
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      const url = request.url();
      if (url.includes('/api/apps/')) { recordAttempts.push(request.method() + ' ' + url); return json(route, 200, { id: 'x' }); }
      if (url.includes('/api/auth/me')) authMeCalls++;
      return json(route, 200, { ok: true });
    });
    await page.evaluate(async () => {
      const T = window.__WFR_TEST__;
      for (const id of ['obs-1', 'obs-2', 'obs-3']) {
        await T.db.observations.put({ localId: id, submitStatus: 'ready', createdAt: Date.now(), updatedAt: Date.now(), category: 'bird' });
      }
    });
    await page.click('nav#tabs button[data-tab="process"]');
    await page.click('#submit-ready');
    await expect(page.locator('#process-log')).toContainText('Not signed in to CFLab');
    // Fails fast: no per-record attempts at all, and no wasted auth probe.
    expect(recordAttempts).toEqual([]);
    expect(authMeCalls).toBe(0);
    const rows = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).map(o => o.submitStatus));
    expect(rows).toEqual(['ready', 'ready', 'ready']);
  });

  test('10b. batch submit preflights once and stops on an expired session', async ({ page }) => {
    const recordAttempts = [];
    let authMeCalls = 0;
    await openAdmin(page);
    await mockCflab(page, (route, request) => {
      const url = request.url();
      if (url.includes('/api/apps/')) { recordAttempts.push(url); return json(route, 200, { id: 'x' }); }
      if (url.includes('/api/auth/me')) { authMeCalls++; return json(route, 401, { error: { code: 'unauthenticated', message: 'Invalid or expired session' } }); }
      return json(route, 200, { ok: true });
    });
    await page.evaluate(async () => {
      const T = window.__WFR_TEST__;
      sessionStorage.setItem('wfr_session_v1', 'cflu_stale_token');
      for (const id of ['obs-1', 'obs-2', 'obs-3']) {
        await T.db.observations.put({ localId: id, submitStatus: 'ready', createdAt: Date.now(), updatedAt: Date.now(), category: 'bird' });
      }
    });
    await page.click('nav#tabs button[data-tab="process"]');
    await page.click('#submit-ready');
    await expect(page.locator('#process-log')).toContainText('CFLab session expired');
    expect(authMeCalls).toBe(1);
    expect(recordAttempts).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('wfr_session_v1'))).toBeNull();
    const rows = await page.evaluate(async () => (await window.__WFR_TEST__.db.observations.toArray()).map(o => o.submitStatus));
    expect(rows).toEqual(['ready', 'ready', 'ready']);
  });

  test('records the deployed origin the suite assumes (documentation guard)', () => {
    expect(WFR_ORIGIN).toBe('https://hmarquardt.github.io');
  });
});

