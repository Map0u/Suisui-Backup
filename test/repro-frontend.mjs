/* ============================================================
 * R2/R4/R5/R6 前端复现测试（真调 public/js/app.js 内部函数，不放宽断言）
 * 设施同 test/stress-ab.mjs:93-117：读 app.js 进 Node，在 IIFE 结尾 `}());`
 * 之前插一段 window.__SUI_APP_INTERNAL__ 暴露内部函数，refreshTopBackupBar
 * 顶栏用最小 DOM 桩真实渲染，不桩掉。
 *
 * 断言（来自验收评审，不许放宽）：
 *  R2 重复页被当成完成：cp.archive.tree 已有 a；再来一页 items:[同一条 a],
 *     hasMore:true, nextCursor:'c2'。期望 cp.modules.tree.done===false。
 *     当前 app.js:1064 把 added===0 也标 done —— 红。
 *  R5 评论不能盖掉：同一条树洞，短版 comments:[] 与长版 comments:[c1]，
 *     两个顺序分别经 dedupItems 合并。期望两个方向 c1 都还在。
 *     当前 dedupItems 命中 key 直接丢弃整条新项（含新评论）—— 先长后短红。
 *  R5附 评论没完不能算完成：引入 commentsPending（或等价位）后，
 *     cp.complete 在评论没齐时应为 false。当前没有这个概念 —— 红。
 *     改完后的判定：某条目 commentsCount > 实际收进 comments+subComments
 *     数时置 pending，存在 pending 则 cp.complete 不得为 true。
 *  R6 网页重开不假装齐全：真实 SuisuiZipReader 打包「索引卷+媒体卷」两卷，
 *     用真实 openArchiveFiles 只喂 files[0]（索引卷）。期望媒体读不到时
 *     不得存 complete:true、resume-banner 不得显示「已完整保存」。
 *     当前 app.js:956 无条件写 complete:true —— 红。
 *  R4 暂停能先存：S.pull={paused:true,errorMsg:'网络连接失败…',cp:{complete:false}},
 *     S.exporting=false。期望 syncStillGoing()===false 且顶栏
 *     #btn-export-all 不带 disabled。当前 app.js:2318 只看 !cp.complete —— 红。
 *
 * 用法：
 *   node test/repro-frontend.mjs                # 期望为红（当前代码是 bug），非零退出
 *   node test/repro-frontend.mjs --expect-green # 修完后同断言应全绿，红则退出码 1
 * 结果另写一份到 test/results/frontend-before.txt。
 * ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXPECT_GREEN = process.argv.includes('--expect-green');
const OUT_IDX = process.argv.indexOf('--out');
const OUT_FILE = OUT_IDX >= 0 && process.argv[OUT_IDX + 1] && !process.argv[OUT_IDX + 1].startsWith('--')
  ? path.resolve(process.argv[OUT_IDX + 1])
  : path.join(ROOT, 'test', 'results', 'frontend-before.txt');
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const lines = [];
function log(s) { console.log(s); lines.push(s); }

/* ==================== 最小 DOM 桩（够 refreshTopBackupBar 真画出按钮）==================== */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
let idSeq = 0;
const tokanizeCache = {};
function tokenize(html) {
  if (tokanizeCache[html]) return tokanizeCache[html];
  const tokens = [];
  const re = /<[a-zA-Z!\/][^>]*>|<!--|>/g;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) tokens.push({ text: html.slice(last, m.index) });
    tokens.push({ tag: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) tokens.push({ text: html.slice(last) });
  tokanizeCache[html] = tokens;
  return tokens;
}
function parseTag(tag) {
  const close = tag[1] === '/';
  const mm = tag.match(/^<\/?\s*([a-zA-Z0-9-]+)/);
  const name = mm ? mm[1].toLowerCase() : '';
  const attrs = {};
  if (!close) {
    /* 兼容裸属性（disabled / hidden / checked）：先剥掉 <name 与收尾 >，逐个匹配 name 或 name=value */
    const body = tag.replace(/^<\s*/, '').replace(/\/?\s*>$/, '');
    const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let am, first = true;
    while ((am = re.exec(body))) {
      if (first) { first = false; continue; } // 第一段是标签名
      attrs[am[1].toLowerCase()] = am[2] != null ? am[2] : (am[3] != null ? am[3] : (am[4] != null ? am[4] : ''));
    }
  }
  return { close, name, attrs, selfClose: /\/\s*>$/.test(tag) || VOID_TAGS.has(name) };
}
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function escapeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this._listeners = {};
    this._classSet = new Set();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this._id = ++idSeq;
    const self = this;
    this.classList = {
      add(...cs) { cs.forEach(c => c && self._classSet.add(c)); },
      remove(...cs) { cs.forEach(c => self._classSet.delete(c)); },
      toggle(c, force) {
        const want = force === undefined ? !self._classSet.has(c) : !!force;
        if (want) self._classSet.add(c); else self._classSet.delete(c);
        return want;
      },
      contains(c) { return self._classSet.has(c); }
    };
  }
  get className() { return [...this._classSet].join(' '); }
  set className(v) { this._classSet = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter(n => n.nodeType !== 3); }
  get parentElement() { const p = this.parentNode; return p && p.nodeType !== 3 ? p : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? (this.parentNode.childNodes[i + 1] || null) : null;
  }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === document; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) {
    if (n.nodeType === 11) { [...n.childNodes].forEach(c => this.insertBefore(c, ref)); return n; }
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = v;
    else if (k === 'id') this.id = String(v);
    else if (k === 'disabled') this.disabled = true;
    else if (k.indexOf('data-') === 0) {
      const key = k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
      this.dataset[key] = String(v);
    }
  }
  getAttribute(k) {
    if (k === 'class') return this.className || null;
    if (k === 'disabled') return this.disabled ? '' : null;
    return k in this.attrs ? this.attrs[k] : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener(t, f) {
    const l = this._listeners[t] || [];
    const i = l.indexOf(f);
    if (i >= 0) l.splice(i, 1);
  }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  closest(sel) { let n = this; while (n && n.nodeType !== 3) { if (matchOne(n, sel)) return n; n = n.parentNode; } return null; }
  get innerHTML() { return serialize(this); }
  set innerHTML(v) { this.childNodes.forEach(c => { c.parentNode = null; }); this.childNodes = []; parseInto(this, String(v)); }
  get textContent() {
    if (this.nodeType === 3) return this.data || '';
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v) { this.childNodes = []; this.appendChild(makeText(v)); }
  querySelector(s) { return qsa(this, s)[0] || null; }
  querySelectorAll(s) { return qsa(this, s); }
}
function makeText(v) { return { nodeType: 3, data: String(v), parentNode: null, get textContent() { return this.data; }, set textContent(x) { this.data = String(x); } }; }
function serialize(node) {
  return node.childNodes.map(n => {
    if (n.nodeType === 3) return escapeText(n.data);
    const attrs = [];
    const seen = new Set();
    for (const k of Object.keys(n.attrs)) { attrs.push(k + '="' + n.attrs[k] + '"'); seen.add(k); }
    if (n.className && !seen.has('class')) attrs.unshift('class="' + n.className + '"');
    if (n.disabled && !seen.has('disabled')) attrs.push('disabled');
    if (VOID_TAGS.has(n.tagName.toLowerCase())) return '<' + n.tagName.toLowerCase() + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
    return '<' + n.tagName.toLowerCase() + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + serialize(n) + '</' + n.tagName.toLowerCase() + '>';
  }).join('');
}
function parseInto(root, html) {
  const stack = [root];
  for (const tok of tokenize(html)) {
    if (tok.text != null) {
      const t = decodeEntities(tok.text);
      if (t) stack[stack.length - 1].appendChild(makeText(t));
      continue;
    }
    const tag = tok.tag;
    if (tag === '<!--') continue;
    if (tag === '>') { stack[stack.length - 1].appendChild(makeText('>')); continue; }
    const p = parseTag(tag);
    if (!p.name) continue;
    if (p.close) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === p.name.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(p.name);
    for (const k of Object.keys(p.attrs)) el.setAttribute(k, p.attrs[k]);
    stack[stack.length - 1].appendChild(el);
    if (!p.selfClose) stack.push(el);
  }
}
function matchOne(el, single) {
  if (el.nodeType === 3 || !el.tagName) return false;
  single = single.trim();
  const m = single.match(/^([a-zA-Z][\w-]*|)(\[[\w-]+\]|#[\w-]+|\.[\w-]+)*$/);
  if (!m || (!m[1] && !m[2])) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const rest = m[2] || '';
  const re = /(\[[\w-]+\]|#[\w-]+|\.[\w-]+)/g;
  let p;
  while ((p = re.exec(rest))) {
    const t = p[1];
    if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
    else if (t[0] === '.') { if (!el._classSet.has(t.slice(1))) return false; }
    else { const name = t.slice(1, -1); if (!el.hasAttribute(name)) return false; }
  }
  return true;
}
function qsa(root, selector) {
  const out = [];
  for (const single of selector.split(',')) {
    const s = single.trim();
    if (!s) continue;
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) continue;
        if (matchOne(c, s)) out.push(c);
        walk(c);
      }
    })(root);
  }
  return out;
}

