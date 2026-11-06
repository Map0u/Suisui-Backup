/* 压力测试：模拟上万条动态的 zip 打包，测内存与耗时 */
import { generate, mediaBytesFor } from './gen-massive-archive.js';
import { performance } from 'perf_hooks';

// 模拟浏览器环境的最小 API
global.Blob = class Blob {
  constructor(parts, opts) { this.parts = parts || []; this.type = (opts && opts.type) || ''; this.size = this.parts.reduce((s, p) => s + (p.byteLength || p.length || p.size || 0), 0); }
  slice(a, b) { return this; }
  arrayBuffer() { return Promise.resolve(new ArrayBuffer(this.size)); }
};
global.Blob.prototype.text = function () { return Promise.resolve(''); };

// 从 zip-engine 提取 SuisuiZipWriter（在 Node 环境跑核心逻辑）
const src = await import('fs').then(fs => fs.readFileSync('E:/Save/岁岁数据保存/suisui-backup/public/js/zip-engine.js', 'utf8'));
// 手动注入全局变量，让 zip-engine 能跑
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
global.console = console;
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');

// 执行 zip-engine.js，注册到 global
eval(src);

const { archive, mediaCount } = generate({ treeCount: 15000 });
console.log(`=== 生成超级大账号：${archive.tree.length} 条树洞，${mediaCount.img} 张图，${mediaCount.wav} 段语音 ===`);

// 计算真实总字节数
let totalMediaBytes = 0;
const seen = new Set();
archive.tree.forEach(t => {
  (t.images || []).forEach(p => { if (!seen.has(p)) { seen.add(p); totalMediaBytes += mediaBytesFor(p).byteLength; } });
  if (t.resourcePath && /\.wav$/i.test(t.resourcePath)) { if (!seen.has(t.resourcePath)) { seen.add(t.resourcePath); totalMediaBytes += mediaBytesFor(t.resourcePath).byteLength; } }
});
console.log(`媒体文件总数(去重): ${seen.size}，总字节: ${(totalMediaBytes / 1048576).toFixed(1)} MB`);

// 测试 1: archiveShape 深拷贝耗时与内存
const memBefore = process.memoryUsage();
const t0 = performance.now();
const shape = JSON.parse(JSON.stringify(archive)); // 模拟 archiveShape
const t1 = performance.now();
const memAfter = process.memoryUsage();
console.log(`\n[1] archiveShape 深拷贝:`);
console.log(`  耗时: ${(t1 - t0).toFixed(0)}ms`);
console.log(`  堆内存: +${((memAfter.heapUsed - memBefore.heapUsed) / 1048576).toFixed(1)}MB`);

// 测试 2: 全部塞入 zip（当前实现：parts 数组 + Blob）
const writer = new global.SuisuiZipWriter();
const t2 = performance.now();
try {
  writer.add('data/archive.json', JSON.stringify(archive));
  // 把所有媒体文件路径写入 zip（模拟真实导出）
  const mediaEntries = [];
  seen.forEach(p => mediaEntries.push([p, mediaBytesFor(p)]));
  console.log(`  开始 add ${mediaEntries.length} 个媒体文件...`);
  for (const [p, bytes] of mediaEntries) {
    writer.add(p, bytes);
  }
  const t3 = performance.now();
  console.log(`  add 完成: ${(t3 - t2).toFixed(0)}ms, entries=${writer.entries.length}, parts=${writer.parts.length}`);

  const blob = await writer.finalize();
  const t4 = performance.now();
  const memFinal = process.memoryUsage();
  console.log(`\n[2] zip 打包 (${mediaEntries.length} 媒体 + archive.json):`);
  console.log(`  总耗时: ${(t4 - t2).toFixed(0)}ms`);
  console.log(`  最终堆内存: +${((memFinal.heapUsed - memBefore.heapUsed) / 1048576).toFixed(1)}MB`);
  console.log(`  zip size: ${(blob.size / 1048576).toFixed(1)} MB, parts(残留): ${writer.parts ? writer.parts.length : 0}`);
} catch (e) {
  console.log(`  打包失败: ${e.message}`);
}

// 测试 3: 只打文字手账（不含媒体）
const writer2 = new global.SuisuiZipWriter();
const t5 = performance.now();
writer2.add('data/archive.json', JSON.stringify({ ...archive, tree: archive.tree.map(t => ({ ...t, images: [], audio: '', resourcePath: '' })) }));
const txtBlob = await writer2.finalize();
const t6 = performance.now();
console.log(`\n[3] 文字手账 only zip:`);
console.log(`  耗时: ${(t6 - t5).toFixed(0)}ms, size: ${(txtBlob.size / 1048576).toFixed(2)} MB`);

console.log('\n=== 结论 ===');
console.log('1. archiveShape 深拷贝 15000 条树洞: 内存与耗时如上');
console.log('2. 上万媒体文件打包 zip: 见 parts 数组与最终 Blob 内存');
console.log('3. 文字手账: 轻量可秒导');
