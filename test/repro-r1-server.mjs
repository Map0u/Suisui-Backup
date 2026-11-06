/* ============================================================
 * R1/R2 服务端复现测试（打 /api/suisui/pull_page，桩掉 https.request）
 * 设施同 server/verify-all.js:16-37：node -r <preload.cjs> server/index.js
 *
 * 断言（来自验收评审，不许放宽）：
 *  R1  树洞评论上游 500：整页不应丢。期望 r.ok===true && items 里有 t1。
 *      当前 v1.3.0：评论 500 走完 3×3 重试后整个 pull_page 返回 ok:false —— 红。
 *  R1附 树洞列表上游不回包：不用真等，只记录服务端实际多少秒后返回什么。
 *      生产常量：网页 28s / 壳 30s / 服务端列表约 45s / 评论嵌套约 135s。
 *      实测服务端 upstream 超时是 index.js:189 的 15000ms + 重试，
 *      列表约 45s+ 才失败 —— 记到日志里，算「预期内报错」不算断言失败。
 *  R2附 letters_future：future 成功 f1，pastletter HTTP 500。
 *      期望至少一条：r.ok===false || r.hasMore===true || items 里有 _source==='past'。
 *      当前 index.js:797 把 past 错误吞成 {items:[],hasMore:false} —— 三条全挂 —— 红。
 *
 * 用法：
 *   node test/repro-r1-server.mjs                # 期望为红（当前代码是 bug），全红时退出码 1
 *   node test/repro-r1-server.mjs --expect-green # 修完后同断言应全绿，红则退出码 1
 * 结果另写一份到 test/results/r1-server-before.txt（或 --out 指定）。
 * ============================================================ */
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXPECT_GREEN = process.argv.includes('--expect-green');
const OUT_IDX = process.argv.indexOf('--out');
const OUT_FILE = OUT_IDX >= 0 && process.argv[OUT_IDX + 1] && !process.argv[OUT_IDX + 1].startsWith('--')
  ? path.resolve(process.argv[OUT_IDX + 1])
  : path.join(ROOT, 'test', 'results', 'r1-server-before.txt');
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const PORT = 23577;
const BASE = 'http://127.0.0.1:' + PORT;
const lines = [];
function log(s) { console.log(s); lines.push(s); }

/* ---------- preload 桩：换掉 https.request，行为由 R1_SCENARIO 环境变量控制 ----------
 * index.js 里 new URL(route, 'https://suisui666.cn/treehole/')：
 *   v1/treehole/mine?... -> /treehole/v1/treehole/mine?viewMinId=
 *   v1/treehole/comments/?treeHoleId=... -> /treehole/v1/treehole/comments/?treeHoleId=t1&viewMinId=
 *   v1/futureletter/?viewMinId= 、v1/pastletter/?viewMinId= 同理
 * 响应形状按 findArray（index.js:370 认 list/records/rows/items/...）
 * 和 pageResult（:560 认 hasMore / nextCursor）真实字段写：
 *   { code:0, data:{ list:[...], hasMore:false } }
 * normalize 的 id 来源 x.id，commentsCount 来源 x.commentsCount（:522/:537）。
 */
