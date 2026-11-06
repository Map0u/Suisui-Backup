/* ============================================================
 * 岁岁·时光纪念馆 — 无状态零留存服务端
 * ------------------------------------------------------------
 * 纯 Node 原生 http，零外部依赖，端口 3566。
 *   GET  /                       静态资源（public/）
 *   GET  /api/ping               健康检查
 *   GET  /api/assets-bundle      核心图标 base64 字典（合成单文件 HTML 用）
 *   GET  /api/starlight          星光数量与毕业寄语列表
 *   POST /api/starlight          点亮星光 & 提交毕业寄语
 *   POST /api/suisui/*           上游转发层（未配置时返回演示桩）
 *   GET  /api/media-proxy        媒体流代理（支持 COS 私有桶自动签名 + 域名白名单校验）
 * 零留存：不落日志、不缓存用户个人数据。
 * ============================================================ */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var url = require('url');
var dns = require('dns');
var crypto = require('crypto');
var adapter = require('./adapter');

var PORT = parseInt(process.env.PORT || '3566', 10);
var HOST = process.env.HOST || '0.0.0.0';
var PUBLIC = path.join(__dirname, '..', 'public');

var upstreamAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
var mediaHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
var mediaHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8 });

var SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};

// 合成单文件 HTML 需要内联的核心图标（控制体积，只取小图标）
var BUNDLE_ICONS = [
  'icon/app_launcher_round.png', 'icon/logo_suisui.png', 'icon/logo_suisui_app.png',
  'sorrow/letter_stamp.png', 'sorrow/letter_can_open.png', 'feed/ic_give_hug.png',
  'feed/ic_mood_lock.png', 'feed/ic_sign_date.png', 'assets_baobao/baobao_0.png',
  'ic_hapy.png', 'ic_suisui.png'
];

function send(res, code, body, type, extraHeaders) {
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  var headers = Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(buf);
}

function json(res, code, obj, extraHeaders) {
  send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', extraHeaders);
}

function safeJsonParse(raw) {
  var str = String(raw || '');
  // 匹配完整 JSON 字符串字面量或字符串外部的 16+ 位长整数，仅将字符串外部的 64-bit 雪花 ID 转为字符串
  var fixed = str.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})(?=\s*[,}\]])/g, function (match, num) {
    return num ? '"' + num + '"' : match;
  });
  return JSON.parse(fixed);
}

function readBody(req) {
  return new Promise(function (resolve) {
    var chunks = [];
    var totalLen = 0;
    req.on('data', function (c) {
      chunks.push(c);
      totalLen += c.length;
      if (totalLen > 2 * 1024 * 1024) { req.destroy(); resolve({}); }
    });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(safeJsonParse(raw || '{}')); } catch (e) { resolve({}); }
    });
    req.on('error', function () { resolve({}); });
  });
}

/* ---------------- 静态资源 ---------------- */
function serveStatic(_req, res, pathname) {
  var rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  var file = path.normalize(path.join(PUBLIC, rel));
  if (file.indexOf(PUBLIC) !== 0) return send(res, 403, 'forbidden');
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, 'not found: ' + rel);
    var ext = path.extname(file).toLowerCase();
    var isImmutableAsset = /\.(png|jpg|jpeg|gif|svg|mp3|wav|ico)$/.test(ext);
    var headers = Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isImmutableAsset ? 'public, max-age=86400' : 'no-cache, no-store, must-revalidate'
    });
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- /api/assets-bundle ---------------- */
function assetsBundle(res) {
  var icons = {};
  var pending = BUNDLE_ICONS.length;
  BUNDLE_ICONS.forEach(function (name) {
    fs.readFile(path.join(PUBLIC, 'assets', name), function (err, buf) {
      if (!err) icons[name] = buf.toString('base64');
      if (--pending === 0) json(res, 200, { icons: icons, count: Object.keys(icons).length });
    });
  });
}

/* ---------------- /api/starlight 星光寄语墙 ---------------- */
var starlightState = {
  count: 1024,
  notes: [
    { text: '愿每一颗星星都有安歇的港湾，不急不忙，岁岁安康。', time: '2024-03-14' },
    { text: '即使走散在人海，回忆依然会在星夜闪烁。', time: '2024-08-15' },
    { text: '把心事存在岁岁，带着温暖走向明天。', time: '2025-01-01' },
    { text: '在不晚邮局寄出的愿望，终会在未来与你相遇。', time: '2025-06-30' }
  ]
};

function handleStarlight(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, count: starlightState.count, notes: starlightState.notes });
  }
  if (req.method === 'POST') {
    return readBody(req).then(function (body) {
      starlightState.count += 1;
      var rawNote = typeof body.note === 'string' ? body.note.trim() : '';
      if (rawNote) {
        var clean = rawNote.slice(0, 80);
        clean = clean.replace(/<[^>]*>/g, '');
        clean = clean.replace(/\d{6,}/g, '***');
        clean = clean.trim();
        if (clean) {
          starlightState.notes.unshift({
            text: clean,
            time: new Date().toISOString().slice(0, 10)
          });
          if (starlightState.notes.length > 50) {
            starlightState.notes = starlightState.notes.slice(0, 50);
          }
        }
      }
      return json(res, 200, { ok: true, count: starlightState.count, notes: starlightState.notes });
    });
  }
  return send(res, 405, 'method not allowed');
}

