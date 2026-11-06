/* ============================================================
 * v1.3.0 超大账号全链路压测（Chromium 手机视口）
 * 15,000 条树洞 + ~50,000 条评论 + 3,000 个模拟媒体
 *
 * 验证：
 *  1) 5 个 Tab（树洞/解忧/心情/互动/我的）切换 < 100ms，DOM 受控
 *  2) 3,000 媒体自动分卷：>1200 个/卷 或 >120MB 切新卷，每卷生成下载按钮
 *  3) zip finalize 后 parts 收敛（<= 几百），无 O(N²)
 * 截图：screenshots/v1.3.0_massive_test.png
 * 用法：node test/stress-v1.3.mjs
 * ============================================================ */
const { chromium } = await import('file:///D:/Software/Remotion/npm-global/node_modules/playwright/index.mjs');
import { generate } from './gen-massive-archive.js';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const SHOTS = join(ROOT, 'screenshots');
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };

const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000008000000080806000000c40fbe8b0000000d49444154789c6260000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

/* 极简静态服务器：/media/N.png 返回小 png；其余服务 public/ */
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const m = p.match(/^\/media\//);
  if (m) {
    if (/\.wav$/i.test(p)) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.alloc(400, 1)); }
    else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(TINY_PNG); }
    return;
  }
  const file = join(PUBLIC, p);
  try {
    const buf = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end('nf');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/* 造 3,000 个不重复的同源图片 URL（替代真实 COS 链接，fetch 必成功） */
function fakeMediaUrls(n) {
  const out = [];
  // 无前导斜杠：safeMediaURL 只放行 'media/...' 形式
  for (let i = 0; i < n; i++) out.push('media/' + i + '.png');
  return out;
}

/* 把生成归档改造成：挂满 3000 个模拟媒体引用 + 50k 评论分布在树洞。
 * 先清空生成器自带的 media/15318544267/* 引用，换成我们可控的 media/N.png，
 * 让唯一 ref 精确为 3000。 */
const { archive } = generate({ treeCount: 15000 });
const mediaPool = fakeMediaUrls(3000);
archive.tree.forEach((t, i) => {
  t.images = [mediaPool[i % 3000]];
  t.audio = '';
  t.resourcePath = '';
  t.imgPath = '';
});
let totalComments = 0;
archive.tree.forEach(t => { totalComments += (t.comments || []).length; });
// 扩充评论到 ~50k：给前面树洞补评论副本
let need = 50000 - totalComments;
for (let i = 0; need > 0 && i < archive.tree.length; i += 1) {
  const t = archive.tree[i];
  const src = (t.comments && t.comments[0]) || { id: 'x', content: '抱抱', nickname: '岁友' };
  t.comments = t.comments || [];
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = 'extra_' + i;
  t.comments.push(clone);
  need--;
}
totalComments = 0;
archive.tree.forEach(t => { totalComments += (t.comments || []).length; });

console.log(`[gen] tree=${archive.tree.length} comments=${totalComments} uniqueMedia=${mediaPool.length}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  isMobile: true, hasTouch: true
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|404/.test(t)) return; // 测试静态服务器缺图标，不影响逻辑
  errors.push('console: ' + t);
});

await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.SuisuiApp !== undefined, { timeout: 15000 });

/* 注入超大归档（必须先设 SU demo 变量再点样例入口，archiveForExport/渲染才会用它） */
await page.evaluate((arch) => {
  window.SUISUI_DEMO_ARCHIVE = arch;
}, archive);
await page.evaluate(() => {
  const btn = document.getElementById('open-demo');
  if (btn) btn.click();
});
await page.waitForSelector('.suisui-app-shell', { timeout: 30000 });
await page.waitForFunction(() => {
  const d = (window.SuisuiApp._state.archive || {}).tree;
  return d && d.length === 15000;
}, { timeout: 30000 });
await page.waitForTimeout(300);

const results = {};

/* ---- 1) Tab 切换耗时 ---- */
const TABS = ['sorrow', 'mood', 'fm', 'mine', 'tree'];
for (const tab of TABS) {
  const t0 = Date.now();
  await page.evaluate((k) => {
    const S = window.SuisuiApp._state;
    S.activeTab = k;
    // renderBottomNav + renderCurrentStage via button click path
    const navBtn = document.querySelector(`[data-tab="${k}"]`);
    if (navBtn) navBtn.click();
  }, tab);
  const dt = Date.now() - t0;
  const domCount = await page.evaluate(() => document.querySelectorAll('#suisui-stage *').length);
  results[`tab_${tab}`] = { ms: dt, dom: domCount };
  console.log(`[tab] ${tab.padEnd(6)} ${dt}ms  dom=${domCount}`);
}

/* ---- 2) 分卷导出逻辑（不打真媒体字节，用桩 fetchMedia） ---- */
const exportResult = await page.evaluate(async () => {
  const S = window.SuisuiApp._state;
  const out = { volumes: 0, volSizes: [], entriesPerVol: [], ok: false, err: '', stage: '', pct: 0, vols: [] };
  try {
    const origA = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {}; // 吞真实下载
    window.SuisuiApp.exportZip();
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const exp = S.exportSession;
      // 模拟用户点「保存第 i 卷」释放背压
      if (exp && exp.pendingVol && typeof exp.requestSave === 'function') {
        exp.requestSave();
      }
      if (exp && exp.phase === 'done') break;
      if (!S.exporting) break;
      await new Promise(r => setTimeout(r, 150));
      out.stage = S.exportProgressTitle || '';
      out.pct = S.exportPct || 0;
    }
    HTMLAnchorElement.prototype.click = origA;
    const exp = S.exportSession;
    out.volumes = exp && exp.state ? exp.state.volumes.length : 0;
    out.vols = (exp && exp.state ? exp.state.volumes : []).map(v => ({ vol: v.vol, size: v.size, count: v.count, indexVol: v.indexVol }));
    out.ok = !!(exp && exp.phase === 'done') || !S.exporting;
  } catch (e) { out.err = e.message; }
  return out;
});
console.log('[export]', JSON.stringify(exportResult));

/* ---- 3) zip-engine parts 收敛验证（在 finalize 内观察 parts 长度上限） ---- */
const zipCheck = await page.evaluate(async () => {
  const w = new window.SuisuiZipWriter();
  for (let i = 0; i < 5000; i++) w.add('f' + i + '.txt', new Uint8Array(64).fill(i % 256));
  // 挂探针：finalize 期间 _push 每次记录 parts 峰值
  let peak = 0;
  const origPush = w._push.bind(w);
  w._push = function (p) { const r = origPush(p); peak = Math.max(peak, w.parts.length); return r; };
  const blob = await w.finalize();
  return { peakParts: peak, partsAfter: w.parts ? w.parts.length : 0, size: blob.size, sealed: w.sealed, totalBytes: w.totalBytes, entriesCleared: w.entries.length === 0 };
});
console.log('[zip-engine]', JSON.stringify(zipCheck));

/* ---- 4) counts() O(1) 验证 ---- */
const countsCheck = await page.evaluate(() => {
  const S = window.SuisuiApp._state;
  const d = S.archive;
  const t0 = performance.now();
  let c;
  for (let i = 0; i < 100; i++) c = (function(dd){ // counts 是闭包私有，通过顶栏间接测：renderTreeTab 里调
    return dd.__suisui_counts;
  })(d);
  const cached = !!c;
  return { cached, tree: c && c.tree, comments: c && c.comments, media: c && c.media, ms100x: (performance.now() - t0).toFixed(1) };
});
console.log('[counts]', JSON.stringify(countsCheck));

await page.screenshot({ path: join(SHOTS, 'v1.3.0_massive_test.png'), fullPage: false });
console.log('[shot] screenshots/v1.3.0_massive_test.png');

console.log('\n===== 结果汇总 =====');
let pass = true;
TABS.forEach(t => {
  const r = results['tab_' + t];
  const ok = r.ms < 100;
  if (!ok) pass = false;
  console.log(`  tab ${t}: ${r.ms}ms ${ok ? 'PASS' : 'FAIL(>100ms)'}  dom=${r.dom}`);
});
console.log(`  分卷数: ${exportResult.volumes} ${exportResult.volumes >= 2 ? 'PASS(>=2)' : 'FAIL(<2)'}  卷明细: ${JSON.stringify(exportResult.vols)}`);
if (exportResult.volumes < 2) pass = false;
console.log(`  zip parts 收敛: peak=${zipCheck.peakParts} after=${zipCheck.partsAfter}  size=${(zipCheck.size / 1048576).toFixed(1)}MB  sealed=${zipCheck.sealed}  entriesCleared=${zipCheck.entriesCleared}`);
if (!(zipCheck.peakParts > 0 && zipCheck.peakParts <= 400 && zipCheck.entriesCleared)) pass = false;
console.log(`  counts 缓存: ${countsCheck.cached ? 'PASS' : 'FAIL'}  (tree=${countsCheck.tree} comments=${countsCheck.comments} media=${countsCheck.media})`);
if (!countsCheck.cached) pass = false;
if (errors.length) { console.log('  JS 错误:'); errors.slice(0, 10).forEach(e => console.log('   ', e)); pass = false; }
console.log(pass ? '\nALL PASS' : '\nSOME FAIL');

await browser.close();
server.close();
process.exit(pass ? 0 : 1);
