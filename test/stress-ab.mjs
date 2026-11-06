/* A/B 对比压测：先复现旧版大账号卡死 bug，再验证新版修复 */
import { generate, mediaBytesFor } from './gen-massive-archive.js';
import { performance } from 'perf_hooks';
import fs from 'fs';
import vm from 'vm';

const { archive, mediaCount } = generate({ treeCount: 15000 });
console.log(`=== 生成超级大账号 Mock 数据 ===`);
console.log(`  树洞: ${archive.tree.length.toLocaleString()}`);
console.log(`  评论总数: ${archive.tree.reduce((s, t) => s + (t.comments || []).length, 0).toLocaleString()}`);
console.log(`  图片: ${mediaCount.img.toLocaleString()}, 语音: ${mediaCount.wav.toLocaleString()}`);
console.log(`  估算媒体总字节: ${(() => {
  let total = 0;
  const seen = new Set();
  archive.tree.forEach(t => {
    (t.images || []).forEach(p => { if (!seen.has(p)) { seen.add(p); total += mediaBytesFor(p).byteLength; } });
    if (t.resourcePath && /\.wav$/i.test(t.resourcePath)) {
      if (!seen.has(t.resourcePath)) { seen.add(t.resourcePath); total += mediaBytesFor(t.resourcePath).byteLength; }
    }
  });
  return (total / 1048576).toFixed(1) + ' MB';
})()}`);

// ============ 模拟浏览器环境 ============
global.Blob = class Blob {
  constructor(parts, opts) { this.parts = parts || []; this.type = (opts && opts.type) || ''; this.size = this.parts.reduce((s, p) => s + (p.byteLength || p.length || p.size || 0), 0); }
  slice(a, b) { return this; }
  arrayBuffer() { return Promise.resolve(new ArrayBuffer(this.size)); }
};
global.Blob.prototype.text = function () { return Promise.resolve(''); };

global.window = global;
global.Uint8Array = Uint8Array;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.Promise = Promise;
global.Blob = global.Blob;
global.ArrayBuffer = ArrayBuffer;
global.DataView = DataView;
global.Uint16Array = Uint16Array;
global.Uint32Array = Uint32Array;
global.Int16Array = Int16Array;
global.String = String;
global.Math = Math;
global.JSON = JSON;
global.Date = Date;
global.Object = Object;
global.Array = Array;
global.Number = Number;
global.Error = Error;
global.RegExp = RegExp;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.console = console;
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => ({ tagName: tag.toUpperCase(), classList: { add: () => {}, remove: () => {}, toggle: () => {} }, setAttribute: () => {}, appendChild: () => {}, removeChild: () => {}, addEventListener: () => {}, style: {} }),
  createTextNode: () => ({}),
  getElementById: () => null,
  addEventListener: () => {},
  body: { appendChild: () => {}, removeChild: () => {} },
  documentElement: { appendChild: () => {}, removeChild: () => {} }
};
try { global.navigator = { userAgent: 'Mozilla/5.0 (Node.js Stress Test)', canShare: () => false, storage: { persist: () => Promise.resolve(false) } }; } catch(e) { try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Node.js Stress Test)', canShare: () => false, storage: { persist: () => Promise.resolve(false) } }, writable: true, configurable: true }); } catch(e2) {} }
global.location = { origin: 'http://localhost:3566' };
global.indexedDB = {
  open: () => {
    const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      req.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ get: () => ({ onsuccess: null, onerror: null, result: null }), put: () => ({ onsuccess: null, onerror: null }), delete: () => ({ onsuccess: null, onerror: null }) }),
        transaction: () => ({ objectStore: () => ({ get: () => ({ onsuccess: null, onerror: null, result: null }), put: () => ({ onsuccess: null, onerror: null }), delete: () => ({ onsuccess: null, onerror: null }) }), oncomplete: null, onerror: null, onabort: null }),
        close: () => {}
      };
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
};
global.URL = class URL {
  constructor(url, base) { this.href = url; this.origin = 'http://localhost:3566'; this.pathname = url; this.searchParams = { get: () => null, has: () => false }; }
  static createObjectURL() { return 'blob:mock-' + Math.random(); }
  static revokeObjectURL() {}
};