/* ---------------- /api/suisui/* 转发层 ---------------- */
function upstreamOnce(method, route, payload, auth, budgetMs) {
  var target = new URL(route, adapter.BASE_URL);
  if (target.origin !== new URL(adapter.BASE_URL).origin || target.pathname.indexOf('/treehole/') !== 0) {
    return Promise.reject(new Error('非法上游路径'));
  }
  return new Promise(function (resolve, reject) {
    var data = payload == null ? null : Buffer.from(JSON.stringify(payload));
    var headers = adapter.headers(auth && auth.token, auth && auth.phone, auth && auth.deviceId);
    if (data) headers['Content-Length'] = data.length;
    else if (method === 'POST') headers['Content-Length'] = 0;
    var request = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: method,
      headers: headers,
      agent: upstreamAgent,
      timeout: budgetMs == null ? 15000 : Math.min(15000, Math.max(1000, budgetMs))
    }, function (response) {
      var chunks = [], size = 0;
      response.on('data', function (chunk) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) request.destroy(new Error('上游响应过大'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', function () {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error('上游 HTTP ' + response.statusCode));
        }
        try {
          resolve(safeJsonParse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('上游返回非 JSON'));
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', function () { request.destroy(new Error('上游超时')); });
    if (data) request.write(data);
    request.end();
  });
}

async function upstream(method, route, payload, auth, budgetMs) {
  var lastErr, startedAt = Date.now();
  var timeoutMs = budgetMs == null ? 15000 : Math.min(15000, Math.max(1000, budgetMs));
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var onceBudget = budgetMs == null ? undefined : budgetMs - (Date.now() - startedAt);
      return await upstreamOnce(method, route, payload, auth, onceBudget);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        var remaining = budgetMs == null ? Infinity : budgetMs - (Date.now() - startedAt);
        if (remaining < timeoutMs) throw lastErr;
        await new Promise(function (r) { setTimeout(r, 250 * (attempt + 1)); });
      }
    }
  }
  throw lastErr;
}

function successful(r) { return r && r.code === 0; }
function checked(r) { if (!successful(r)) throw new Error((r && (r.msg || r.message)) || '上游请求失败'); return r.data; }
function q(v) { return encodeURIComponent(String(v == null ? '' : v)); }

/* ---------------- 腾讯云 COS 私有读 STS 签名 ---------------- */
var cosCredCache = {};
var cosCredKeys = [];
var cosCredInflight = {};

async function getCosCred(token) {
  var authToken = String(token || '').trim();
  if (!authToken) throw new Error('缺少登录凭证，无法签名媒体地址');
  var now = Date.now();
  var cached = cosCredCache[authToken];
  if (cached && cached.expiresAt > now) return cached;
  if (cosCredInflight[authToken]) return cosCredInflight[authToken];

  var pending = (async function () {
    var auth = { token: authToken };
    var results = await Promise.all([
      upstream('GET', 'v1/sys/config', null, auth).catch(function () { return null; }),
      upstream('GET', 'v1/sys/cos/token', null, auth)
    ]);
    var cfgData = (results[0] && results[0].data) || {};
    var tokenData = checked(results[1]) || {};
    if (!tokenData.tmpSecretId || !tokenData.tmpSecretKey || !tokenData.token) {
      throw new Error('获取 COS 临时凭证失败');
    }
    var entry = {
      authToken: authToken,
      bucket: cfgData.cosBucketName || 'app-treehole-1304424348',
      region: cfgData.cosRegion || 'ap-chengdu',
      tmpSecretId: tokenData.tmpSecretId,
      tmpSecretKey: tokenData.tmpSecretKey,
      securityToken: tokenData.token,
      expiresAt: Date.now() + 12 * 60 * 1000
    };
    if (!cosCredCache[authToken]) {
      cosCredKeys.push(authToken);
      if (cosCredKeys.length > 50) {
        var oldest = cosCredKeys.shift();
        delete cosCredCache[oldest];
      }
    }
    cosCredCache[authToken] = entry;
    return entry;
  })();
  cosCredInflight[authToken] = pending;
  try {
    return await pending;
  } finally {
    delete cosCredInflight[authToken];
  }
}

function signCosUrl(cred, cosPath) {
  var cleanPath = '/' + String(cosPath || '').replace(/^\/+/, '');
  var now = Math.floor(Date.now() / 1000);
  var keyTime = (now - 60) + ';' + (now + 7200);
  var signKey = crypto.createHmac('sha1', cred.tmpSecretKey).update(keyTime).digest('hex');
  var httpString = 'get\n' + cleanPath + '\n\n\n';
  var sha1Http = crypto.createHash('sha1').update(httpString).digest('hex');
  var stringToSign = 'sha1\n' + keyTime + '\n' + sha1Http + '\n';
  var signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  var qs = 'q-sign-algorithm=sha1'
    + '&q-ak=' + encodeURIComponent(cred.tmpSecretId)
    + '&q-sign-time=' + encodeURIComponent(keyTime)
    + '&q-key-time=' + encodeURIComponent(keyTime)
    + '&q-header-list='
    + '&q-url-param-list='
    + '&q-signature=' + encodeURIComponent(signature)
    + '&x-cos-security-token=' + encodeURIComponent(cred.securityToken);
  return 'https://' + cred.bucket + '.cos.' + cred.region + '.myqcloud.com' + cleanPath + '?' + qs;
}

/* ---------------- 媒体路径与数据标准化 ---------------- */
function cleanMediaPath(p) {
  if (!p || typeof p !== 'string') return '';
  var parts = p.split(';;');
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s && s !== 'null' && s !== 'undefined' && s !== ';empty;') return s;
  }
  return '';
}

function splitMediaPaths(raw) {
  if (!raw) return [];
  var arr = Array.isArray(raw) ? raw : String(raw).split(/;;|,/);
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var s = String(arr[i] || '').trim();
    if (s && s !== 'null' && s !== 'undefined' && s !== ';empty;') out.push(s);
  }
  return out;
}

function toMediaUrl(cosPath, token) {
  var p = String(cosPath || '').trim();
  if (!p || p === 'null' || p === 'undefined' || p === ';empty;') return '';
  if (/^https?:\/\//i.test(p)) {
    try {
      var full = new URL(p);
      var host = String(full.hostname || '').toLowerCase();
      var isCosHost = host.endsWith('.myqcloud.com') || host === 'myqcloud.com' || host === 'suisui666.cn' || host.endsWith('.suisui666.cn');
      if (isCosHost && !full.searchParams.has('q-sign-algorithm')) {
        p = full.pathname || '/';
        return '/api/media-proxy?path=' + encodeURIComponent(p) + (token ? '&token=' + encodeURIComponent(token) : '');
      }
    } catch (e) {}
    return p;
  }
  if (/^(\/?assets\/|data:|blob:|media\/|\/api\/media-proxy)/.test(p)) return p;
  return '/api/media-proxy?path=' + encodeURIComponent(p) + (token ? '&token=' + encodeURIComponent(token) : '');
}

var DEMO_ARCHIVE = (function () {
  var sandbox = { window: {} };
  require('vm').runInNewContext(fs.readFileSync(path.join(PUBLIC, 'js', 'demo-data.js'), 'utf8'), sandbox, { timeout: 1000 });
  return sandbox.window.SUISUI_DEMO_ARCHIVE;
})();

