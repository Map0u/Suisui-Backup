'use strict';
// 离线模拟上游以验证转发契约；绝不向真实手机号发送短信。
const { chromium } = require('playwright');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SUISUI_SHOTS_DIR || path.join(os.tmpdir(), 'suisui-verify-' + Date.now());
fs.mkdirSync(OUT, { recursive: true });
const RECORD = path.join(OUT, 'upstream-record.jsonl');
const MOCK = path.join(OUT, 'mock-upstream.cjs');
fs.writeFileSync(MOCK, `
const https = require('https'), fs = require('fs'), EventEmitter = require('events');
https.request = function (opts, cb) {
 const req = new EventEmitter(); let body = ''; req.write = x => { body += x; }; req.destroy = e => { if (e) req.emit('error', e); };
 req.end = () => process.nextTick(() => {
  fs.appendFileSync(process.env.MOCK_RECORD, JSON.stringify({method:opts.method,path:opts.path,headers:opts.headers,body:body})+'\\n');
  let result = {code:0,msg:'ok',data:[]};
  if (opts.path.includes('/general/valid/')) result.data = true;
  else if (opts.path.includes('/sys/sms?')) result.data = null;
  else if (opts.path.includes('/sys/sms/valid?')) result.data = true;
  else if (opts.path.endsWith('/general/pwd')) result.data = true;
  else if (opts.path.endsWith('/general/login')) { const data=JSON.parse(body); result = data.password === '123456' ? {code:1002,msg:'错误'} : {code:0,data:{token:'mock-token',userId:42,nickname:'测试居民'}}; }
  else if (opts.path.endsWith('/general/42')) result.data = {userId:42,nickname:'测试居民'};
  else if (opts.path.endsWith('/general/level')) result.data = {level:3};
  else if (opts.path.endsWith('/mood/sign/report')) result.data = {};
  else if (opts.path.endsWith('/treehole/mine?viewMinId=')) result.data = [{id:99,content:'测试内容',extraField:'原始字段'}];
  const res = new EventEmitter(); res.statusCode=200; res.headers={}; res.resume=()=>{}; cb(res); res.emit('data',Buffer.from(JSON.stringify(result))); res.emit('end');
 }); return req;
};
`);
const PORT = 23566, BASE = 'http://127.0.0.1:' + PORT;
const server = spawn(process.execPath, ['-r', MOCK, path.join(__dirname, 'index.js')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT), MOCK_RECORD: RECORD }, stdio: 'ignore' });
function request(method, route, body) { return new Promise((resolve, reject) => { const req = http.request(BASE + route, { method, headers: body ? { 'content-type': 'application/json' } : {} }, res => { const chunks=[]; res.on('data', c=>chunks.push(c)); res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()})); }); req.on('error',reject); if(body) req.end(JSON.stringify(body)); else req.end(); }); }
async function waitServer() { for(let i=0;i<50;i++){ try { if((await request('GET','/api/ping')).status===200) return; } catch(_){} await new Promise(r=>setTimeout(r,100)); } throw Error('服务未启动'); }
async function api(route, data) { const r=await request('POST','/api/suisui/'+route,data); return JSON.parse(r.body); }
function records() { return fs.readFileSync(RECORD,'utf8').trim().split('\n').map(JSON.parse); }
async function shot(page, name) { await page.screenshot({path:path.join(OUT,name)}); }
(async () => {
 let browser;
 try {
  await waitServer();
  assert.equal((await request('GET','/api/media-proxy?url='+encodeURIComponent('http://127.0.0.1/'))).status,403);
  assert.equal((await request('GET','/api/media-proxy?url='+encodeURIComponent('https://example.com/'))).status,403);
  const phone='13912345678';
  let r=await api('send_code',{phone}); assert(r.ok && r.isRegistered);
  r=await api('login',{phone,mode:'pwd',password:'abc123'}); assert(r.ok && r.uid==='42');
  r=await api('login',{phone,mode:'code',code:'123456'}); assert(!r.ok && r.needNewPwd);
  r=await api('login',{phone,mode:'code',code:'123456',password:'abc123'}); assert(r.ok);
  r=await api('pull_page',{token:'mock-token',uid:'42',module:'profile'}); assert(r.ok && r.profile._raw);
  r=await api('pull_page',{token:'mock-token',uid:'42',module:'tree'}); assert(r.ok && r.hasMore && r.nextCursor==='99' && r.items[0]._raw.extraField==='原始字段');
  r=await api('pull_page',{token:'mock-token',uid:'42',module:'tree',cursor:r.nextCursor}); assert(r.ok && !r.hasMore);
  for(const module of ['moods','diaries','letters_in','letters_reply','letters_future','fm','friends']) { r=await api('pull_page',{token:'mock-token',uid:'42',module}); assert(r.ok && !r.hasMore, module); }
  const rec=records();
  for(const part of ['/v1/mood/sign/1/20','/v1/diary/?viewMinId=','/v1/comfortletter/?viewMinId=','/v1/comfortletter/reply?viewMinId=','/v1/futureletter/?viewMinId=','/v1/pastletter/?viewMinId=','/v1/radio/myRadio','/v1/radio/like?viewMinId=','/v1/hope/mine?viewMinId=','/v1/general/follow?','/v1/general/fans?','/v1/general/vistor/who?']) assert(rec.some(x=>x.path.includes(part)), part);
  assert(rec.some(x=>x.method==='GET' && x.path==='/treehole/v1/general/valid/%2B86/'+phone));
  assert(rec.some(x=>x.method==='POST' && x.path==='/treehole/v1/sys/sms?mobile='+phone+'&type=1&nationalCode=%2B86' && !x.body));
  assert(rec.some(x=>x.path.includes('/general/pwd') && JSON.parse(x.body).nationalCode==='+86'));
  assert(rec.some(x=>x.path.endsWith('/general/42') && x.headers.token==='mock-token'));
  rec.forEach(x=>{ const h=x.headers; assert.equal(h.lang,'zh'); assert.equal(h.version,'5.6'); assert.equal(h.sign,crypto.createHash('md5').update(h.deviceId+h.ts+'1a92e8977af72a433ecb389f').digest('hex')); });
  console.log('模拟上游：签名、发码、两种登录、重置密码、个人主页和地址校验通过。');
  browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  const mobile=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const page=await mobile.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE); await page.locator('#in-phone').waitFor(); await shot(page,'01-mobile-login.png');
  await page.locator('#in-phone').fill('13800005666'); await page.locator('#in-pwd').fill('demo123'); await page.locator('#btn-login').click();
  await page.waitForFunction(()=>document.querySelectorAll('.feed-card').length >= 5); await page.locator('#btn-pause').click(); await page.locator('#btn-resume').waitFor();
  let cp=await page.evaluate(()=>new Promise((resolve,reject)=>{let r=indexedDB.open('suisui_rescue_db');r.onsuccess=()=>{let q=r.result.transaction('checkpoints').objectStore('checkpoints').get('active');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}));
  assert(cp && cp.count>0 && !cp.complete); assert(!JSON.stringify(cp).includes('demo-token'));
  await shot(page,'02-mobile-stream-resume.png');
  await page.reload(); await page.locator('#resume-login').waitFor(); await page.locator('#resume-login').click(); await page.locator('#in-pwd').fill('demo123');
  const calls=[]; page.on('request',req=>{if(req.url().endsWith('/api/suisui/pull_page')) calls.push(req.postDataJSON());});
  await page.locator('#btn-login').click(); await page.waitForFunction(()=>document.querySelector('#stream-status')?.textContent.includes('全部模块已拾起完毕'),null,{timeout:20000});
  for(const [key,state] of Object.entries(cp.modules)) if(state.done) assert(!calls.some(c=>c.module===key),'已完成模块不应重新请求 '+key);
  const firstRemaining=Object.keys(cp.modules).find(k=>!cp.modules[k].done); assert.equal(calls[0].module,firstRemaining); assert.equal(calls[0].pageNo,cp.modules[firstRemaining].pageNo); assert.equal(calls[0].cursor,cp.modules[firstRemaining].cursor);
  await page.locator('#btn-enter').click(); await shot(page,'03-mood.png');
  await page.locator('.tab').filter({hasText:'树洞'}).click(); await shot(page,'04-tree-planets.png');
  await page.locator('.tab').filter({hasText:'解忧馆'}).click(); await shot(page,'05-sorrow-post.png');
  await page.getByText('不晚博物馆',{exact:true}).click(); await shot(page,'06-museum-folded-card.png');
  await page.locator('.tab').filter({hasText:'互动'}).click(); await page.locator('.conv').first().click(); await shot(page,'07-hudong-chat.png');
  await page.locator('#btn-toggle-bg').click(); await shot(page,'08-chat-bg-switched.png'); await page.locator('.chatpage .back').click();
  await page.locator('.tab').filter({hasText:'我的'}).click(); await shot(page,'09-mine-profile.png');
  const desktop=await browser.newContext({viewport:{width:1440,height:900}}); const desk=await desktop.newPage(); desk.on('pageerror',e=>errors.push(e.message));
  await desk.goto(BASE); await desk.locator('#in-phone').waitFor(); await shot(desk,'12-desktop-login.png');
  await desk.locator('#in-phone').fill('13800005666'); await desk.locator('#in-pwd').fill('demo123'); await desk.locator('#btn-login').click(); await desk.waitForFunction(()=>document.querySelectorAll('.feed-card').length >= 5); await desk.locator('#btn-pause').click(); await desk.locator('#btn-resume').waitFor(); await shot(desk,'13-desktop-stream.png');
  await desk.locator('#btn-resume').click(); await desk.waitForFunction(()=>document.querySelector('#stream-status')?.textContent.includes('全部模块已拾起完毕'),null,{timeout:20000}); await desk.locator('#btn-enter').click(); await shot(desk,'14-desktop-hall-mood.png');
  await desk.locator('.tab').filter({hasText:'互动'}).click(); await desk.locator('.conv').first().click(); await shot(desk,'15-desktop-hall-chat.png');
  assert.deepEqual(errors,[]); await mobile.close(); await desktop.close();
  console.log('双视口截图及暂停、刷新、严格续传验证通过。截图目录：'+OUT);
 } finally { if(browser) await browser.close(); server.kill(); }
})().catch(err=>{ console.error(err); process.exitCode=1; });