const PRELOAD = `
'use strict';
const https = require('https'), EventEmitter = require('events');
const SC = process.env.R1_SCENARIO || 'tree-comments-500';
https.request = function (opts, cb) {
  const req = new EventEmitter();
  let body = '';
  req.write = x => { body += x; };
  req.setHeader = () => {}; req.getHeader = () => {}; req.removeHeader = () => {};
  req.flushHeaders = () => {};
  req.destroy = e => { if (e) process.nextTick(() => req.emit('error', e)); };
  req.abort = () => {};
  const p = String(opts.path || '');
  function respond(status, obj) {
    const res = new EventEmitter();
    res.statusCode = status; res.headers = {};
    res.resume = () => {}; res.pause = () => {}; res.setEncoding = () => {};
    cb(res);
    res.emit('data', Buffer.from(JSON.stringify(obj)));
    res.emit('end');
  }
  req.end = () => process.nextTick(() => {
    try {
      if (SC === 'tree-comments-500') {
        if (p.includes('/treehole/mine')) return respond(200, { code: 0, msg: 'ok', data: { list: [{ id: 't1', content: 'hi', commentsCount: 1 }], hasMore: false } });
        if (p.includes('/treehole/comments')) return respond(500, { code: 500, msg: 'upstream boom' });
        return respond(200, { code: 0, data: { list: [], hasMore: false } });
      }
      if (SC === 'tree-hang') {
        /* 模拟真实 socket 行为：上游不回包，opts.timeout（index.js:189=15000）后
         * 触发 'timeout' → index.js:210 request.destroy(err) → 'error' → 上游重试。
         * 重试 3 次后服务端返回 ok:false。总耗时 ≈ 15s×3 + 退避 ≈ 45s+。 */
        if (p.includes('/treehole/mine')) { setTimeout(() => req.emit('timeout'), parseInt(opts.timeout, 10) || 15000); return; }
        return respond(200, { code: 0, data: { list: [], hasMore: false } });
      }
      if (SC === 'letters-past-500') {
        if (p.includes('/futureletter/')) return respond(200, { code: 0, data: { list: [{ id: 'f1', content: 'future hi' }], hasMore: false } });
        if (p.includes('/pastletter/')) return respond(500, { code: 500, msg: 'past boom' });
        return respond(200, { code: 0, data: { list: [], hasMore: false } });
      }
      return respond(200, { code: 0, data: { list: [], hasMore: false } });
    } catch (e) { /* 回调里抛错不能炸进程 */ }
  });
  return req;
};
`;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-repro-'));
const PRELOAD_FILE = path.join(TMP, 'mock-upstream.cjs');
fs.writeFileSync(PRELOAD_FILE, PRELOAD);

function startServer(scenario, extraEnv) {
  const child = spawn(process.execPath, ['-r', PRELOAD_FILE, path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), R1_SCENARIO: scenario, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => { lines.push('[server stderr] ' + String(d).trim()); });
  child.on('exit', (code) => { if (code) lines.push('[server exited] code=' + code); });
  return child;
}
function requestJson(route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + route, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body || {}));
  });
}
async function waitServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const ok = await new Promise(res => {
        const r = http.get(BASE + '/api/ping', x => { x.resume(); res(x.statusCode === 200); });
        r.on('error', () => res(false));
      });
      if (ok) return;
    } catch (_) { /* retry */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('服务未在 8s 内起来');
}
async function pullPage(body) { return requestJson('/api/suisui/pull_page', body); }

/* ---------- 断言记账 ----------
 * cond 为真 = 正确行为。红模式（当前 bug 版本）：cond 应为假 → 记 redCount。
 * 非零退出的两种情况：红模式下仍 redCount>0（bug 在，符合预期），
 * 或红模式下 unexpectedGreen>0（断言为真，复现失败/测歪了）。
 * 绿模式（修复后）：cond 应为真，为假则非零。 */
let redCount = 0, unexpectedGreen = 0, greenFails = 0;
function check(name, cond, detail) {
  const tag = EXPECT_GREEN
    ? (cond ? 'PASS(绿)' : 'FAIL(应绿却红)')
    : (cond ? 'UNEXPECTED-GREEN(bug 未复现)' : 'RED-AS-EXPECTED');
  if (EXPECT_GREEN) { if (!cond) greenFails++; }
  else { if (cond) unexpectedGreen++; else redCount++; }
  log(`[${tag}] ${name} :: ${detail}`);
}