function demoPage(body) {
  var d = DEMO_ARCHIVE, module = body.module, page = Math.max(1, Number(body.pageNo) || 1);
  if (module === 'profile') {
    var demoProfile = shapeProfileExtras(Object.assign({}, d.profile), '');
    return { ok: true, profile: demoProfile, items: [demoProfile], hasMore: false, nextCursor: '' };
  }
  var lists = {
    moods: d.moods, diaries: d.diaries || [], tree: d.tree,
    letters_in: d.post.inbox, letters_reply: d.post.replied,
    letters_future: d.museum.future, fm: d.fm, friends: d.chats
  };
  if (!Object.prototype.hasOwnProperty.call(lists, module)) throw new Error('未知模块');
  var all = lists[module] || [], start = (page - 1) * 4;
  var items = all.slice(start, start + 4).map(function (x) { return normalize(x, module, module, ''); });
  return { ok: true, items: items, nextCursor: String(start + items.length), hasMore: start + items.length < all.length, rawCount: items.length };
}

function findArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  var keys = ['list', 'records', 'rows', 'items', 'content', 'data', 'result'];
  for (var i = 0; i < keys.length; i++) {
    if (Array.isArray(data[keys[i]])) return data[keys[i]];
    if (data[keys[i]] && typeof data[keys[i]] === 'object') {
      var nested = findArray(data[keys[i]]);
      if (nested) return nested;
    }
  }
  return null;
}

function cleanTime(t) {
  if (!t) return '';
  return String(t).replace(/\.0$/, '');
}

