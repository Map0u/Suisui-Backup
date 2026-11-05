/* 浏览器内 ZIP 往返测试：页面内生成 zip → 文件选择器挂载 → 免解压直读渲染。 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => errors.push('[' + m.type() + '] ' + m.text()));

  await page.goto('http://localhost:3566', { waitUntil: 'networkidle' });
  await page.click('#open-demo');
  await page.waitForSelector('.tabbar');

  // 在页面内生成 zip（走真实 SuisuiZipWriter + /api/assets-bundle）
  // 先装拦截器，再触发导出
  await page.evaluate(() => {
    window.__capturedZip = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) {
      if (b && b.type === 'application/zip') window.__capturedZip = b;
      return orig.call(URL, b);
    };
  });
  await page.evaluate(() => window.SuisuiApp.buildAndExport(false));
  await page.waitForFunction(() => window.__buildStage === 'finalized' || (window.__buildStage || '').indexOf('error') === 0, { timeout: 20000 });
  const stage = await page.evaluate(() => window.__buildStage);
  if (stage !== 'finalized') throw new Error('build stage: ' + stage);
  const b64 = await page.evaluate(async () => {
    const blob = window.__lastZipBlob;
    if (!blob) throw new Error('zip blob not captured');
    const buf = await blob.arrayBuffer();
    let s = '';
    const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  });
  console.log('zip generated, base64 length:', b64.length);
  console.log('errors so far:', errors);

  // 写到临时文件
  const fs = require('fs');
  const zipPath = path.join(__dirname, '..', 'smoke-shots', 'roundtrip.zip');
  fs.writeFileSync(zipPath, Buffer.from(b64, 'base64'));
  console.log('zip file bytes:', fs.statSync(zipPath).size);

  // 全新上下文模拟“另一台设备”打开
  const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true });
  const page2 = await ctx2.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(String(e)));
  await page2.goto('http://localhost:3566', { waitUntil: 'networkidle' });
  const [chooser] = await Promise.all([
    page2.waitForEvent('filechooser'),
    page2.click('#open-zip')
  ]);
  await chooser.setFiles(zipPath);
  await page2.waitForSelector('.tabbar', { timeout: 15000 });
  const title = await page2.textContent('.moodcard .nick');
  console.log('reopened, first mood nick:', title);
  await page2.screenshot({ path: path.join(__dirname, '..', 'smoke-shots', '16-zip-reopen.png') });

  await browser.close();
  console.log('ERRORS page1:', errors.length ? errors : 'none');
  console.log('ERRORS page2:', errors2.length ? errors2 : 'none');
  if (!title || title.indexOf('阿岁') < 0) { console.error('ROUNDTRIP FAIL: nick missing'); process.exit(1); }
  console.log('ROUNDTRIP PASS');
})().catch(e => { console.error('ROUNDTRIP FAIL', e.message); process.exit(1); });
