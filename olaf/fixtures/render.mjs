import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cases } from '../benchmarks/cases.mjs';
const names = new Set(cases.flatMap((c) => [c.left, c.right]));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 390 }, deviceScaleFactor: 1 });
  const manifest = {};
  for (const name of names) {
    const url = new URL('specimen.html', import.meta.url);
    url.searchParams.set('v', name);
    await page.goto(url.href);
    await page.evaluate(() => document.fonts.ready);
    const bytes = await page.screenshot({ path: new URL('images/' + name + '.png', import.meta.url).pathname });
    manifest[name] = {
      hash: createHash('sha256').update(bytes).digest('hex'),
      width: 700,
      height: 390,
      bytes: bytes.length,
    };
  }
  await writeFile(new URL('manifest.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
  const taskURL = new URL('task.json', import.meta.url);
  const task = JSON.parse(await readFile(taskURL, 'utf8'));
  for (const [side, name] of [
    ['Left', 'standard'],
    ['Right', 'red'],
  ]) {
    const { hash, width, height, bytes } = manifest[name];
    Object.assign(task.images[side], { sha256: hash, width, height, bytes });
  }
  await writeFile(taskURL, JSON.stringify(task, null, 2) + '\n');
} finally {
  await browser.close();
}