function labelsOf(value) {
  var out = [];
  function push(s) {
    s = String(s == null ? '' : s).trim();
    /* 过滤岁岁上游空槽位串（@￥@@#@￥@@#@…）与仅含分隔符的无效项 */
    if (!s || /^[@￥#\s]+$/.test(s)) return;
    if (out.indexOf(s) < 0) out.push(s);
  }
  var items = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  items.forEach(function (item) {
    if (item == null) return;
    if (typeof item === 'object') item = item.name || item.label || item.title || item.text || '';
    String(item).split(/@￥@|@#@|@￥|@#|;;|[,，、|]/).forEach(push);
  });
  return out;
}

function firstNum(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var n = Number(obj && obj[keys[i]]);
    if (n) return n;
  }
  return 0;
}

function dayOf(value) {
  var s = cleanTime(value || '');
  var m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : (s ? s.slice(0, 10) : '');
}

function shapeSignReport(sr) {
  if (!sr || typeof sr !== 'object' || Array.isArray(sr)) return {};
  var raw = sr.data && typeof sr.data === 'object' && !Array.isArray(sr.data) ? Object.assign({}, sr, sr.data) : sr;
  var ratios = [];
  var lists = [raw.ratios, raw.moodList, raw.list, raw.percents, raw.moodPercents, raw.reasonList, raw.items, raw.signList];
  for (var i = 0; i < lists.length && !ratios.length; i++) {
    if (!Array.isArray(lists[i])) continue;
    ratios = lists[i].map(function (x) {
      x = x || {};
      var percent = x.percent != null ? x.percent : (x.rate != null ? x.rate : (x.ratio != null ? x.ratio : x.value));
      return {
        name: x.name || x.moodName || x.causeName || x.label || x.title || '心情',
        percent: Number(percent || 0),
        count: Number(x.count || x.num || x.total || 0)
      };
    }).filter(function (x) { return x.name && (x.percent || x.count); });
  }
  if (!ratios.length) {
    [['开心', 'happyPercent', 'happyRate'], ['平静', 'calmPercent', 'calmRate'], ['疲惫', 'tiredPercent', 'tiredRate'], ['不开心', 'unhappyPercent', 'unhappyRate']].forEach(function (row) {
      var pct = 0;
      for (var j = 1; j < row.length; j++) {
        if (raw[row[j]] != null && raw[row[j]] !== '') { pct = Number(raw[row[j]]) || 0; break; }
      }
      if (pct) ratios.push({ name: row[0], percent: pct, count: 0 });
    });
  }
  return Object.assign({}, raw, {
    totalDays: firstNum(raw, ['totalDays', 'signDays', 'days', 'signCount', 'totalCount', 'accumulateDays', 'totalSignDays', 'signTotal', 'count']),
    continueDays: firstNum(raw, ['continueDays', 'continuousDays', 'keepDays', 'seriesDays']),
    betterThanPercent: firstNum(raw, ['betterThanPercent', 'betterPercent', 'beatPercent']),
    ratios: ratios
  });
}

function shapeProfileExtras(p, token) {
  p = p || {};
  var coverRaw = cleanMediaPath(p.homepageCover || p.homeCover || p.homeBg || p.background || p.userHomeBg || '');
  var frameRaw = cleanMediaPath(p.profileFrame || p.frameUrl || p.avatarFrame || p.headFrame || '');
  var musicRaw = cleanMediaPath(p.profileMusic || p.homeMusic || p.bgmUrl || p.bgm || p.musicUrl || '');
  p.homepageCover = toMediaUrl(coverRaw, token);
  p.homepageCoverRaw = coverRaw;
  p.profileFrame = toMediaUrl(frameRaw, token);
  p.profileFrameRaw = frameRaw;
  p.profileMusic = toMediaUrl(musicRaw, token);
  p.profileMusicRaw = musicRaw;
  p.labels = labelsOf(p.labels || p.label || p.tags || p.userLabels || p.labelNames);
  p.isGuardian = p.isGuardian === true || p.isGuardian === 1 || p.isGuardian === '1' || Number(p.guardian || p.guardStatus || 0) === 1;
  p.betterThanPercent = Number(p.betterThanPercent || p.betterPercent || p.beatPercent || 0) || 0;
  if (p.signReport) p.signReport = shapeSignReport(p.signReport);
  return p;
}

function publicError(err) {
  var msg = String((err && err.message) || '');
  if (/请先登录/.test(msg)) return '请先登录，再来整理回忆';
  if (/手机号/.test(msg) || /请选择登录方式/.test(msg)) return msg;
  return '网络开小差了，请稍后再试';
}

function normalize(item, module, source, token) {
  var x = item && typeof item === 'object' ? item : { value: item };
  var text = x.content || x.text || x.body || x.moodDesc || x.remark || x.description || x.signature || '';
  var title = x.title || x.name || x.moodName || x.topicTitle || '';
  var nickname = x.nickname || x.nickName || x.createUsername || x.userName || '';
  var avatarRaw = cleanMediaPath(x.createIcon || x.icon || x.iconUrl || x.avatar || '');
  var avatar = toMediaUrl(avatarRaw, token);

  var imagesRaw = [];
  var audioRaw = '';
  var videoRaw = '';
  var resType = Number(x.resourceType || 0);
  var resPath = String(x.resourcePath || '');
  var isAudioPath = /\.(wav|mp3|m4a|aac|ogg)$/i.test(resPath);
  var isVideoPath = /\.(mp4|mov|m4v|webm)$/i.test(resPath);
  if ((resType === 3 || isVideoPath) && x.resourcePath) {
    videoRaw = cleanMediaPath(x.resourcePath);
  } else if ((resType === 2 || isAudioPath) && x.resourcePath) {
    audioRaw = cleanMediaPath(x.resourcePath);
  } else if (resType === 1 && x.resourcePath) {
    imagesRaw = splitMediaPaths(x.resourcePath);
  } else {
    if (x.imgPath) imagesRaw = imagesRaw.concat(splitMediaPaths(x.imgPath));
    if (x.images) imagesRaw = imagesRaw.concat(splitMediaPaths(x.images));
    if (x.pictures) imagesRaw = imagesRaw.concat(splitMediaPaths(x.pictures));
    if (x.contentPic) imagesRaw = imagesRaw.concat(splitMediaPaths(x.contentPic));
    if (x.resourcePath && !isAudioPath && !isVideoPath) {
      imagesRaw = imagesRaw.concat(splitMediaPaths(x.resourcePath));
    }
  }
  if (!audioRaw && (x.audio || x.voiceUrl || x.radioUrl || x.musicUrl)) {
    audioRaw = cleanMediaPath(x.audio || x.voiceUrl || x.radioUrl || x.musicUrl);
  }
  if (!videoRaw && (x.video || x.videoUrl || x.videoPath)) {
    videoRaw = cleanMediaPath(x.video || x.videoUrl || x.videoPath);
  }

  var images = imagesRaw.map(function (p) { return toMediaUrl(p, token); }).filter(Boolean);
  var audio = toMediaUrl(audioRaw, token);
  var video = toMediaUrl(videoRaw, token);
  var coverRaw = cleanMediaPath(x.backgroundCover || x.bgCover || x.paperCover || x.skinPath || '');

  return Object.assign({}, x, {
    id: String(x.id || x.moodId || x.diaryId || x.letterId || x.treeHoleId || x.comfortLetterId || x.radioId || x.hopeId || x.uid || x.userId || ''),
    text: text,
    body: x.body || text,
    title: title,
    nickname: nickname,
    avatar: avatar,
    avatarRaw: avatarRaw,
    time: cleanTime(x.time || x.createTime || x.createdAt || x.date || x.regTime || ''),
    region: x.createRegion || x.region || '',
    images: images,
    imagesRaw: imagesRaw,
    audio: audio,
    audioRaw: audioRaw,
    audioSecond: Number(x.audioSecond || x.duration || 0),
    likeCount: Number(x.likeCount || 0),
    commentsCount: Number(x.commentsCount || 0),
    comments: Array.isArray(x.comments) ? x.comments : [],
    moodName: x.moodName || '',
    causeName: x.causeName || '',
    causeDesc: x.causeDesc || x.causeDetail || x.moodCauseDesc || '',
    backgroundCover: toMediaUrl(coverRaw, token),
    backgroundCoverRaw: coverRaw,
    topStatus: Number(x.topStatus != null ? x.topStatus : (x.isTop || 0)) || 0,
    isMember: x.isMember === true || Number(x.isMember || x.createMember || x.member || x.vip || 0) === 1,
    giftCount: Number(x.giftCount || x.gifts || x.presentCount || 0) || 0,
    callName: x.callName || x.call || x.toName || '',
    museumStatus: Number(x.museumStatus || x.collectStatus || 0) || 0,
    majorDay: dayOf(x.majorDay || x.openDay || x.openTime || x.arrive || ''),
    eachFollow: Number(x.eachFollow || x.eachOtherFollow || 0) || 0,
    sex: x.sex != null ? x.sex : (x.gender != null ? x.gender : ''),
    video: video,
    videoRaw: videoRaw,
    scope: x.scope || (x.anonymous === 1 ? 'anonymous' : 'public'),
    _source: source || module,
    _raw: item
  });
}

function pageResult(data, module, cursor, source, token) {
  var arr = findArray(data);
  if (!arr) throw new Error('上游 ' + (source || module) + ' 列表格式未知，已暂停以避免遗漏');
  var last = arr[arr.length - 1] || {};
  var next = data && (data.nextCursor || data.nextViewMinId || data.viewMinId || data.minId);
  if (next == null || next === '') next = last.id || last.treeHoleId || last.moodId || last.diaryId || last.letterId || last.comfortLetterId || last.radioId || last.hopeId || last.uid || last.userId || '';
  var more = data && typeof data.hasMore === 'boolean' ? data.hasMore : (arr.length > 0 && Boolean(next) && String(next) !== String(cursor));
  if (more && (!next || String(next) === String(cursor))) {
    more = false;
  }
  return {
    items: arr.map(function (x) { return normalize(x, module, source, token); }),
    nextCursor: more ? String(next) : '',
    hasMore: !!more,
    rawCount: arr.length
  };
}

function formatCommentItem(c, token) {
  var avatarRaw = cleanMediaPath(c.createIcon || c.icon || '');
  var picRaw = cleanMediaPath(c.contentPic || '');
  var subs = Array.isArray(c.subComments) ? c.subComments.map(function (sc) {
    var subAvatarRaw = cleanMediaPath(sc.createIcon || sc.icon || '');
    var subPicRaw = cleanMediaPath(sc.contentPic || '');
    return {
      id: String(sc.id || ''),
      uid: String(sc.createUid || ''),
      nickname: sc.createUsername || sc.nickName || '岁友',
      avatar: toMediaUrl(subAvatarRaw, token),
      avatarRaw: subAvatarRaw,
      level: Number(sc.createLevel || 0),
      isMember: Number(sc.createMember || 0) === 1,
      replyTo: sc.replyUsername || '',
      region: sc.createRegion || '',
      time: cleanTime(sc.createTime),
      content: sc.content || '',
      likeCount: Number(sc.likeCount || 0),
      image: toMediaUrl(subPicRaw, token),
      imageRaw: subPicRaw
    };
  }) : [];
  return {
    id: String(c.id || c.commentId || ''),
    uid: String(c.createUid || ''),
    nickname: c.createUsername || c.nickName || '岁友',
    avatar: toMediaUrl(avatarRaw, token),
    avatarRaw: avatarRaw,
    level: Number(c.createLevel || 0),
    isMember: Number(c.createMember || 0) === 1,
    region: c.createRegion || '',
    time: cleanTime(c.createTime),
    content: c.content || '',
    likeCount: Number(c.likeCount || 0),
    replyCount: Number(c.replyCount || subs.length || 0),
    image: toMediaUrl(picRaw, token),
    imageRaw: picRaw,
    subComments: subs
  };
}

async function fetchTreeCommentsPage(treeHoleId, cursor, budgetMs, auth) {
  var startedAt = Date.now();
  function localRemainingMs() {
    return budgetMs == null ? undefined : budgetMs - (Date.now() - startedAt);
  }
  function checkBudget() {
    if (budgetMs != null && localRemainingMs() <= 0) throw new Error('上游请求预算已用尽');
  }

  checkBudget();
  var r = await upstream('GET', 'v1/treehole/comments/?treeHoleId=' + q(treeHoleId) + '&viewMinId=' + q(cursor), null, auth, localRemainingMs());
  if (!successful(r)) throw new Error('评论上游请求失败');
  var arr = findArray(r.data) || [];
  var comments = [];
  for (var i = 0; i < arr.length; i++) {
    var rawComm = arr[i];
    var formatted = formatCommentItem(rawComm, auth.token);
    if (Number(rawComm.replyCount || 0) > formatted.subComments.length && formatted.id) {
      checkBudget();
      var subRes = await upstream('GET', 'v1/treehole/comments/sub?treeHoleId=' + q(treeHoleId) + '&commentId=' + q(formatted.id), null, auth, localRemainingMs());
      if (successful(subRes)) {
        var subArr = findArray(subRes.data) || [];
        var merged = [];
        var seen = Object.create(null);
        formatted.subComments.concat(formatCommentItem(Object.assign({}, rawComm, { subComments: subArr }), auth.token).subComments).forEach(function (sub) {
          var key = String(sub.id || '') || [sub.uid, sub.time, sub.content].join('|');
          if (!seen[key]) {
            seen[key] = true;
            merged.push(sub);
          }
        });
        formatted.subComments = merged;
        formatted.replyCount = Math.max(formatted.replyCount, merged.length, Number(rawComm.replyCount || 0));
      }
    }
    comments.push(formatted);
  }
  var last = arr[arr.length - 1] || {};
  var nextCursor = String(last.id || last.commentId || '');
  var hasMore = r.data && typeof r.data.hasMore === 'boolean' ? r.data.hasMore : arr.length > 0;
  return { items: comments, nextCursor: nextCursor, hasMore: !!hasMore };
}

async function realPage(body) {
  var t0 = Date.now();
  var PULL_PAGE_BUDGET_MS = 20000;
  function remainingMs() { return PULL_PAGE_BUDGET_MS - (Date.now() - t0); }

  var token = body.token || '';
  var auth = { token: token, phone: body.phone, deviceId: body.deviceId };
  var module = body.module;
  var cursor = body.cursor || '';
  var page = Math.max(1, Number(body.pageNo) || 1);
  var uid = q(body.uid);
  if (!token) throw new Error('请先登录岁岁账号');

  async function get(route) { return checked(await upstream('GET', route, null, auth, remainingMs())); }

  if (module === 'profile') {
    getCosCred(token).catch(function () {});
    var profileData = await Promise.all([
      get('v1/general/' + uid),
      get('v1/general/level').catch(function () { return {}; }),
      get('v1/mood/sign/report').catch(function () { return {}; }),
      get('v1/comfortrestaurant/restaurant/detail').catch(function () { return {}; })
    ]);
    var p = profileData[0] || {};
    var lv = profileData[1] || {};
    var sr = profileData[2] || {};
    var rest = profileData[3] || {};
    var avatarRaw = cleanMediaPath(p.icon || p.iconUrl || '');
    var joinTime = cleanTime(p.regTime || p.joinTime || '');
    var days = 1;
    if (joinTime) {
      var ms = Date.now() - new Date(joinTime.replace(/-/g, '/')).getTime();
      if (ms > 0) days = Math.max(1, Math.ceil(ms / 86400000));
    }
    var profile = Object.assign({}, p, {
      uid: String(p.id || body.uid || ''),
      nickname: p.nickName || p.nickname || p.userName || '岁岁旅人',
      avatar: toMediaUrl(avatarRaw, token),
      avatarRaw: avatarRaw,
      signature: p.signature || '',
      region: p.region || '',
      joinTime: joinTime,
      companion_days: days,
      growth_level: p.userLevel || lv.level || 1,
      followCount: Number(p.followCount || 0),
      fansCount: Number(p.fansCount || 0),
      visitCount: Number(p.visitCount || 0),
      treeholeCount: Number(p.treeholeCount || 0),
      comfortCount: Number(p.comfortCount || 0),
      restaurantName: rest.name || '',
      signReport: shapeSignReport(sr),
      _raw: { profile: p, level: lv, signReport: sr, restaurant: rest }
    });
    profile = shapeProfileExtras(profile, token);
    return { ok: true, profile: profile, items: [profile], nextCursor: '', hasMore: false };
  }

  if (module === 'comments') {
    var treeId = String(body.treeId || '').trim();
    if (!treeId) throw new Error('缺少 treeId 参数');
    var commCur = String(body.cursor || '');
    var commItems = [];
    var commHasMore = false;
    while (remainingMs() > 0) {
      var commPage = await fetchTreeCommentsPage(treeId, commCur, remainingMs(), auth);
      commItems = commItems.concat(commPage.items);
      commCur = commPage.nextCursor;
      commHasMore = commPage.hasMore;
      if (!commHasMore || !commCur) break;
    }
    return {
      ok: true,
      items: commItems,
      nextCursor: commHasMore ? commCur : '',
      hasMore: commHasMore,
      treeId: treeId
    };
  }

  if (module === 'moods') {
    if (remainingMs() <= 0) return { ok: true, items: [], nextCursor: String(page), hasMore: true, rawCount: 0 };
    var moodData = await get('v1/mood/sign/' + page + '/20');
    var arr = findArray(moodData);
    if (!arr) throw new Error('上游心情列表格式未知，已暂停以避免遗漏');
    var more = moodData && typeof moodData.hasMore === 'boolean' ? moodData.hasMore : arr.length >= 20;
    return {
      ok: true,
      items: arr.map(function (x) { return normalize(x, module, 'moods', token); }),
      nextCursor: more ? String(page + 1) : '',
      hasMore: !!more,
      rawCount: arr.length
    };
  }

  if (module === 'tree') {
    var batchPages = 1;
    var allTreeItems = [];
    var cur = cursor;
    var hasMoreTree = false;
    for (var b = 0; b < batchPages; b++) {
      if (remainingMs() <= 0) break;
      var treeRaw = await get('v1/treehole/mine?viewMinId=' + q(cur));
      var pr = pageResult(treeRaw, 'tree', cur, 'tree', token);
      allTreeItems = allTreeItems.concat(pr.items);
      cur = pr.nextCursor;
      hasMoreTree = pr.hasMore;
      if (!hasMoreTree || !cur) break;
    }

    var pendingComments = [];
    for (var i = 0; i < allTreeItems.length; i++) {
      var item = allTreeItems[i];
      if (item.commentsCount > 0 && item.id) {
        pendingComments.push({ treeId: String(item.id), commentsCursor: '' });
      }
    }

    if (JSON.stringify({ items: allTreeItems }).length < 20480 && pendingComments.length <= 30) {
      for (var j = 0; j < allTreeItems.length; j++) {
        var treeItem = allTreeItems[j];
        if (treeItem.commentsCount > 0 && treeItem.id) {
          if (remainingMs() <= 0) break;
          try {
            var cPage = await fetchTreeCommentsPage(treeItem.id, '', remainingMs(), auth);
            treeItem.comments = cPage.items;
            if (!cPage.hasMore) {
              pendingComments = pendingComments.filter(function (pc) { return pc.treeId !== String(treeItem.id); });
            }
          } catch (cErr) {
            treeItem.commentsError = (cErr && cErr.message) || String(cErr);
          }
        }
      }
    }

    var treeResp = {
      ok: true,
      items: allTreeItems,
      nextCursor: hasMoreTree ? cur : '',
      hasMore: !!hasMoreTree,
      rawCount: allTreeItems.length
    };
    if (pendingComments.length > 0) {
      treeResp.pendingComments = pendingComments;
    }
    return treeResp;
  }

  var routes = {
    diaries: 'v1/diary/?viewMinId=',
    letters_in: 'v1/comfortletter/?viewMinId=',
    letters_reply: 'v1/comfortletter/reply?viewMinId='
  };
  if (routes[module]) {
    var routeBatch = Math.min(5, Math.max(1, Number(body.batchPages) || 3));
    var routeItems = [];
    var rCur = cursor;
    var rMore = false;
    for (var rb = 0; rb < routeBatch; rb++) {
      if (remainingMs() <= 0) {
        rMore = true;
        break;
      }
      var rPr = pageResult(await get(routes[module] + q(rCur)), module, rCur, module, token);
      routeItems = routeItems.concat(rPr.items);
      rCur = rPr.nextCursor;
      rMore = rPr.hasMore;
      if (!rMore || !rCur) break;
    }
    return { ok: true, items: routeItems, nextCursor: rMore ? rCur : '', hasMore: !!rMore, rawCount: routeItems.length };
  }

  if (module === 'letters_future' || module === 'fm' || module === 'friends') {
    var state = {};
    if (cursor) { try { state = JSON.parse(cursor); } catch (e) { throw new Error('无效的复合分页游标'); } }
    var specs = module === 'letters_future' ? [
      { key: 'future', fetch: function (c) { return get('v1/futureletter/?viewMinId=' + q(c)); } },
      { key: 'past', fetch: function (c) { return get('v1/pastletter/?viewMinId=' + q(c)); } }
    ] : module === 'fm' ? [
      { key: 'radio', fetch: function (_c, n) { return upstream('POST', 'v1/radio/myRadio', { uid: String(body.uid || ''), pageNum: String(n), pageSize: '20' }, auth, remainingMs()).then(checked); }, numbered: true },
      { key: 'like', fetch: function (c) { return get('v1/radio/like?viewMinId=' + q(c)); } },
      { key: 'hope', fetch: function (c) { return get('v1/hope/mine?viewMinId=' + q(c)); } }
    ] : [
      { key: 'follow', fetch: function (c) { return get('v1/general/follow?uid=' + uid + '&viewMinId=' + q(c)); } },
      { key: 'fans', fetch: function (c) { return get('v1/general/fans?uid=' + uid + '&viewMinId=' + q(c)); } },
      { key: 'visitors', fetch: function (c) { return get('v1/general/vistor/who?viewMinId=' + q(c)); } }
    ];
    var compBatch = Math.min(5, Math.max(1, Number(body.batchPages) || 4));
    var items = [];
    for (var cb = 0; cb < compBatch; cb++) {
      if (remainingMs() <= 0) break;
      var anyMore = false;
      for (var i = 0; i < specs.length; i++) {
        if (remainingMs() <= 0) break;
        var spec = specs[i], s = state[spec.key] || { cursor: '', page: 1, done: false };
        if (!s.done) {
          var result = await spec.fetch(s.cursor, s.page), list = findArray(result);
          if (!list) throw new Error('上游 ' + spec.key + ' 列表格式未知，已暂停以避免遗漏');
          if (spec.numbered) {
            var hm = result && typeof result.hasMore === 'boolean' ? result.hasMore : list.length >= 20;
            items = items.concat(list.map(function (x) { return normalize(x, module, spec.key, token); }));
            s.done = !hm;
            s.page++;
          } else {
            var subPr = pageResult(result, module, s.cursor, spec.key, token);
            items = items.concat(subPr.items);
            s.cursor = subPr.nextCursor;
            s.done = !subPr.hasMore;
          }
        }
        state[spec.key] = s;
        if (!s.done) anyMore = true;
      }
      if (!anyMore) break;
    }
    var hasMore = specs.some(function (spec) { return !state[spec.key] || !state[spec.key].done; });
    return { ok: true, items: items, nextCursor: hasMore ? JSON.stringify(state) : '', hasMore: hasMore, rawCount: items.length };
  }
  throw new Error('未知模块');
}

async function proxyUpstream(_req, res, routeName, body) {
  var demo = body.demo === true || body.phone === '13800005666';
  try {
    if (routeName === 'send_code') {
      if (!/^1\d{10}$/.test(body.phone || '')) return json(res, 200, { ok: false, msg: '手机号格式不正确' });
      if (demo) return json(res, 200, { ok: true, demo: true, code: 0, msg: '演示模式：验证码 000000', data: null, isRegistered: true });
      var valid = await upstream('GET', 'v1/general/valid/%2B86/' + q(body.phone), null, body);
      var registered = checked(valid) === true;
      var sms = await upstream('POST', 'v1/sys/sms?mobile=' + q(body.phone) + '&type=1&nationalCode=%2B86', null, body);
      return json(res, 200, Object.assign({}, sms, { ok: successful(sms), isRegistered: registered }));
    }
    if (routeName === 'login') {
      if (!/^1\d{10}$/.test(body.phone || '')) return json(res, 200, { ok: false, msg: '手机号格式不正确' });
      if (body.mode !== 'pwd' && body.mode !== 'code') return json(res, 200, { ok: false, msg: '请选择登录方式' });
      if (demo) return json(res, 200, { ok: true, demo: true, token: 'demo-token', uid: 'demo', userBean: DEMO_ARCHIVE.profile });
      var loginBody = { mobile: body.phone, password: body.password, nationalCode: '+86', code: null }, result;
      if (body.mode === 'code') {
        if (body.password) checked(await upstream('POST', 'v1/general/pwd', { mobile: body.phone, password: body.password, code: body.code, nationalCode: '+86' }, body));
        loginBody.password = body.password || body.code;
        loginBody.code = body.code;
      }
      result = await upstream('POST', 'v1/general/login', loginBody, body);
      if (body.mode === 'code' && !body.password && result.code === 1002) {
        return json(res, 200, { ok: false, needNewPwd: true, msg: '岁岁老账号使用验证码登录时，请顺手输入一个新密码（6-16位字母+数字）即可一键重置并登录' });
      }
      if (!successful(result) || !result.data) {
        return json(res, 200, { ok: false, code: result.code, msg: result.msg || '登录失败' });
      }
      var tk = result.data.token;
      getCosCred(tk).catch(function () {});
      var avatarRaw = cleanMediaPath(result.data.iconUrl || result.data.icon || '');
      var userBean = shapeProfileExtras(Object.assign({}, result.data, {
        uid: String(result.data.userId || ''),
        nickname: result.data.nickName || result.data.nickname || '岁岁旅人',
        avatar: toMediaUrl(avatarRaw, tk),
        avatarRaw: avatarRaw
      }), tk);
      return json(res, 200, { ok: true, token: tk, uid: String(result.data.userId || ''), userBean: userBean });
    }
    if (routeName === 'pull_page') {
      return json(res, 200, demo ? demoPage(body) : await realPage(body));
    }
    if (routeName === 'comments') {
      return json(res, 200, await realPage(Object.assign({}, body, { module: 'comments' })));
    }
    return json(res, 200, { ok: false, msg: '未知接口' });
  } catch (err) {
    return json(res, 200, { ok: false, msg: publicError(err) });
  }
}

function serveApkDownload(res) {
  var file = path.join(PUBLIC, 'download', 'suisui-memorial.apk');
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, '安装包还在准备中，请稍后再试');
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="suisui-memorial.apk"',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=86400'
    }));
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- /api/media-proxy（COS 签名 + 地址校验 + 并发与大小限制） ---------------- */
var activeProxyPerIP = {};
var MAX_RESPONSE_BYTES = 120 * 1024 * 1024; // 120 MB

