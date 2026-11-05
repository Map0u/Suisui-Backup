/* UI 冒烟测试：iPhone 视口遍历 5 个 Tab + 关键浮层，输出截图。 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'smoke-shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3566';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, '01-rescue.png') });

  // 先逛逛演示数据
  await page.click('#open-demo');
  await page.waitForSelector('.tabbar');
  await page.screenshot({ path: path.join(OUT, '02-mood.png') });

  // 自己（私密小锁）
  await page.click('.capsule:nth-child(3)');
  await page.screenshot({ path: path.join(OUT, '03-mood-self.png') });

  // 树洞
  await page.click('.tabbar .tab:nth-child(2)');
  await page.waitForSelector('.treecard');
  await page.screenshot({ path: path.join(OUT, '04-tree.png') });

  // 解忧馆-邮局
  await page.click('.tabbar .tab:nth-child(3)');
  await page.waitForSelector('.letter');
  await page.screenshot({ path: path.join(OUT, '05-post.png') });
  // 拆信
  await page.click('.letter');
  await page.waitForSelector('.letterpaper');
  await page.screenshot({ path: path.join(OUT, '06-letter-open.png') });
  await page.click('.letterpaper .close');
  await page.waitForSelector('.lettermodal', { state: 'detached' });

  // FM
  await page.click('.capsule:nth-child(2)');
  await page.waitForSelector('.fmrecord');
  await page.screenshot({ path: path.join(OUT, '07-fm.png') });

  // 博物馆
  await page.click('.capsule:nth-child(3)');
  await page.waitForSelector('.hall.future');
  await page.screenshot({ path: path.join(OUT, '08-museum.png') });

  // 毕业手账
  await page.click('#hall-now');
  await page.waitForSelector('.gradpaper');
  await page.screenshot({ path: path.join(OUT, '09-graduation.png') });
  await page.click('.drawer .x');
  await page.waitForSelector('.drawer-mask', { state: 'detached' });

  // 珍藏向导
  await page.click('#hall-years');
  await page.waitForSelector('.gcard');
  await page.screenshot({ path: path.join(OUT, '10-guide.png') });
  await page.click('.drawer .x');
  await page.waitForSelector('.drawer-mask', { state: 'detached' });

  // 互动 + 聊天
  await page.click('.tabbar .tab:nth-child(4)');
  await page.waitForSelector('.conv');
  await page.screenshot({ path: path.join(OUT, '11-hudong.png') });
  await page.click('.conv');
  await page.waitForSelector('.chatpage');
  await page.screenshot({ path: path.join(OUT, '12-chat.png') });
  await page.click('.chathead .back');

  // 我的
  await page.click('.tabbar .tab:nth-child(5)');
  await page.waitForSelector('.mine-hero');
  await page.screenshot({ path: path.join(OUT, '13-mine.png') });

  // 时光机检索
  await page.click('.tabbar .tab:nth-child(1)');
  await page.click('#btn-search');
  await page.waitForSelector('.searchdrawer');
  await page.screenshot({ path: path.join(OUT, '14-timemachine.png') });
  await page.click('.drawer .x');
  await page.waitForSelector('.drawer-mask', { state: 'detached' });

  // 时光封存舱
  await page.click('.tabbar .tab:nth-child(5)');
  await page.click('.backup-entry');
  await page.waitForSelector('#bd-full');
  await page.screenshot({ path: path.join(OUT, '15-backup.png') });

  await browser.close();
  console.log('SHOTS:', fs.readdirSync(OUT).length);
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
})().catch(e => { console.error('SMOKE FAIL', e); process.exit(1); });
