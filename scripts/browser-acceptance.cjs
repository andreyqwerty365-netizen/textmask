// Optional acceptance runner: Playwright is supplied externally, never shipped to users.
const { chromium } = require(process.env.TEXTMASK_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const examples = path.resolve(process.env.TEXTMASK_EXAMPLES || 'examples/demo');
const output = path.resolve('work/browser');
const checks = [], requests = [], errors = [];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function check(name, condition) { assert.ok(condition, name); checks.push(name); console.log('PASS ' + name); }

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.TEXTMASK_BROWSER ? { executablePath: process.env.TEXTMASK_BROWSER } : { channel: 'msedge' }) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await context.newPage();
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto('http://127.0.0.1:4175/', { waitUntil: 'networkidle' });
    for (const name of ['01-sample.txt','02-sample.md','03-sample.docx','04-text.pdf','05-scan.pdf','06-scan.png','07-scan.jpg']) {
      const input = path.join(examples, name);
      const before = sha(await fs.readFile(input));
      await page.locator('#clear').click();
      await page.locator('#mask-email').check();
      await page.locator('#mask-phone').check();
      await page.locator('#mask-url').uncheck();
      await page.locator('#mask-ip').uncheck();
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#open-file').click();
      await (await chooser).setFiles(input);
      await page.locator('#file-progress').waitFor({ state: 'hidden', timeout: 120000 });
      check(name + ': import', !(await page.locator('#error').isVisible()));
      const recognized = await page.locator('#source').inputValue();
      check(name + ': Russian text', recognized.includes('Синтетический пример. Все данные вымышлены.') && recognized.includes('Анна Примерова'));
      check(name + ': both IPv4 labels', (recognized.match(/IPv4:\s*192\.0\.2\.10/g) || []).length === 2);
      await page.locator('#mask').click();
      check(name + ': default 4 replacements / 2 labels', (await page.locator('#summary').textContent()).includes('Замен: 4 · уникальных меток: 2'));
      await page.locator('#mask-url').check();
      await page.locator('#mask-ip').check();
      await page.locator('#source-tab').click();
      await page.locator('#manual-details > summary').click();
      await page.locator('#manual').fill(await fs.readFile(path.join(examples, 'manual-rules.txt'), 'utf8'));
      await page.locator('#manual-details > summary').click();
      await page.locator('#mask').click();
      const masked = await page.locator('#result').inputValue();
      check(name + ': full 12 replacements / 6 labels', (await page.locator('#summary').textContent()).includes('Замен: 12 · уникальных меток: 6'));
      check(name + ': private sample values hidden', !/anna@example\.test|999|example\.test\/private|192\.0\.2\.10|Анна Примерова|Компания Демонстрация/i.test(masked));
      check(name + ': IPv4 labels retained', (masked.match(/IPv4:\s*\[IP_1\]/g) || []).length === 2);
      const event = page.waitForEvent('download');
      await page.locator('#download').click();
      const download = await event;
      check(name + ': TXT filename', download.suggestedFilename() === path.parse(name).name + '_masked.txt');
      const saved = path.join(output, download.suggestedFilename());
      await download.saveAs(saved);
      check(name + ': downloaded content equals editor', await download.failure() === null && await fs.readFile(saved, 'utf8') === masked);
      check(name + ': original unchanged', sha(await fs.readFile(input)) === before);
      check(name + ': no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
      const bounds = await page.locator('#download').boundingBox();
      check(name + ': main action visible', bounds.y >= 0 && bounds.y + bounds.height <= 844);
      if (name === '06-scan.png') await page.screenshot({ path: path.join(output, 'mobile-result.png') });
    }
    await page.locator('#source-tab').click();
    await page.screenshot({ path: path.join(output, 'mobile-source.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.locator('#clear').click();
    await page.setViewportSize({ width: 320, height: 740 });
    await page.screenshot({ path: path.join(output, 'mobile-empty.png') });
    check('no external requests or uploads', requests.every(request => request.url.startsWith('http://127.0.0.1:4175/') && request.method === 'GET'));
    check('no browser errors', errors.length === 0);
    console.log(`Browser acceptance: ${checks.length} checks passed.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(error); process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, errors, requests }, null, 2));
    await browser.close();
  }
})();