function isPrivateIP(ip) {
  if (!ip) return true;
  var s = String(ip).trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  var m4 = s.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) {
    var a = parseInt(m4[1], 10), b = parseInt(m4[2], 10);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (s === '::1' || s === '::' || s === '0:0:0:0:0:0:0:1' || s === '0:0:0:0:0:0:0:0') return true;
  if (s.startsWith('fc') || s.startsWith('fd')) return true;
  if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
  return false;
}

async function handleMediaProxyRequest(req, res, query) {
  var targetUrl = query.url || '';
  var cosPath = query.path || '';
  var token = query.token || '';
  if (!cosPath && targetUrl && !/^https?:\/\//i.test(targetUrl)) {
    cosPath = targetUrl;
    targetUrl = '';
  }
  if (cosPath) {
    try {
      var cred = await getCosCred(token);
      targetUrl = signCosUrl(cred, cosPath);
    } catch (e) {
      return send(res, 403, 'cos sign failed: ' + e.message);
    }
  }
  return mediaProxy(req, res, targetUrl);
}

function mediaProxy(req, res, targetUrl, redirectsLeft, lease) {
  redirectsLeft = redirectsLeft === undefined ? 3 : redirectsLeft;
  var clientIP = (req.socket && req.socket.remoteAddress) || 'unknown';

  if (!lease) {
    activeProxyPerIP[clientIP] = (activeProxyPerIP[clientIP] || 0) + 1;
    if (activeProxyPerIP[clientIP] > 64) {
      activeProxyPerIP[clientIP]--;
      return send(res, 429, 'too many concurrent requests');
    }
    lease = { released: false };
  }
  function finish() {
    if (!lease.released) {
      lease.released = true;
      var rem = Math.max(0, (activeProxyPerIP[clientIP] || 1) - 1);
      if (rem === 0) delete activeProxyPerIP[clientIP];
      else activeProxyPerIP[clientIP] = rem;
    }
  }

  var u;
  try { u = new URL(targetUrl); } catch (e) { finish(); return send(res, 400, 'bad url'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    finish();
    return send(res, 400, 'bad scheme');
  }
  if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) {
    finish();
    return send(res, 403, 'forbidden URL');
  }

  var hostname = u.hostname;
  if (!hostname || isPrivateIP(hostname) || !adapter.isAllowedMediaHost(hostname)) {
    finish();
    return send(res, 403, 'forbidden host');
  }

  dns.lookup(hostname, { all: true }, function (err, addresses) {
    if (err || !addresses || !addresses.length) {
      finish();
      return send(res, 403, 'dns lookup failed');
    }
    var validAddrs = addresses.filter(function (a) { return !isPrivateIP(a.address); });
    if (!validAddrs.length) {
      finish();
      return send(res, 403, 'forbidden ip address');
    }

    var chosen = validAddrs.find(function (a) { return a.family === 4; }) || validAddrs[0];
    var isHttps = u.protocol === 'https:';
    var mod = isHttps ? https : http;
    var reqHeaders = { 'User-Agent': 'suisui-backup/1.0' };
    if (req.headers && req.headers.range) {
      reqHeaders.Range = req.headers.range;
    }
    var opts = {
      method: 'GET',
      hostname: hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      agent: isHttps ? mediaHttpsAgent : mediaHttpAgent,
      timeout: 20000,
      lookup: function (_host, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        if (options && options.all) {
          return callback(null, [{ address: chosen.address, family: chosen.family }]);
        }
        callback(null, chosen.address, chosen.family);
      },
      headers: reqHeaders
    };

    var up = mod.request(opts, function (ur) {
      if (ur.statusCode >= 300 && ur.statusCode < 400 && ur.headers.location) {
        ur.resume();
        if (redirectsLeft <= 0) {
          finish();
          return send(res, 502, 'too many redirects');
        }
        var nextUrl;
        try { nextUrl = new URL(ur.headers.location, u).toString(); } catch (e) { finish(); return send(res, 400, 'bad redirect'); }
        return mediaProxy(req, res, nextUrl, redirectsLeft - 1, lease);
      }

      var totalBytes = 0;
      var headSent = false;
      var completed = false;
      var outHeaders = Object.assign({}, SECURITY_HEADERS, {
        'Content-Type': (/^audio\/x-wav(?:\s*;|$)/i.test(ur.headers['content-type'] || '') || /\.wav$/i.test(u.pathname)) ? 'audio/wav' : (ur.headers['content-type'] || 'application/octet-stream'),
        'Cache-Control': 'private, max-age=3600',
        'Accept-Ranges': ur.headers['accept-ranges'] || 'bytes'
      });
      if (ur.headers['content-length']) outHeaders['Content-Length'] = ur.headers['content-length'];
      if (ur.headers['content-range']) outHeaders['Content-Range'] = ur.headers['content-range'];

      function failTooLarge() {
        if (completed) return;
        completed = true;
        ur.destroy();
        finish();
        if (!headSent) send(res, 413, 'media response too large');
        else res.destroy();
      }

      ur.on('data', function (chunk) {
        if (completed) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) return failTooLarge();
        if (!headSent) {
          res.writeHead(ur.statusCode || 200, outHeaders);
          headSent = true;
        }
        if (!res.write(chunk)) ur.pause();
      });
      res.on('drain', function () {
        if (!completed) ur.resume();
      });
      ur.on('end', function () {
        if (completed) return;
        completed = true;
        if (!headSent) res.writeHead(ur.statusCode || 200, outHeaders);
        res.end();
        finish();
      });
      ur.on('error', function () {
        if (completed) return;
        completed = true;
        finish();
        if (!res.headersSent) send(res, 502, 'media upstream error'); else res.destroy();
      });
    });

    req.on('close', function () {
      if (!req.aborted) return;
      finish();
      try { up.destroy(); } catch (e) {}
    });
    res.on('close', function () {
      if (res.writableFinished || res.writableEnded) return;
      finish();
      try { up.destroy(); } catch (e) {}
    });
    up.on('error', function () {
      finish();
      if (!res.headersSent) send(res, 502, 'media upstream error'); else res.destroy();
    });
    up.on('timeout', function () {
      up.destroy();
      finish();
      if (!res.headersSent) send(res, 504, 'media upstream timeout'); else res.destroy();
    });
    up.end();
  });
}