/* ---------- 场景 1：树洞列表 ok + 评论 500 ---------- */
let server = startServer('tree-comments-500');
try {
  await waitServer();
  const t0 = Date.now();
  const r = await pullPage({ module: 'tree', token: 't', uid: 'u', batchPages: 1 });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const hasT1 = !!(r && Array.isArray(r.items) && r.items.some(i => String(i.id) === 't1'));
  const cond = !!(r && r.ok === true && hasT1);
  log(`R1 tree pull_page 返回(${sec}s): ok=${r && r.ok} msg=${r && r.msg} items=${r && Array.isArray(r.items) ? r.items.length : 'n/a'} hasT1=${hasT1}`);
  check('R1 评论失败仍保住整页 (r.ok===true && items 含 t1)', cond,
    `ok=${r && r.ok}, items=${r && JSON.stringify((r.items || []).map(i => i.id))}, msg=${r && r.msg}`);
} finally { server.kill('SIGKILL'); await new Promise(r => setTimeout(r, 300)); }

/* ---------- 场景 2：树洞列表上游不回包（挂死 90s，预期服务端 15s 超时 + 2 次重试 ≈ 45s+ 返回错误） ----------
 * 生产常量（注释，不用真等）：网页 28s / 壳 30s / 服务端列表约 45s / 评论嵌套约 135s。
 * 这里只记录服务端实际行为，不把它当硬断言（挂死本身要在客户端侧修）。
 */
server = startServer('tree-hang');
try {
  await waitServer();
  const t0 = Date.now();
  let r, err;
  try { r = await pullPage({ module: 'tree', token: 't', uid: 'u', batchPages: 1 }); }
  catch (e) { err = e; }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  log(`R1附 上游不回包：服务端 ${sec}s 后返回 ${r ? JSON.stringify(r) : ('fetch 错 ' + err)}`);
  log('R1附 说明：服务端 upstream 超时 index.js:189 = 15000ms ×3 次 ≈ 45s 后才失败；网页 28s 先超时 → 客户端等不到也不该整页卡死（记录在案，非硬断言）。');
} finally { server.kill('SIGKILL'); await new Promise(r => setTimeout(r, 300)); }

/* ---------- 场景 3：letters_future 里 past 500 被吞 ---------- */
server = startServer('letters-past-500');
try {
  await waitServer();
  const t0 = Date.now();
  const r = await pullPage({ module: 'letters_future', token: 't', uid: 'u', batchPages: 1 });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const okFalse = r && r.ok === false;
  const hasMore = r && r.hasMore === true;
  const hasPast = !!(r && Array.isArray(r.items) && r.items.some(i => i._source === 'past'));
  const cond = !!(okFalse || hasMore || hasPast);
  log(`R2附 letters_future 返回(${sec}s): ok=${r && r.ok} hasMore=${r && r.hasMore} items=${r && JSON.stringify((r.items || []).map(i => i.id + '/' + i._source))}`);
  check('R2附 past 失败可见 (ok===false 或 hasMore===true 或 items 含 _source=past)', cond,
    `ok=${r && r.ok}, hasMore=${r && r.hasMore}, sources=${r && JSON.stringify((r.items || []).map(i => i._source))}`);
} finally { server.kill('SIGKILL'); }

let verdict, exitCode;
if (EXPECT_GREEN) {
  verdict = greenFails ? `期望全绿但有 ${greenFails} 条仍红 → 修复未到位` : '全绿，修复到位';
  exitCode = greenFails ? 1 : 0;
} else {
  if (unexpectedGreen) { verdict = `${unexpectedGreen} 条断言意外为绿 → bug 未复现，检查 mock/断言`; exitCode = 1; }
  else if (redCount) { verdict = `${redCount} 条断言按预期为红 → bug 已复现（退出码 1 表示 bug 存在）`; exitCode = 1; }
  else { verdict = '无断言'; exitCode = 1; }
}
log('');
log(`总结：${verdict}（模式=${EXPECT_GREEN ? 'expect-green' : 'expect-red'}）`);
fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
console.log('结果写入 ' + OUT_FILE);
process.exit(exitCode);