const documentStub = {
  nodeType: 1,
  childNodes: [],
  parentNode: null,
  get isConnected() { return true; },
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; },
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; },
  querySelector(s) { return qsa(this, s)[0] || null; },
  querySelectorAll(s) { return qsa(this, s); },
  createElement(t) { return new El(t); },
  createTextNode(t) { return makeText(t); },
  createDocumentFragment() { const f = new El('#fragment'); f.nodeType = 11; return f; },
  getElementById(id) { return qsa(this, '#' + id)[0] || null; },
  addEventListener(type, fn) { (this._l = this._l || {})[type] = fn; },
  _fire(type, arg) { if (this._l && this._l[type]) this._l[type](arg); },
  documentElement: new El('html'),
  body: null
};
documentStub.body = new El('body');
documentStub.body.parentNode = documentStub;
const appRoot = new El('div');
appRoot.setAttribute('id', 'app');
documentStub.appendChild(appRoot);

/* ==================== 浏览器全局桩 ==================== */
global.window = global;
global.document = documentStub;
global.location = { origin: 'http://localhost:3566' };
try { global.navigator = { userAgent: 'Mozilla/5.0 (Node.js repro)', canShare: () => false, storage: { persist: () => Promise.resolve(false) }, maxTouchPoints: 0 }; }
catch (e) { Object.defineProperty(global, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Node.js repro)', canShare: () => false, maxTouchPoints: 0 }, writable: true, configurable: true }); }
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.window.scrollTo = () => {};
global.Image = class { set src(v) { if (this.onerror) setTimeout(() => this.onerror(), 0); } };
global.confirm = () => true;
global.fetch = () => Promise.reject(new Error('repro 环境没有网络'));
global.window.addEventListener = () => {};
if (typeof global.File === 'undefined') global.File = class File extends Blob { constructor(p, n, o) { super(p, o); this.name = n; } };
/* 内存版 IndexedDB：两个库 × 对象仓库 = 一张 Map，够 IDB.* / legacyDB 真实读写 */
function makeIDB() {
  const dbs = new Map();
  function getStore(dbName, store) {
    if (!dbs.has(dbName)) dbs.set(dbName, new Map());
    const db = dbs.get(dbName);
    if (!db.has(store)) db.set(store, new Map());
    return db.get(store);
  }
  function req(result) { const r = { result }; setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; }
  function storeApi(dbName, storeName) {
    return {
      get(k) { return req(getStore(dbName, storeName).get(k)); },
      put(v, k) { getStore(dbName, storeName).set(k !== undefined ? k : (v && v.id), v); return req(v); },
      delete(k) { getStore(dbName, storeName).delete(k); return req(undefined); }
    };
  }
  return {
    open(name) {
      const r = { result: null };
      setTimeout(() => {
        r.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => storeApi(name, '_'),
          transaction(storeName) {
            return {
              objectStore: () => storeApi(name, storeName),
              set oncomplete(f) { setTimeout(() => f && f(), 1); },
              onerror: null, onabort: null
            };
          },
          close() {}
        };
        if (r.onsuccess) r.onsuccess({ target: r });
      }, 0);
      return r;
    }
  };
}
global.indexedDB = makeIDB();
global.window.indexedDB = global.indexedDB;

