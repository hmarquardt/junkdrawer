const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
test.use({ channel: 'chrome', permissions: ['clipboard-read', 'clipboard-write'] });
let server, url;
const fixture = (name) => path.resolve('olaf/fixtures', name);
const bytes = (name) => readFile(fixture('images/' + name + '.png'));
test.beforeAll(async () => {
  const { startServer } = await import('../server.mjs');
  server = await startServer(0, { OPENAI_API_KEY: 'local-test-only' });
  url = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
});
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.outgoing = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  page.on('request', (r) => {
    if (!r.url().startsWith(url) && /^https?:/.test(r.url())) page.outgoing.push(r.url());
  });
  await page.goto(url + '/olaf.html');
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
  expect(page.outgoing).toEqual([]);
});
const load = async (page) => {
  await page.locator('#demo').click();
  await expect(page.locator('#confirm')).toBeEnabled();
};
const run = async (page) => {
  await page.locator('#confirm').check();
  await page.locator('#evaluate').click();
  await expect(page.locator('#results')).toBeVisible();
};
async function picker(page, button, files) {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles(files);
}
test('keyboard file picker, multiple originals, replace, swap, remove and reset', async ({ page }) => {
  await page.evaluate(() => {
    const create = URL.createObjectURL;
    window.previewBlobs = new Map();
    URL.createObjectURL = (blob) => {
      const url = create.call(URL, blob);
      window.previewBlobs.set(url, blob);
      return url;
    };
  });
  await expect(page.locator('#evaluate')).toBeDisabled();
  await page.locator('#browse').focus();
  const choose = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await choose).setFiles([fixture('images/standard.png'), fixture('images/red.png')]);
  await expect(page.locator('#LeftMeta')).toContainText('standard.png · 700 × 390');
  await expect(page.locator('#RightMeta')).toContainText('red.png');
  // Byte-for-byte round trip through the preview blob.
  const preview = await page
    .locator('#LeftWindow img')
    .evaluate(async (img) => Array.from(new Uint8Array(await window.previewBlobs.get(img.src).arrayBuffer())));
  expect(Buffer.from(preview)).toEqual(await bytes('standard'));
  await page.locator('#request').fill('Use an exhibit heading');
  await page.locator('#confirm').check();
  await page.locator('#swap').click();
  await expect(page.locator('#LeftMeta')).toContainText('red.png');
  await expect(page.locator('#evaluate')).toBeDisabled();
  await picker(page, page.locator('#LeftUpload'), fixture('images/tight.png'));
  await expect(page.locator('#LeftMeta')).toContainText('tight.png');
  await page.getByLabel('Right image panel').getByText('Remove').click();
  await expect(page.locator('#confirm')).toBeDisabled();
  await page.locator('#clear').click();
  await expect(page.locator('#request')).toHaveValue('');
  await expect(page.locator('#poolBox')).toBeHidden();
});
test('OS clipboard shortcut fills focused panel and unified area, global drop blocks navigation', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const blob = await (await fetch('olaf/fixtures/images/standard.png')).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.getByLabel('Right image panel').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#RightMeta')).toContainText('700 × 390');
  await page.locator('#drop').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#LeftMeta')).toContainText('700 × 390');
  const cancelled = await page.evaluate(async () => {
    const blob = await (await fetch('olaf/fixtures/images/red.png')).blob();
    const d = new DataTransfer();
    d.items.add(new File([blob], 'dropped.png', { type: blob.type }));
    const send = (target, type) =>
      !target.dispatchEvent(new DragEvent(type, { dataTransfer: d, bubbles: true, cancelable: true }));
    return [
      send(document.body, 'dragover'),
      send(document.querySelector('[data-side=Right]'), 'drop'),
      send(document.body, 'drop'),
    ];
  });
  expect(cancelled).toEqual([true, true, true]);
  await expect(page.locator('#RightMeta')).toContainText('dropped.png');
  expect(page.url()).toBe(url + '/olaf.html');
});
test('nested archive recovers labels, charset and images without executing or fetching HTML', async ({
  page,
}) => {
  await picker(page, page.locator('#browse'), fixture('nested.mhtml'));
  await expect(page.locator('#request')).toHaveValue('Show a café sign.');
  await expect(page.locator('#LeftMeta')).toContainText('Left · 8 × 4');
  await expect(page.locator('#RightMeta')).toContainText('Right · 8 × 4');
  await expect(page.locator('#recovery')).toContainText('no recoverable embedded resource');
  await expect(page).toHaveTitle(/OLAF/);
  await expect(page.locator('#preview')).toContainText('Show a café sign.');
  await expect(page.locator('#evaluate')).toBeDisabled();
});
test('ambiguous archive exposes manual text and candidate assignment', async ({ page }) => {
  await picker(page, page.locator('#browse'), fixture('ambiguous.mht'));
  await expect(page.locator('#poolBox')).toBeVisible();
  await expect(page.locator('#request')).toHaveValue('');
  await expect(page.locator('#recovery')).toContainText('incomplete');
  await page.locator('#alternates select').selectOption('1');
  await page.locator('.resource').nth(1).getByText('Use as Left').click();
  await page.locator('.resource').first().getByText('Use as Right').click();
  await expect(page.locator('#preview')).toContainText('Show a green sign.');
  await expect(page.locator('#confirm')).toBeEnabled();
});
test('inspect, fullscreen, zoom, crop two regions and preserve source', async ({ page }) => {
  await load(page);
  await page.getByLabel('Left image panel').getByText('Inspect / crop').click();
  await expect(page.locator('#viewer')).toBeVisible();
  await page.locator('#full').click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.locator('#zoom').fill('200');
  expect(await page.locator('#large').evaluate((i) => i.clientWidth)).toBe(1400);
  await page.locator('#cropBox summary').click();
  await page.locator('#w').fill('999');
  await page.locator('#cropLeft').click();
  await expect(page.locator('#viewStatus')).toContainText('must fit');
  await page.locator('#w').fill('350');
  await page.locator('#cropLeft').click();
  await expect(page.locator('#viewStatus')).toHaveText('Assigned crop to Left.');
  await page.locator('#x').fill('350');
  await page.locator('#cropRight').click();
  await expect(page.locator('#viewStatus')).toHaveText('Assigned crop to Right.');
  await page.locator('#closeViewer').click();
  await expect(page.locator('#RightMeta')).toContainText('350 × 390');
  await page.locator('#poolBox summary').click();
  await expect(page.locator('.resource')).toHaveCount(4);
});
test('mock evaluation, verification, diagnostic mode, clipboard JSON and export', async ({ page }) => {
  await load(page);
  await page.locator('#reverse').check();
  await page.locator('#diagnostic').check();
  await run(page);
  await expect(page.locator('#decision')).toHaveText('Left is better');
  await expect(page.locator('#summary')).toContainText('consistent');
  await expect(page.locator('#diag')).toBeVisible();
  await page.locator('#copyWhy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Left is better because');
  await page.locator('#copyJson').click();
  const json = await page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));
  expect(json.verification.reversedDecision).toBe('Right');
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const exported = await readFile(await (await download).path(), 'utf8');
  expect(JSON.parse(exported)).toEqual(json);
  expect(exported).not.toMatch(/base64|local-test-only|data:image/);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.locator('#swap').click();
  await run(page);
  await expect(page.locator('#decision')).toHaveText('Right is better');
});
test('local provider cancellation, safe failure feedback and retry', async ({ page }) => {
  await load(page);
  await page.locator('#provider').selectOption('openai');
  let count = 0;
  await page.route('**/olaf/observe', async (route) => {
    count++;
    if (count === 1) await new Promise((r) => setTimeout(r, 500));
    const payload = route.request().postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(['captureScope', 'diagnostic', 'images', 'model', 'request']);
    expect(payload.images.Left).toMatch(/^data:image\/png/);
    await route.fulfill({ status: 200, json: { observation: {} } }).catch(() => {});
  });
  await page.locator('#confirm').check();
  await page.locator('#evaluate').click();
  await expect.poll(() => count).toBe(1);
  await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('cancelled');
  await page.getByRole('button', { name: /Retry evaluation/ }).click();
  await expect(page.locator('#status')).toContainText('Missing observation');
  await expect(page.locator('#evaluate')).toBeEnabled();
});
test('architecture selection exercises structured, staged and verification paths with mock observations', async ({
  page,
}) => {
  await load(page);
  await expect(page.locator('#architecture')).toHaveValue('a');
  await expect(page.locator('#architecture option')).toHaveCount(4);
  for (const architecture of ['b', 'c', 'd']) {
    await page.locator('#architecture').selectOption(architecture);
    await page.locator('#confirm').check();
    await page.locator('#evaluate').click();
    await expect(page.locator('#decision')).toHaveText('Left is better');
    await expect(page.locator('#summary')).toContainText('Architecture');
    await expect(page.locator('#stages')).toContainText(architecture === 'b' ? 'structured' : architecture === 'c' ? 'inspection' : 'observe');
    await page.locator('#architecture').selectOption('a');
  }
});
test('narrow and desktop layouts fit and the confirmation gate is keyboard accessible', async ({ page }) => {
  await load(page);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('#confirm').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.locator('#evaluate')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#decision')).toHaveText('Left is better');
});
test('real JPEG and WebP decoding recognizes bytes independently of file extension', async ({ page }) => {
  const jpeg = {
    name: 'unknown.bin',
    mimeType: 'application/octet-stream',
    buffer: await readFile(fixture('portrait.jpg')),
  };
  const webp = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 52;
    c.height = 33;
    return Array.from(
      new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/webp'))).arrayBuffer()),
    );
  });
  await picker(page, page.locator('#browse'), [
    jpeg,
    { name: 'image.data', mimeType: 'application/octet-stream', buffer: Buffer.from(webp) },
  ]);
  await expect(page.locator('#LeftMeta')).toContainText('unknown.bin');
  await expect(page.locator('#RightMeta')).toContainText('52 × 33');
});
test('malformed archive preserves the current task and multiple archives require separate imports', async ({
  page,
}) => {
  await load(page);
  await picker(page, page.locator('#browse'), {
    name: 'truncated.mht',
    mimeType: 'message/rfc822',
    buffer: Buffer.from('partial'),
  });
  await expect(page.locator('#status')).toContainText('No supported archive parts');
  await expect(page.locator('#request')).toHaveValue(/purple/);
  await expect(page.locator('#LeftMeta')).toContainText('Exhibit');
  await picker(page, page.locator('#browse'), [fixture('nested.mhtml'), fixture('ambiguous.mht')]);
  await expect(page.locator('#status')).toContainText('separate task');
  await expect(page.locator('#request')).toHaveValue(/purple/);
});