// 执行 zip-engine，注册 SuisuiZipWriter/SuisuiZipReader 到 global
const zipEngineSrc = fs.readFileSync('E:/Save/岁岁数据保存/suisui-backup/public/js/zip-engine.js', 'utf8');
eval(zipEngineSrc);

// 把 app.js 末尾的 IIFE 结尾 `}());` 改成暴露内部函数到 globalThis
const appSrc = fs.readFileSync('E:/Save/岁岁数据保存/suisui-backup/public/js/app.js', 'utf8');
const iifeEnd = appSrc.lastIndexOf('}());');
if (iifeEnd < 0) throw new Error('app.js IIFE end not found');
const patchedAppSrc = appSrc.slice(0, iifeEnd) + `
  window.__SUI_APP_INTERNAL__ = {
    archiveShape: archiveShape,
    normalizeItem: normalizeItem,
    counts: counts,
    IDB: IDB,
    emptyArchive: emptyArchive,
    dedupItems: dedupItems,
    moduleItems: moduleItems,
    profileOf: profileOf,
    S: S,
    PULL_MODULES: PULL_MODULES,
    commentsOf: commentsOf,
    labelsOf: labelsOf
  };
` + appSrc.slice(iifeEnd);
eval(patchedAppSrc);

const appInternal = globalThis.__SUI_APP_INTERNAL__;
if (!appInternal || !appInternal.archiveShape) throw new Error('archiveShape not found');
const { archiveShape, normalizeItem, counts, IDB, emptyArchive, dedupItems, moduleItems, profileOf, S, PULL_MODULES } = appInternal;

const SuisuiZipWriter = global.SuisuiZipWriter;
const SuisuiZipReader = global.SuisuiZipReader;

// ============ 工具函数 ============
function memMB() {
  const m = process.memoryUsage();
  return (m.heapUsed / 1048576).toFixed(1);
}
function elapsed(start) { return (performance.now() - start).toFixed(0); }

// ============ A. 旧版 v1.2.1 模拟 ============
async function testOldVersion() {
  console.log('\n=== A. 旧版 v1.2.1 模拟（复现 bug）===');
  const memBefore = memMB();
  const t0 = performance.now();

  const cp = { archive: emptyArchive(), count: 0, modules: { tree: { done: false, cursor: '', pageNo: 1, count: 0 } }, complete: false };
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(archive.tree.length / PAGE_SIZE);

  let maxPageTime = 0, totalApplyTime = 0, totalIdbTime = 0;

  for (let page = 0; page < totalPages; page++) {
    const pageStart = performance.now();
    const items = archive.tree.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const normalized = items.map(x => normalizeItem(x, 'tree'));

    // 旧版 applyPage 的 O(N²) 模式：全量 dedup + archiveShape + 每页 IDB.put
    cp.archive.tree = cp.archive.tree.concat(normalized);
    cp.archive = archiveShape(cp.archive);
    cp.count += normalized.length;
    cp.modules.tree.count = cp.archive.tree.length;
    cp.modules.tree.cursor = String((page + 1) * PAGE_SIZE);
    cp.modules.tree.pageNo += 1;
    cp.modules.tree.done = page >= totalPages - 1;
    const c = counts(cp.archive);
    const idbStart = performance.now();
    await IDB.put(cp);
    totalIdbTime += performance.now() - idbStart;
    const pageTime = performance.now() - pageStart;
    totalApplyTime += pageTime;
    if (pageTime > maxPageTime) maxPageTime = pageTime;
    if (page % 100 === 0) console.log(`  页 ${page.toString().padStart(4)}/${totalPages}: 本次 ${pageTime.toFixed(0)}ms (累计 ${elapsed(t0)}ms, 内存 ${memMB()}MB)`);
  }

  const memAfter = memMB();
  const totalTime = performance.now() - t0;
  console.log(`\n  [结果] 旧版同步 ${totalPages} 页:`);
  console.log(`    总耗时: ${totalTime.toFixed(0)}ms`);
  console.log(`    applyPage+counts 累计: ${totalApplyTime.toFixed(0)}ms`);
  console.log(`    IDB.put 累计: ${totalIdbTime.toFixed(0)}ms`);
  console.log(`    最慢单页: ${maxPageTime.toFixed(0)}ms`);
  console.log(`    内存增长: ${(parseFloat(memAfter) - parseFloat(memBefore)).toFixed(1)}MB`);
  console.log(`    最终树洞数: ${cp.archive.tree.length.toLocaleString()}`);
  return { totalTime, totalApplyTime, totalIdbTime, maxPageTime, memDelta: parseFloat(memAfter) - parseFloat(memBefore) };
}