/* ==================== 载入 zip-engine 与 app.js（IIFE 内插桩暴露内部函数）==================== */
eval(fs.readFileSync(path.join(ROOT, 'public/js/zip-engine.js'), 'utf8'));
const appSrc = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const iifeEnd = appSrc.lastIndexOf('}());');
if (iifeEnd < 0) throw new Error('app.js IIFE end not found');
const patched = appSrc.slice(0, iifeEnd) + `
  window.__SUI_APP_INTERNAL__ = {
    S: S, PULL_MODULES: PULL_MODULES, IDB: IDB,
    applyPage: applyPage, dedupItems: dedupItems, itemKey: itemKey,
    syncStillGoing: syncStillGoing, refreshTopBackupBar: refreshTopBackupBar,
    openArchiveFiles: openArchiveFiles, enterSuisuiApp: enterSuisuiApp,
    enterSavedAccount: enterSavedAccount, emptyArchive: emptyArchive,
    archiveShape: archiveShape, normalizeItem: normalizeItem,
    counts: counts, moduleItems: moduleItems, commentsOf: commentsOf,
    newCheckpoint: newCheckpoint, accountKeyOf: accountKeyOf
  };
` + appSrc.slice(iifeEnd);
eval(patched);
const APP = globalThis.__SUI_APP_INTERNAL__;
if (!APP || !APP.applyPage) throw new Error('内部函数暴露失败');
const { S, PULL_MODULES, IDB, applyPage, dedupItems, syncStillGoing, refreshTopBackupBar,
  openArchiveFiles, enterSuisuiApp, enterSavedAccount, emptyArchive, archiveShape,
  normalizeItem, moduleItems, newCheckpoint, accountKeyOf } = APP;