/* ---------------- 安卓壳 https://suisui.local 跨域直连 ---------------- */
function appCorsHeaders(req) {
  var origin = req.headers && req.headers.origin;
  if (origin !== 'https://suisui.local') return null;
  return {
    'Access-Control-Allow-Origin': 'https://suisui.local',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function applyAppCors(req, res) {
  var cors = appCorsHeaders(req);
  if (!cors) return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, Object.assign({ 'Content-Length': 0, 'Cache-Control': 'no-store' }, cors));
    res.end();
    return true;
  }
  var origWriteHead = res.writeHead;
  res.writeHead = function (code, reason, headers) {
    if (reason && typeof reason === 'object') {
      headers = reason;
      reason = undefined;
    }
    headers = Object.assign({}, headers || {}, cors);
    if (reason) return origWriteHead.call(this, code, reason, headers);
    return origWriteHead.call(this, code, headers);
  };
  return false;
}

/* ---------------- 路由分发 ---------------- */
var server = http.createServer(function (req, res) {
  if (applyAppCors(req, res)) return;
  var parsed = url.parse(req.url, true);
  var p = parsed.pathname;

  if (p === '/download/suisui-memorial.apk') return serveApkDownload(res);
  if (p === '/api/ping') return json(res, 200, { ok: true, service: 'suisui-backup', ts: Date.now() });
  if (p === '/api/assets-bundle') return assetsBundle(res);
  if (p === '/api/starlight') return handleStarlight(req, res);
  if (p === '/api/media-proxy') return handleMediaProxyRequest(req, res, parsed.query || {});

  var m = p.match(/^\/api\/suisui\/([a-z_]+)$/);
  if (m) {
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, 'method');
    return readBody(req).then(function (body) { proxyUpstream(req, res, m[1], body); });
  }

  return serveStatic(req, res, p);
});

server.listen(PORT, HOST, function () {
  console.log('岁岁·时光纪念馆 服务已启动: http://' + HOST + ':' + PORT);
  console.log('上游适配器: ' + (adapter.isConfigured() ? adapter.BASE_URL : '未配置（演示桩模式）'));
  console.log('媒体代理允许域名: ' + adapter.ALLOWED_MEDIA_HOSTS.join(', '));
});