// ============ B. 新版 v1.3.0 模拟 ============
async function testNewVersion() {
  console.log('\n=== B. 新版 v1.3.0 模拟（修复后）===');
  const memBefore = memMB();
  const t0 = performance.now();

  const cp = { archive: emptyArchive(), count: 0, modules: { tree: { done: false, cursor: '', pageNo: 1, count: 0 } }, complete: false };
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(archive.tree.length / PAGE_SIZE);

  let maxPageTime = 0, totalApplyTime = 0, totalIdbTime = 0, lastIdbWrite = 0;

  for (let page = 0; page < totalPages; page++) {
    const pageStart = performance.now();
    const items = archive.tree.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const normalized = items.map(x => normalizeItem(x, 'tree'));

    // 新版：只 normalize 当页，不重跑 archiveShape
    cp.archive.tree = cp.archive.tree.concat(normalized);
    cp.count += normalized.length;
    cp.modules.tree.count = cp.archive.tree.length;
    cp.modules.tree.cursor = String((page + 1) * PAGE_SIZE);
    cp.modules.tree.pageNo += 1;
    cp.modules.tree.done = page >= totalPages - 1;

    // 新版：节流 IDB.put（每 2.5s 或模块完成时）
    const now = performance.now();
    if (now - lastIdbWrite > 2500 || page === totalPages - 1 || cp.modules.tree.done) {
      const idbStart = performance.now();
      await IDB.put(cp);
      totalIdbTime += performance.now() - idbStart;
      lastIdbWrite = now;
    }

    const pageTime = performance.now() - pageStart;
    totalApplyTime += pageTime;
    if (pageTime > maxPageTime) maxPageTime = pageTime;
    if (page % 100 === 0) console.log(`  页 ${page.toString().padStart(4)}/${totalPages}: 本次 ${pageTime.toFixed(0)}ms (累计 ${elapsed(t0)}ms, 内存 ${memMB()}MB)`);
  }

  const memAfter = memMB();
  const totalTime = performance.now() - t0;
  console.log(`\n  [结果] 新版同步 ${totalPages} 页:`);
  console.log(`    总耗时: ${totalTime.toFixed(0)}ms`);
  console.log(`    applyPage+counts 累计: ${totalApplyTime.toFixed(0)}ms`);
  console.log(`    IDB.put 累计: ${totalIdbTime.toFixed(0)}ms`);
  console.log(`    最慢单页: ${maxPageTime.toFixed(0)}ms`);
  console.log(`    内存增长: ${(parseFloat(memAfter) - parseFloat(memBefore)).toFixed(1)}MB`);
  console.log(`    最终树洞数: ${cp.archive.tree.length.toLocaleString()}`);
  return { totalTime, totalApplyTime, totalIdbTime, maxPageTime, memDelta: parseFloat(memAfter) - parseFloat(memBefore) };
}