const SuisuiZipWriter = global.SuisuiZipWriter;
const SuisuiZipReader = global.SuisuiZipReader;

/* ==================== 断言小框架 ==================== */
const results = [];
function check(id, desc, cond, actual) {
  const tag = cond ? 'PASS' : 'FAIL';
  results.push({ id, cond });
  log(`  [${tag}] ${id} ${desc}` + (cond ? '' : `  (实际: ${actual})`));
}
function nextTick() { return new Promise(r => setTimeout(r, 60)); }
function freshCpTree(existingItems) {
  const cp = { id: 'active', archive: emptyArchive(), count: 0, modules: {}, complete: false };
  cp.archive = archiveShape(cp.archive);
  PULL_MODULES.forEach(m => { cp.modules[m.key] = { done: false, cursor: '', pageNo: 1, count: 0 }; });
  cp.modules.tree.count = existingItems.length;
  cp.archive.tree = existingItems.map(x => normalizeItem(x, 'tree'));
  return cp;
}

(async () => {
  document._fire('DOMContentLoaded'); // renderLanding，验证 DOM 桩能跑真实渲染路径
  await nextTick();

  /* ---------- R2：重复页被当成完成 ---------- */
  log('\n=== R2 重复页被当成完成（applyPage, app.js:1064）===');
  {
    const a = { id: 'a', time: '2020-01-01 00:00:00', text: 'hello', _source: 'tree' };
    const cp = freshCpTree([a]);
    cp.modules.tree.cursor = '';
    cp.modules.tree.pageNo = 1;
    const added = applyPage(cp, { key: 'tree' }, { items: [Object.assign({}, a)], hasMore: true, nextCursor: 'c2' });
    log(`    applyPage 返回 added=${added}, done=${cp.modules.tree.done}, cursor=${cp.modules.tree.cursor}`);
    check('R2', '整页都是已存在条目且 hasMore:true 时 modules.tree.done 应保持 false',
      cp.modules.tree.done === false, 'done=' + cp.modules.tree.done);
  }

  /* ---------- R5：评论不能盖掉（两个合并顺序）---------- */
  log('\n=== R5 评论不能盖掉（dedupItems 真实合并）===');
  {
    const short = () => normalizeItem({ id: 'a', time: '2020-01-01 00:00:00', text: 'hello', _source: 'tree', comments: [], commentsCount: 1 }, 'tree');
    const long = () => normalizeItem({ id: 'a', time: '2020-01-01 00:00:00', text: 'hello', _source: 'tree', comments: [{ id: 'c1', content: '抱抱你', time: '2020-01-02 00:00:00' }] }, 'tree');
    const order1 = dedupItems([short()], [long()]);   // 先短后长
    const order2 = dedupItems([long()], [short()]);   // 先长后短
    const has1 = order1[0] && order1[0].comments.some(c => c.id === 'c1');
    const has2 = order2[0] && order2[0].comments.some(c => c.id === 'c1');
    log(`    先短后长: comments=${order1[0].comments.map(c => c.id).join(',') || '(空)'}; 先长后短: comments=${order2[0].comments.map(c => c.id).join(',') || '(空)'}`);
    check('R5-短长', '先短后长合并后 c1 评论仍在', has1, JSON.stringify(order1[0].comments.map(c => c.id)));
    check('R5-长短', '先长后短合并后 c1 评论仍在（不得被后到的空评论版本盖掉）', has2, JSON.stringify(order2[0].comments.map(c => c.id)));
  }

  /* ---------- R5附：评论没完不能算完成 ---------- */
  log('\n=== R5附 评论没完不能算完成（commentsPending 判定）===');
  {
    const a = normalizeItem({ id: 'a', time: '2020-01-01 00:00:00', text: 'hello', _source: 'tree', comments: [], commentsCount: 3 }, 'tree');
    const cp = freshCpTree([a]);
    cp.modules.tree.done = true;
    cp.modules.tree.count = 1;
    PULL_MODULES.forEach(m => { cp.modules[m.key].done = true; });
    /* 评审认可的等价位：applyPage 应维护 cp.commentsPending（或等价字段），
     * 某条目 commentsCount > 实际收进条数时置 pending，存在 pending 时 cp.complete 不得为 true。
     * 改完后预期 applyPage 一条空响应或合并结果会把 commentsPending 标出来；
     * 复跑一次 applyPage 以走真实完成判定。 */
    applyPage(cp, { key: 'tree' }, { items: [], hasMore: false, nextCursor: '' });
    const pending = cp.commentsPending;
    log(`    cp.complete=${cp.complete}, cp.commentsPending=${pending === undefined ? '(字段不存在)' : pending}`);
    check('R5附-字段', '存在 commentsPending（或等价）标记，标出已收条目里评论未齐的条数',
      typeof pending === 'number' || Array.isArray(pending) || pending instanceof Set,
      typeof pending);
    const pendingCount = typeof pending === 'number' ? pending : (pending ? pending.size || pending.length || 0 : 0);
    check('R5附-判定', '存在评论未齐条目时 cp.complete 应为 false',
      pendingCount > 0 ? cp.complete === false : cp.complete === false,
      'complete=' + cp.complete + ' pending=' + pendingCount);
  }

  /* ---------- R6：网页重开不假装齐全（真实 openArchiveFiles + 真实 zip）---------- */
  log('\n=== R6 只开索引卷不得标完整（openArchiveFiles, app.js:956）===');
  {
    const archiveObj = emptyArchive();
    archiveObj.profile = { nickname: '测试岁友', uid: 'u-test' };
    archiveObj.tree = [normalizeItem({ id: 'a', time: '2020-01-01 00:00:00', text: 'hello', _source: 'tree', images: ['media/img1.png'], comments: [{ id: 'c1', content: 'x' }] }, 'tree')];

    const wIndex = new SuisuiZipWriter();
    wIndex.add('manifest.json', JSON.stringify({ version: 3, exportId: 'e1', accountKey: 'u-test', vol: '2/2', totalMedia: 1 }));
    wIndex.add('data/archive.json', JSON.stringify(archiveObj));
    const indexBlob = await wIndex.finalize();

    const wMedia = new SuisuiZipWriter();
    wMedia.add('manifest.json', JSON.stringify({ version: 3, exportId: 'e1', accountKey: 'u-test', vol: '1/2' }));
    wMedia.add('media/img1.png', new Uint8Array([1, 2, 3, 4]));
    await wMedia.finalize(); // 媒体卷真实打包但故意不交给 openArchiveFiles —— 模拟用户只选了索引卷

    indexBlob.name = 'suisui_第2卷（共2卷）.zip';

    const savedRecords = [];
    const origPut = IDB.put;
    IDB.put = function (cp) { savedRecords.push(cp); return origPut.call(this, cp); };
    S.token = ''; S.accountKey = ''; S.pull = null; S.archive = null; S.isLocalArchive = false; S.exporting = false;
    openArchiveFiles([indexBlob]);
    await nextTick(); // 等 reader.load() + readJSON + enterSuisuiApp + IDB.put 全部落定
    IDB.put = origPut;

    const rec = savedRecords[savedRecords.length - 1];
    const vols = S.zipReader ? (S.zipReader.volumes || []) : [];
    const mediaOk = !!(S.zipReader && S.zipReader.has('media/img1.png'));
    /* app.js:956 传给 IDB.put 的字面量是 {complete:true}；record.done 是 IDB.put
     * 内部再写库时换算的字段，这里记录的入参本身只有 complete 位。 */
    log(`    打开后: zipReader 卷数=${vols.length}, vols=${JSON.stringify(vols.map(v => v.vol))}, media/img1.png 可读=${mediaOk}`);
    log(`    IDB.put 入参: ${rec ? `complete=${rec.complete} source=${rec.source}` : '(未写入)'}`);
    check('R6-前置', '模拟成立：只喂了索引卷，媒体卷条目在 zipReader 里读不到', mediaOk === false, 'mediaOk=' + mediaOk);
    check('R6-完成位', '媒体读不到时 IDB.put 入参不得标 complete:true',
      !!(rec && rec.complete !== true),
      rec ? 'complete=' + rec.complete : '无记录');
    /* 「已完整保存」判定：loadResumeBanner 用 accounts_index_v1 里的 entry.done
     * 显示该文案。IDB.put 内部已把 complete 换算成 entry.done 真写进内存 IDB，
     * 这里读回复核 —— 等价于再走一遍 resume banner 的取值路径。 */
    const index = await IDB.read('accounts_index_v1');
    const entry = (index || []).find(x => x.key === 'u-test');
    const bannerText = entry ? (entry.done ? '已完整保存' : '已同步 ' + entry.progress + '%，可继续') : '(无账号索引)';
    log(`    accounts_index_v1 entry.done=${entry && entry.done}, 页面将显示「${bannerText}」`);
    check('R6-文案', '账号索引不得显示「已完整保存」（done 位为 false）',
      !!(entry && entry.done !== true), entry ? 'done=' + entry.done : '无索引');
  }

  /* ---------- R4：暂停能先存（syncStillGoing + 顶栏导出键 disabled）---------- */
  log('\n=== R4 暂停能先存（syncStillGoing, app.js:2318）===');
  {
    S.pull = { paused: true, running: false, stopped: false, errorMsg: '网络连接失败，请检查网络后重试', cp: { complete: false, modules: {} }, retryCount: 0, startedAt: Date.now(), startCount: 0, pendingTree: 0 };
    S.exporting = false;
    S.archive = archiveShape(emptyArchive());
    S.isLocalArchive = false;
    /* 用例顺序与评审一致：先真实渲染顶栏，再读按钮 disabled 位，
     * 最后调 syncStillGoing() —— disabled 字符串来自渲染瞬间的 syncing 值。 */
    refreshTopBackupBar(); // 真实渲染顶栏
    const topbar = document.querySelector('#backup-topbar');
    const exportBtn = topbar && topbar.querySelector('#btn-export-all');
    const still = syncStillGoing();
    const btnHtml = exportBtn ? serialize({ childNodes: [exportBtn] }) : '';
    log(`    syncStillGoing()=${still}; topbar 存在=${!!topbar}; #btn-export-all 存在=${!!exportBtn}`);
    log(`    导出按钮 HTML: ${btnHtml || '(无)'}`);
    log(`    顶栏标题: ${topbar ? (topbar.querySelector('.backup-status-title') || { textContent: '' }).textContent : '(无)'}`);
    check('R4-前置', '顶栏真实画出了导出按钮（DOM 桩没放过断言）', !!exportBtn, 'exportBtn 未渲染');
    check('R4-同步位', 'paused 状态下 syncStillGoing() 应返回 false', still === false, String(still));
    check('R4-导出键', '暂停时 #btn-export-all 不得带 disabled（先存已拉到的数据）',
      !!exportBtn && !exportBtn.disabled && !/disabled/.test(btnHtml),
      btnHtml || '无按钮');
  }

  /* ---------- 汇总 ---------- */
  const failed = results.filter(r => !r.cond);
  log(`\n=== 汇总: ${results.length - failed.length}/${results.length} 通过, ${failed.length} 条失败 ===`);
  if (failed.length) log('失败项: ' + failed.map(r => r.id).join(', '));
  fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');
  log(`结果已写入 ${OUT_FILE}`);

  if (EXPECT_GREEN) {
    process.exit(failed.length ? 1 : 0);
  } else {
    /* 默认模式：这是「在 v1.3.0 上一定失败」的复现，全绿才说明复现失效 */
    if (!failed.length) { console.error('\n!! 预期复现 bug 但全部通过 —— 复现已失效或代码已修复'); process.exit(2); }
    process.exit(1);
  }
})().catch(e => {
  log('\n!! 测试脚本自身异常: ' + (e && e.stack || e));
  fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');
  process.exit(3);
});