// ============ 测试 3: ZIP 打包对比 ============
async function testZipPacking() {
  console.log('\n=== 测试 3: ZIP 打包对比 ===');

  const mediaMap = new Map();
  archive.tree.forEach(t => {
    (t.images || []).forEach(p => { if (!mediaMap.has(p)) mediaMap.set(p, mediaBytesFor(p)); });
    if (t.resourcePath && /\.wav$/i.test(t.resourcePath) && !mediaMap.has(t.resourcePath)) {
      mediaMap.set(t.resourcePath, mediaBytesFor(t.resourcePath));
    }
  });
  const mediaFiles = Array.from(mediaMap.entries()).slice(0, 3000);
  const totalBytes = mediaFiles.reduce((s, [, b]) => s + b.byteLength, 0);
  console.log(`  模拟媒体文件: ${mediaFiles.length} 个, ${(totalBytes / 1048576).toFixed(1)}MB`);

  // A. 旧版（单卷一次性打包）
  {
    const memBefore = memMB();
    const t0 = performance.now();
    const writer = new SuisuiZipWriter();
    writer.add('data/archive.json', JSON.stringify(archive));
    for (const [path, bytes] of mediaFiles) {
      writer.add(path, bytes);
    }
    const blob = await writer.finalize();
    const t1 = performance.now();
    const memAfter = memMB();
    console.log(`  [旧版] 单卷打包 ${mediaFiles.length} 文件:`);
    console.log(`    耗时: ${(t1 - t0).toFixed(0)}ms, 内存: +${(parseFloat(memAfter) - parseFloat(memBefore)).toFixed(1)}MB, zip: ${(blob.size / 1048576).toFixed(1)}MB`);
  }

  // B. 新版（分卷打包，模拟 120MB/卷）
  {
    const memBefore = memMB();
    const t0 = performance.now();
    const MAX_VOL_BYTES = 120 * 1024 * 1024;
    let volIndex = 1;
    let currentWriter = new SuisuiZipWriter();
    let currentBytes = 0;
    const volumes = [];

    currentWriter.add('data/archive.json', JSON.stringify(archive));
    currentWriter.add('media-urls.txt', mediaFiles.map(([p]) => p).join('\n'));
    currentBytes += JSON.stringify(archive).length;

    for (const [path, bytes] of mediaFiles) {
      currentWriter.add(path, bytes);
      currentBytes += bytes.byteLength;
      if (currentBytes >= MAX_VOL_BYTES && currentWriter.entries.length > 0) {
        const blob = await currentWriter.finalize();
        volumes.push({ index: volIndex, blob, files: currentWriter.entries.length });
        volIndex++;
        currentWriter = new SuisuiZipWriter();
        currentBytes = 0;
      }
    }
    if (currentWriter.entries.length > 0) {
      const blob = await currentWriter.finalize();
      volumes.push({ index: volIndex, blob, files: currentWriter.entries.length });
    }

    const t1 = performance.now();
    const memAfter = memMB();
    console.log(`  [新版] 分卷打包 ${mediaFiles.length} 文件:`);
    console.log(`    卷数: ${volumes.length}, 各卷大小: ${volumes.map(v => (v.blob.size / 1048576).toFixed(1) + 'MB').join(', ')}`);
    console.log(`    耗时: ${(t1 - t0).toFixed(0)}ms, 内存: +${(parseFloat(memAfter) - parseFloat(memBefore)).toFixed(1)}MB`);
    console.log(`    总大小: ${(volumes.reduce((s, v) => s + v.blob.size, 0) / 1048576).toFixed(1)}MB`);
  }
}

// ============ 主流程 ============
(async () => {
  try {
    console.log('开始 A/B 对比压测...\n');
    const oldResult = await testOldVersion();
    const newResult = await testNewVersion();

    console.log('\n=== 对比总结 ===');
    const speedup = oldResult.totalTime / newResult.totalTime;
    console.log(`  同步总耗时: 旧版 ${oldResult.totalTime.toFixed(0)}ms → 新版 ${newResult.totalTime.toFixed(0)}ms (${speedup.toFixed(1)}x 快)`);
    console.log(`  applyPage+counts: 旧版 ${oldResult.totalApplyTime.toFixed(0)}ms → 新版 ${newResult.totalApplyTime.toFixed(0)}ms`);
    console.log(`  IDB.put: 旧版 ${oldResult.totalIdbTime.toFixed(0)}ms → 新版 ${newResult.totalIdbTime.toFixed(0)}ms`);
    console.log(`  最慢单页: 旧版 ${oldResult.maxPageTime.toFixed(0)}ms → 新版 ${newResult.maxPageTime.toFixed(0)}ms`);
    console.log(`  内存增长: 旧版 +${oldResult.memDelta.toFixed(1)}MB → 新版 +${newResult.memDelta.toFixed(1)}MB`);

    await testZipPacking();

    console.log('\n=== 结论 ===');
    if (newResult.totalTime < oldResult.totalTime * 0.7) console.log('✅ 新版显著快于旧版，O(N²) 修复有效');
    if (newResult.maxPageTime < 100) console.log('✅ 新版单页处理 < 100ms，无卡顿');
  } catch (e) {
    console.error('测试失败:', e);
    console.error(e.stack);
  }
})();
