/* 岁岁·时光纪念馆：1:1 原版岁岁界面复刻与本地全量备份引擎 */
(function () {
  'use strict';

  var A = 'assets/';
  var DEFAULT_AVATAR = A + 'feed/ic_avatar_default.png';
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var el = function (tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isNativeShell() {
    return !!(window.SuisuiNative);
  }

  function resolveMediaUrl(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s || s === 'null' || s === 'undefined' || s === ';empty;') return '';
    if (/^(https?:|blob:|data:)/i.test(s)) return s;
    if (/^\.\/(assets|media|archive)\//i.test(s)) s = s.slice(2);
    if (/^\/archives?\//i.test(s) || /^\/download\//i.test(s) || /^\/api\//i.test(s)) return s;
    if (/^\/assets\//i.test(s)) return s.slice(1);
    if (/^(assets\/|media\/)/i.test(s)) {
      if (isNativeShell() && /^media\//i.test(s)) return '/archives/' + encodeURIComponent(S.accountKey || 'default') + '/' + s;
      return s;
    }
    return '/api/media-proxy?path=' + encodeURIComponent(s.replace(/^\/+/, ''));
  }

  function safeMediaURL(value) {
    var s = resolveMediaUrl(value);
    if (!s) return '';
    if (/^(https?:|blob:|data:)/i.test(s) || /^(\/api\/|\/archives?\/|\/download\/|assets\/|media\/)/i.test(s)) return s;
    return '';
  }

  function labelsOf(value) {
    if (Array.isArray(value)) return value.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean);
    if (typeof value === 'string') return value.split(/[,，、|]/).map(function (s) { return s.trim(); }).filter(Boolean);
    return [];
  }

  function friendlyError(err) {
    var msg = String((err && err.message) || err || '');
    if (/JSON|无法解析|格式不正确/.test(msg)) return '文件内容格式不正确，请选择岁岁备份包';
    if (/indexedDB|本地断点|不支持本地/.test(msg)) return '这台设备暂时记不住上次的进度';
    if (/HTTP|status|502|503|504|网络响应|请求失败|上游/.test(msg)) return '网络开小差了，请稍后再试';
    if (/zip|压缩包/.test(msg)) return '这份备份包暂时打不开，请再试一次';
    return msg || '没有完成，请稍后再试';
  }

  function isAppleMobile() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function apkLinkHTML(extraClass) {
    return '<a class="btn btn-soft apk-download ' + (extraClass || '') + '" href="/download/suisui-memorial.apk" data-apk-download>下载安卓纪念馆 App（仅支持安卓）</a>';
  }

  function bindApkLinks(root) {
    $$('[data-apk-download]', root || document).forEach(function (node) {
      if (node.dataset.apkBound) return;
      node.dataset.apkBound = '1';
      node.addEventListener('click', function (e) {
        if (!isAppleMobile()) return;
        e.preventDefault();
        toast('离线安装包仅支持安卓手机，苹果手机请直接在本网页点击「打开本地备份包」或将本页添加到主屏幕使用');
      });
    });
  }

  function sexIcon(person) {
    var raw = person && (person.sex != null ? person.sex : person.gender);
    var text = String(raw == null ? '' : raw).trim();
    if (/^(2|女|female|woman|f)$/i.test(text)) return A + 'mine/ic_sex_female.png';
    if (/^(1|男|male|man|m)$/i.test(text)) return A + 'mine/ic_sex_male.png';
    return '';
  }

  function callLine(letter) {
    var name = String((letter && (letter.callName || letter.to)) || '').trim();
    if (!name) return '';
    if (/^致/.test(name)) return /[：:]$/.test(name) ? name : name + '：';
    return '致 ' + name + '：';
  }

  function dayText(value) {
    var s = String(value || '');
    var m = s.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : (s ? s.slice(0, 10) : '');
  }

  function signReportView(profile) {
    var sr = profile && profile.signReport;
    if (!sr || typeof sr !== 'object') return null;
    var ratios = Array.isArray(sr.ratios) ? sr.ratios.slice() : [];
    if (!ratios.length && Array.isArray(sr.moodList || sr.list)) {
      ratios = (sr.moodList || sr.list).map(function (x) {
        return { name: x.name || x.moodName || '心情', percent: Number(x.percent || x.rate || 0), count: Number(x.count || 0) };
      });
    }
    var days = Number(sr.totalDays || sr.signDays || sr.days || 0);
    var keep = Number(sr.continueDays || sr.continuousDays || 0);
    ratios = ratios.filter(function (x) { return x && x.name && (Number(x.percent) || Number(x.count)); });
    if (!days && !keep && !ratios.length) return null;
    return { totalDays: days, continueDays: keep, ratios: ratios };
  }

  function srcAttr(value, fallback) {
    var u = safeMediaURL(value) || fallback || '';
    return esc(u);
  }

  function toast(message, duration) {
    var old = $('.toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var node = el('div', 'toast', esc(message));
    document.body.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, duration || 2600);
  }

  function uint8ArrayToBase64(bytes) {
    var binary = '';
    var len = bytes.byteLength;
    var chunkSize = 0x8000;
    for (var i = 0; i < len; i += chunkSize) {
      var end = Math.min(i + chunkSize, len);
      binary += String.fromCharCode.apply(null, bytes.subarray(i, end));
    }
    return btoa(binary);
  }

  async function sendZipToNative(blob, filename) {
    if (!window.SuisuiNative) return;
    var safeName = filename || '岁岁回忆备份.zip';
    var CHUNK_SIZE = 1024 * 1024; // 1MB 分块传输
    var total = blob.size;
    try {
      if (typeof window.SuisuiNative.beginSaveZip === 'function' &&
          typeof window.SuisuiNative.appendSaveZipChunk === 'function' &&
          typeof window.SuisuiNative.finishSaveZip === 'function') {
        window.SuisuiNative.beginSaveZip(safeName, total);
        for (var offset = 0; offset < total; offset += CHUNK_SIZE) {
          var slice = blob.slice(offset, Math.min(offset + CHUNK_SIZE, total));
          var buf = await slice.arrayBuffer();
          var b64 = uint8ArrayToBase64(new Uint8Array(buf));
          window.SuisuiNative.appendSaveZipChunk(b64);
        }
        window.SuisuiNative.finishSaveZip();
      } else if (typeof window.SuisuiNative.saveBase64Zip === 'function') {
        var reader = new FileReader();
        reader.onload = function () {
          var res = reader.result || '';
          var idx = res.indexOf(',');
          var b64 = idx >= 0 ? res.substring(idx + 1) : res;
          window.SuisuiNative.saveBase64Zip(b64, safeName);
        };
        reader.readAsDataURL(blob);
      }
    } catch (e) {
      toast('保存到手机时出错，请重试');
    }
  }

  function safeFetchJson(url, opts, timeoutMs) {
    opts = Object.assign({}, opts || {});
    var controller = new AbortController();
    var originalSignal = opts.signal;
    var abort = function () { controller.abort(); };
    if (originalSignal) {
      if (originalSignal.aborted) abort();
      else originalSignal.addEventListener('abort', abort, { once: true });
    }
    opts.signal = controller.signal;
    var timer = setTimeout(abort, timeoutMs == null ? 28000 : timeoutMs);
    if (isNativeShell() && opts.body && String(opts.method || '').toUpperCase() === 'POST') {
      opts.headers = opts.headers || {};
      var rawBody = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      try {
        opts.headers['X-Body-Base64'] = btoa(unescape(encodeURIComponent(rawBody)));
      } catch (e) {}
    }
    return fetch(url, opts).then(function (response) {
      return response.text().then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('网络开小差了，请稍后再试');
        }
        if (!response.ok || data.ok === false) {
          var err = new Error(friendlyError(data.msg || '网络开小差了，请稍后再试'));
          err.status = response.status;
          err.retryable = response.status >= 500 || (response.ok && /网络|超时|上游/.test(String(data.msg || '')));
          throw err;
        }
        return data;
      });
    }).finally(function () {
      clearTimeout(timer);
      if (originalSignal) originalSignal.removeEventListener('abort', abort);
    });
  }

  var S = {
    archive: null,
    token: '',
    uid: '',
    phone: '',
    demo: false,
    userBean: null,
    zipReader: null,
    mediaCache: {},
    mediaInflight: {},
    pull: null,
    activeTab: 'tree',
    sorrowTab: 'inbox',
    moodTab: 'moods',
    mineTab: 'follow',
    drawerOpen: false,
    exporting: false,
    lastZipBlobUrl: '',
    lastZipFilename: '',
    lastZipBlob: null,
    nativeShell: false,
    nativeImportPct: 0,
    nativeImportMsg: ''
  };
  if (isNativeShell()) S.nativeShell = true;

  function revokeMediaCache() {
    Object.keys(S.mediaCache).forEach(function (k) {
      try { URL.revokeObjectURL(S.mediaCache[k]); } catch (e) {}
    });
    S.mediaCache = {};
    S.mediaInflight = {};
    if (S.lastZipBlobUrl) {
      try { URL.revokeObjectURL(S.lastZipBlobUrl); } catch (e) {}
      S.lastZipBlobUrl = '';
      S.lastZipBlob = null;
    }
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
  }
  function array(value) { return Array.isArray(value) ? value : []; }
  function textOf(item) {
    return String(item && (item.text || item.body || item.content || item.description || item.title || '') || '');
  }

  /* 完整保留服务端返回的全部评论与楼中楼字段（头像、等级、属地、配图、点赞、回复对象） */
  function commentsOf(value) {
    return array(value).map(function (c) {
      var subs = commentsOf(c.subComments || c.replies || []);
      return {
        id: String(c.id || ''),
        uid: String(c.uid || c.createUid || ''),
        nickname: c.nickname || c.createUsername || c.nickName || c.name || '岁友',
        avatar: c.avatar || DEFAULT_AVATAR,
        avatarRaw: c.avatarRaw || '',
        level: Number(c.level || c.createLevel || 0),
        isMember: Boolean(c.isMember || Number(c.createMember || 0) === 1),
        replyTo: c.replyTo || c.replyUsername || '',
        region: c.region || c.createRegion || '',
        time: c.time || c.createTime || '',
        content: c.content || c.text || c.body || '',
        likeCount: Number(c.likeCount || 0),
        replyCount: Number(c.replyCount || subs.length || 0),
        image: c.image || '',
        imageRaw: c.imageRaw || '',
        subComments: subs
      };
    });
  }

  function moodName(key) {
    return { happy: '开心', unhappy: '不开心', tired: '疲惫', calm: '平静', angry: '生气', default: '日常心情' }[key] || key || '日常心情';
  }

  function moodIconPath(item) {
    var name = String((item && (item.moodName || item.mood)) || '');
    var type = Number(item && item.moodType);
    if (type === 3 || /不开心|难过|伤心|沮丧|抑郁|焦虑|烦躁|委屈|生气|疲惫|unhappy|sad|tired/i.test(name)) return A + 'mood/mood_unhappy.png';
    if (type === 1 || /开心|快乐|幸福|兴奋|满足|期待|happy/i.test(name)) return A + 'mood/mood_happy.png';
    return A + 'mood/mood_default.png';
  }

  function normalizeItem(item, module) {
    var x = clone(item || {});
    x._module = module || x._module || '';
    x._source = x._source || x.type || x.kind || '';
    x.text = textOf(x);
    x.body = x.body || x.text;
    x.nickname = x.nickname || x.nickName || x.createUsername || x.name || '岁友';
    x.avatar = x.avatar || DEFAULT_AVATAR;
    x.level = Number(x.level || x.createLevel || x.userLevel || 0);
    x.time = x.time || x.createTime || x.date || '';
    x.region = x.region || x.createRegion || x.location || '';
    x.topicTitle = x.topicTitle || '';
    x.images = array(x.images || x.imageList).filter(Boolean);
    x.imagesRaw = array(x.imagesRaw).filter(Boolean);
    x.audio = x.audio || (x.voice && x.voice.src) || x.audioUrl || '';
    x.audioSecond = Number(x.audioSecond || (x.voice && x.voice.duration) || x.duration || 0) || 0;
    x.likeCount = Number(x.likeCount != null ? x.likeCount : (x.hugs != null ? x.hugs : x.likes || 0)) || 0;
    x.comments = commentsOf(x.comments || x.replies || []);
    var subTotal = x.comments.reduce(function (acc, c) { return acc + array(c.subComments).length; }, 0);
    x.commentsCount = Math.max(Number(x.commentsCount || 0), x.comments.length + subTotal);
    x.moodName = x.moodName || moodName(x.mood || '');
    x.causeName = x.causeName || x.cause || '';
    x.causeDesc = x.causeDesc || x.causeDetail || '';
    x.backgroundCover = resolveMediaUrl(x.backgroundCover || '');
    x.topStatus = Number(x.topStatus || 0) || 0;
    x.isMember = x.isMember === true || Number(x.isMember || 0) === 1;
    x.giftCount = Number(x.giftCount || 0) || 0;
    x.callName = x.callName || '';
    x.museumStatus = Number(x.museumStatus || 0) || 0;
    x.majorDay = dayText(x.majorDay || x.arrive || '');
    x.eachFollow = Number(x.eachFollow || 0) || 0;
    x.sex = x.sex != null ? x.sex : (x.gender != null ? x.gender : '');
    x.video = resolveMediaUrl(x.video || x.videoUrl || '');
    if (!x.images.length && x.imgPath) {
      x.images = String(x.imgPath).split(/;;|,/).map(resolveMediaUrl).filter(Boolean);
    } else {
      x.images = x.images.map(resolveMediaUrl).filter(Boolean);
    }
    x.audio = resolveMediaUrl(x.audio || '');
    return x;
  }

  function profileOf(p) {
    p = p || {};
    var join = p.joinTime || p.join_time || p.regTime || '';
    var days = Number(p.companion_days || p.join_days || p.joinDays || 0);
    if (!days && join) {
      var when = new Date(String(join).replace(/-/g, '/')).getTime();
      if (when) days = Math.max(1, Math.ceil((Date.now() - when) / 86400000));
    }
    p.nickname = p.nickname || p.nickName || '岁岁旅人';
    p.avatar = p.avatar || DEFAULT_AVATAR;
    p.signature = p.signature || p.sign || '';
    p.growth_level = p.growth_level || p.growthLevel || p.userLevel || 1;
    p.joinDays = days || 1;
    p.joinTime = join;
    p.region = p.region || '岁岁星球';
    p.restaurantName = p.restaurantName || p.restaurant_name || '岁岁解忧馆';
    p.followCount = Number(p.followCount || (p.stats && p.stats.follow) || 0);
    p.fansCount = Number(p.fansCount || (p.stats && p.stats.fans) || 0);
    p.visitCount = Number(p.visitCount || (p.stats && (p.stats.visitors || p.stats.visit)) || 0);
    p.treeholeCount = Number(p.treeholeCount || 0);
    p.homepageCover = resolveMediaUrl(p.homepageCover || '');
    p.profileFrame = resolveMediaUrl(p.profileFrame || '');
    p.profileMusic = resolveMediaUrl(p.profileMusic || '');
    p.labels = labelsOf(p.labels || p.label || '');
    p.isGuardian = p.isGuardian === true || p.isGuardian === 1 || p.isGuardian === '1';
    p.betterThanPercent = Number(p.betterThanPercent || 0) || 0;
    if (p.signReport && typeof p.signReport === 'object') p.signReport = p.signReport;
    return p;
  }

  function emptyArchive() {
    return {
      meta: { version: 2, app: '岁岁·时光纪念馆', exported_at: new Date().toISOString() },
      profile: {},
      moods: [],
      diaries: [],
      tree: [],
      post: { inbox: [], sent: [], replied: [] },
      letters_in: [],
      letters_reply: [],
      letters_future: [],
      fm: [],
      friends: [],
      chats: [],
      museum: { future: [] },
      notices: [],
      signs: [],
      media_index: {}
    };
  }

  function archiveShape(a) {
    var d = a || emptyArchive();
    d.profile = profileOf(d.profile || {});
    d.moods = array(d.moods).map(function (x) { return normalizeItem(x, 'moods'); });
    d.diaries = array(d.diaries).map(function (x) { return normalizeItem(x, 'diaries'); });
    d.tree = array(d.tree).map(function (x) { return normalizeItem(x, 'tree'); });
    d.post = d.post || { inbox: [], sent: [], replied: [] };
    d.post.inbox = array(d.post.inbox || d.letters_in).map(function (x) { return normalizeItem(x, 'letters_in'); });
    d.post.sent = array(d.post.sent).map(function (x) { return normalizeItem(x, 'letters_sent'); });
    d.post.replied = array(d.post.replied || d.letters_reply).map(function (x) { return normalizeItem(x, 'letters_reply'); });
    d.museum = d.museum || {};
    d.museum.future = array(d.museum.future || d.letters_future).map(function (x) { return normalizeItem(x, 'letters_future'); });
    d.fm = array(d.fm).map(function (x) { return normalizeItem(x, 'fm'); });
    d.friends = array(d.friends || d.chats).map(function (x) { return normalizeItem(x, 'friends'); });
    return d;
  }

  function archiveForExport() {
    return archiveShape(clone(S.archive || window.SUISUI_DEMO_ARCHIVE || emptyArchive()));
  }

  function mediaURL(value, mime) {
    var path = safeMediaURL(value);
    if (!path) return Promise.resolve('');
    if (/^(https?:|blob:|data:)/i.test(path)) return Promise.resolve(path);
    if (S.zipReader && S.zipReader.has(path)) {
      if (S.mediaCache[path]) return Promise.resolve(S.mediaCache[path]);
      if (S.mediaInflight[path]) return S.mediaInflight[path];
      var reader = S.zipReader, cache = S.mediaCache, pending = S.mediaInflight;
      var suffix = path.split(/[?#]/)[0].toLowerCase().match(/\.([a-z0-9]+)$/);
      var types = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
      pending[path] = reader.objectURL(path, (suffix && types[suffix[1]]) || mime).then(function (url) {
        if (S.mediaCache !== cache || S.zipReader !== reader) { URL.revokeObjectURL(url); return ''; }
        cache[path] = url;
        return url;
      }).finally(function () { delete pending[path]; });
      return pending[path];
    }
    return Promise.resolve(path);
  }

  function bindMedia(root) {
    $$(root ? '[data-bg-media]' : '#app [data-bg-media]', root || document).forEach(function (node) {
      var raw = node.getAttribute('data-bg-media');
      if (!raw) return;
      mediaURL(raw, 'image/jpeg').then(function (url) {
        if (!url) return;
        var probe = new Image();
        probe.onload = function () {
          node.style.backgroundImage = 'url("' + String(url).replace(/"/g, '') + '")';
        };
        probe.onerror = function () { node.style.backgroundImage = ''; };
        probe.src = url;
      }).catch(function () {});
    });
    $$(root ? '[data-media]' : '#app [data-media]', root || document).forEach(function (node) {
      var raw = node.getAttribute('data-media');
      if (raw) {
        var isAudio = node.tagName === 'AUDIO';
        var isVideo = node.tagName === 'VIDEO';
        mediaURL(raw, isVideo ? 'video/mp4' : (isAudio ? 'audio/wav' : 'image/jpeg')).then(function (url) {
          if (url && node.src !== url) node.src = url;
        }).catch(function () {});
      }
      if (node.tagName === 'IMG' && !node.dataset.fallbackBound) {
        node.dataset.fallbackBound = '1';
        node.onerror = function () {
          if (node.src.indexOf('ic_avatar_default.png') < 0 && node.classList.contains('avatar-img')) {
            node.src = DEFAULT_AVATAR;
          }
        };
      }
    });
  }

  /* 密码不保存；账号令牌和备份仅保存在本机 IndexedDB。 */
  function legacyDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('suisui_rescue_db', 1);
      request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains('checkpoints')) request.result.createObjectStore('checkpoints', { keyPath: 'id' }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function mirrorLegacy(key, record, entry, remove) {
    return legacyDB().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction('checkpoints', 'readwrite'), store = tx.objectStore('checkpoints');
      var r = store.get('accounts_index');
      r.onsuccess = function () {
        var entries = array(r.result && r.result.accounts).filter(function (item) { return item.key !== key; });
        if (!remove) entries.unshift(entry);
        store.put({ id: 'accounts_index', accounts: entries });
      };
      if (remove) {
        store.delete('account_' + key);
        var active = store.get('active');
        active.onsuccess = function () { if (active.result && active.result.accountKey === key) store.delete('active'); };
      } else {
        store.put(Object.assign({}, record, { id: 'account_' + key, accountKey: key }));
        store.put(Object.assign({}, record, { id: 'active', accountKey: key }));
      }
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { db.close(); reject(tx.error); };
      tx.onabort = function () { db.close(); reject(tx.error); };
    }); });
  }
  var IDB = {
    db: null,
    open: function () {
      var self = this;
      if (self.db) return Promise.resolve(self.db);
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('这台设备暂时记不住上次的进度')); return; }
        var request = indexedDB.open('suisui_backup_db', 1);
        request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains('accounts')) request.result.createObjectStore('accounts'); };
        request.onsuccess = function () { self.db = request.result; resolve(self.db); };
        request.onerror = function () { reject(request.error || new Error('暂时没法接着上次的进度')); };
      });
    },
    read: function (key) {
      return this.open().then(function (db) { return new Promise(function (resolve, reject) {
        var r = db.transaction('accounts').objectStore('accounts').get(key);
        r.onsuccess = function () { resolve(r.result == null ? null : r.result); };
        r.onerror = function () { reject(r.error); };
      }); });
    },
    get: function () { return this.read('account_data_' + (S.accountKey || '')); },
    put: function (cp) {
      var key = String(S.accountKey || cp.uid || cp.phone || '');
      if (!key) return Promise.resolve();
      var d = cp.archive || emptyArchive(), c = counts(d), profile = d.profile || {};
      var record = { archive: d, modules: cp.modules, token: S.token, uid: cp.uid || S.uid, phone: cp.phone || S.phone,
        done: !!cp.complete, complete: !!cp.complete, count: cp.count || 0, demo: !!cp.demo, updatedAt: Date.now(), source: cp.source || 'login', file: cp.file || null };
      var entry = { key: key, uid: record.uid, phone: record.phone, nickname: profile.nickname || '岁岁旅人', avatar: profile.avatar || '', treeCount: c.tree, commentCount: c.comments, done: record.done, updatedAt: record.updatedAt, source: record.source,
        progress: cp.modules ? Math.round(PULL_MODULES.filter(function (m) { return cp.modules[m.key] && cp.modules[m.key].done; }).length / PULL_MODULES.length * 100) : 100 };
      return this.open().then(function (db) { return new Promise(function (resolve, reject) {
        var tx = db.transaction('accounts', 'readwrite'), store = tx.objectStore('accounts');
        var r = store.get('accounts_index_v1');
        r.onsuccess = function () {
          var index = array(r.result).filter(function (x) { return x.key !== key; });
          index.unshift(entry);
          store.put(index, 'accounts_index_v1');
          store.put(record, 'account_data_' + key);
          store.put(key, 'active_account_key_v1');
        };
        tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error); }; tx.onabort = function () { reject(tx.error); };
      }); }).then(function () { return mirrorLegacy(key, record, entry, false); });
    },
    remove: function (key) {
      return this.open().then(function (db) { return new Promise(function (resolve, reject) {
        var tx = db.transaction('accounts', 'readwrite'), store = tx.objectStore('accounts'), r = store.get('accounts_index_v1');
        r.onsuccess = function () { store.put(array(r.result).filter(function (x) { return x.key !== key; }), 'accounts_index_v1'); };
        store.delete('account_data_' + key);
        var active = store.get('active_account_key_v1');
        active.onsuccess = function () { if (active.result === key) store.delete('active_account_key_v1'); };
        tx.oncomplete = resolve; tx.onerror = function () { reject(tx.error); }; tx.onabort = function () { reject(tx.error); };
      }); }).then(function () { return mirrorLegacy(key, null, null, true); });
    }
  };

  /* 本地珍藏说明 */
  function openNoticeModal() {
    var mask = el('div', 'modal-mask');
    mask.innerHTML = '<article class="modal-card">' +
      '<button class="close-btn" aria-label="关闭">×</button>' +
      '<h2><img src="' + A + 'mine/ic_mine_safe.png" alt="">岁岁 · 本地珍藏说明</h2>' +
      '<h4>1. 非官方公益性质</h4>' +
      '<p>本项目是岁友自发编写的非官方、非商业开源辅助工具，与「岁岁」官方团队不存在隶属、委托或商业合作关系，完全免费使用。</p>' +
      '<h4>2. 仅限导回本人数据</h4>' +
      '<p>请仅使用本人合法账号导出属于自己的树洞、心情、日记、信件、评论、照片与语音，用于个人本地存档，不要获取或处理他人数据。</p>' +
      '<h4>3. 数据核对与免责</h4>' +
      '<p>服务器不建立数据库，也不留存账号密码与个人内容。受网络环境和上游服务状态影响，导出结果不作绝对完整担保；请导出后立即核对照片、语音和文字，并在电脑硬盘或网盘多处保存。</p>' +
      '<h4>4. 知识产权与移除通道</h4>' +
      '<p>「岁岁」名称、图标及相关视觉素材的知识产权归原权利人所有，本项目仅作非商业个人回忆展示。如权利人认为内容不妥，请通过 GitHub Issue 联系，我们会及时处理移除。</p>' +
      '<h4>重要提醒</h4>' +
      '<p>建议大家尽量使用电脑浏览器导出，或将导出的 .zip 备份包务必在电脑硬盘/网盘里存一份。电脑端解压双击《打开岁岁纪念馆.html》或阅读《岁岁记忆全文合集.txt》十年后也能稳定打开；安卓离线 App 仅供当前手机端方便翻看（未来安卓系统大版本更新后未必长期兼容），苹果手机受系统限制无独立离线 App，请勿仅将回忆留在手机里。</p>' +
      '</article>';
    mask.onclick = function (e) { if (e.target === mask || e.target.closest('.close-btn')) mask.remove(); };
    document.body.appendChild(mask);
  }

  /* ==================== 1. 登录首屏 ==================== */
  function renderLanding() {
    window.scrollTo(0, 0);
    var app = $('#app');
    app.innerHTML = '';
    var screen = el('main', 'login-screen');
    screen.innerHTML = '<div class="login-container">' +
      '<section class="login-hero">' +
        '<div class="login-hero-mascots">' +
          '<img class="logo-main" src="' + A + 'icon/logo_suisui_app.png" alt="岁岁">' +
          '<img class="baobao-char" src="' + A + 'ic_baobao.png" alt="抱抱">' +
        '</div>' +
        '<h1>岁岁 · 时光纪念馆</h1>' +
        '<p>把岁岁里的树洞、心情、日记、信件和声音，完整带回家。</p>' +
      '</section>' +
      '<div class="safe-pill-bar" id="landing-safe-bar">' +
        '<img src="' + A + 'mine/ic_mine_safe.png" alt="安全说明">' +
        '<div class="safe-text">' +
          '<strong>所有回忆仅保存在你的手机与电脑中</strong>' +
          '直接生成完整本地备份包，服务器不留存任何个人记录' +
        '</div>' +
        '<span class="safe-link">详情 &gt;</span>' +
      '</div>' +
      '<section class="login-card">' +
        '<div id="resume-box" class="resume-box hidden"></div>' +
        '<div class="seg-tabs">' +
          '<button id="mode-pwd" class="active" type="button">密码登录</button>' +
          '<button id="mode-code" type="button">验证码登录</button>' +
        '</div>' +
        '<div class="input-row">' +
          '<input id="login-phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="请输入岁岁绑定手机号">' +
        '</div>' +
        '<div class="input-row" id="password-row">' +
          '<input id="login-password" type="password" autocomplete="current-password" placeholder="请输入登录密码">' +
        '</div>' +
        '<div id="code-row" class="hidden">' +
          '<div class="input-row">' +
            '<input id="login-code" inputmode="numeric" maxlength="6" placeholder="6位短信验证码">' +
            '<button id="send-code" class="btn btn-soft" type="button">获取验证码</button>' +
          '</div>' +
          '<div class="input-row">' +
            '<input id="login-new-password" type="password" autocomplete="new-password" placeholder="新密码（选填，仅重置密码时填写）">' +
          '</div>' +
        '</div>' +
        '<div id="login-status" class="form-msg" role="alert"></div>' +
        '<button id="login-submit" class="btn btn-primary btn-block" type="button">进入岁岁并同步全部记忆</button>' +
        '<div class="quick-entries">' +
          '<button class="quick-entry" id="open-zip" type="button">' +
            '<img src="' + A + 'sorrow/letter_can_open.png" alt="">' +
            '<div><strong>打开本地备份包</strong><span>直接打开已保存的岁岁备份包</span></div>' +
          '</button>' +
          '<button class="quick-entry" id="open-demo" type="button">' +
            '<img src="' + A + 'assets_baobao/baobao_1.png" alt="">' +
            '<div><strong>体验纪念馆样例</strong><span>免登录预览原版界面</span></div>' +
          '</button>' +
          '<a class="quick-entry apk-entry" href="/download/suisui-memorial.apk" data-apk-download>' +
            '<img src="' + A + 'icon/app_launcher_round.png" alt="">' +
            '<div><strong>下载安卓纪念馆 App（仅支持安卓）</strong><span>导入一次备份包，就能在手机上离线翻看</span></div>' +
          '</a>' +
        '</div>' +
        '<input id="zip-input" class="hidden" type="file" accept=".zip,.json">' +
      '</section>' +
      '<footer class="login-footer" id="landing-footer">愿每一段温柔的岁岁时光，都能被妥善珍藏</footer>' +
    '</div>';
    app.appendChild(screen);

    $('#landing-safe-bar').onclick = openNoticeModal;
    if (S.nativeShell) adaptNativeLanding();
    bindLoginEvents();
    bindFileEntries();
    bindApkLinks(screen);
    loadResumeBanner();
  }

  function adaptNativeLanding() {
    var card = $('.login-card');
    if (!card) return;
    var apkEntry = $('.apk-entry', card);
    if (apkEntry) apkEntry.style.display = 'none';

    var submitBtn = $('#login-submit', card);
    if (submitBtn && !$('#native-import')) {
      var box = el('div', 'native-import-section');
      box.style.marginTop = '14px';
      box.innerHTML =
        '<button id="native-import" class="btn btn-soft btn-block native-import-btn" type="button" style="display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;padding:12px 14px;background:#F0F6F7;color:#357C72;border:1px solid #D1E5E7;">' +
          '<img src="' + A + 'sorrow/letter_can_open.png" alt="" style="width:20px;height:20px;object-fit:contain;">' +
          '直接打开已保存的岁岁备份包 (.zip)' +
        '</button>' +
        '<div class="native-import-line" style="margin-top:8px;"><i id="native-import-bar" style="width:' + Number(S.nativeImportPct || 0) + '%"></i></div>' +
        '<div id="native-import-status" class="form-msg" style="text-align:center;margin-top:4px;">' + esc(S.nativeImportMsg || '') + '</div>';
      submitBtn.parentNode.insertBefore(box, submitBtn.nextSibling);
    }
  }

  async function migrateLegacyCheckpoint() {
    if ((await IDB.read('accounts_index_v1')) !== null) return;
    var legacy = await IDB.read('current_checkpoint_v2');
    if (!legacy) {
      legacy = await new Promise(function (resolve) {
        var req = indexedDB.open('suisui_rescue_db', 1);
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains('checkpoints')) req.result.createObjectStore('checkpoints', { keyPath: 'id' }); };
        req.onerror = function () { resolve(null); };
        req.onsuccess = function () {
          var db = req.result, r = db.transaction('checkpoints').objectStore('checkpoints').get('active');
          r.onsuccess = function () { var value = r.result; db.close(); resolve(value || null); };
          r.onerror = function () { db.close(); resolve(null); };
        };
      });
    }
    if (legacy && legacy.archive && (legacy.uid || legacy.phone)) {
      S.accountKey = accountKeyOf(legacy.archive, legacy);
      await IDB.put(legacy);
      S.accountKey = '';
    }
    var legacyIndex = await legacyDB().then(function (db) { return new Promise(function (resolve, reject) {
      var r = db.transaction('checkpoints').objectStore('checkpoints').get('accounts_index');
      r.onsuccess = function () { db.close(); resolve(r.result && r.result.accounts || []); };
      r.onerror = function () { db.close(); reject(r.error); };
    }); });
    if (array(legacyIndex).length && !(await IDB.read('accounts_index_v1') || []).length) {
      for (var i = 0; i < legacyIndex.length; i++) {
        var entry = legacyIndex[i];
        var record = await legacyDB().then(function (db) { return new Promise(function (resolve, reject) {
          var r = db.transaction('checkpoints').objectStore('checkpoints').get('account_' + entry.key);
          r.onsuccess = function () { db.close(); resolve(r.result); };
          r.onerror = function () { db.close(); reject(r.error); };
        }); });
        if (record && record.archive) { S.accountKey = entry.key; await IDB.put(record); S.accountKey = ''; }
      }
    }
  }

  function loadResumeBanner() {
    migrateLegacyCheckpoint().then(function () { return IDB.read('accounts_index_v1'); }).then(function (index) {
      var box = $('#resume-box');
      if (!box || !array(index).length) return;
      box.classList.remove('hidden');
      box.innerHTML = '<strong>已保存的岁岁账号</strong>' + index.map(function (a) {
        var phone = String(a.phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
        return '<div class="saved-account"><img class="avatar-img" src="' + srcAttr(a.avatar, DEFAULT_AVATAR) + '" alt="">' +
          '<div><b>' + esc(a.nickname || '岁岁旅人') + '</b><small>' + esc(phone) + ' · 树洞 ' + Number(a.treeCount || 0) + ' · 评论 ' + Number(a.commentCount || 0) + '</small>' +
          '<small>' + (a.done ? '已完整保存' : '已同步 ' + Number(a.progress || 0) + '%，可继续') + '</small></div>' +
          '<button type="button" data-enter-account="' + esc(a.key) + '">进入纪念馆</button><button type="button" data-remove-account="' + esc(a.key) + '">移除</button></div>';
      }).join('');
      $$('[data-enter-account]', box).forEach(function (btn) { btn.onclick = function () { enterSavedAccount(btn.getAttribute('data-enter-account')); }; });
      $$('[data-remove-account]', box).forEach(function (btn) { btn.onclick = function () {
        if (!confirm('仅移除这台设备上的账号缓存，确定继续吗？')) return;
        IDB.remove(btn.getAttribute('data-remove-account')).then(function () { box.classList.add('hidden'); loadResumeBanner(); }).catch(function () { toast('移除失败，请重试'); });
      }; });
    }).catch(function () { toast('无法读取本地账号列表'); });
  }

  function enterSavedAccount(key) {
    IDB.read('account_data_' + key).then(function (saved) {
      if (!saved || !saved.archive) throw new Error('账号数据不存在');
      revokeMediaCache();
      S.accountKey = key; S.token = saved.token || ''; S.uid = saved.uid || ''; S.phone = saved.phone || '';
      S.demo = !!saved.demo; S.userBean = saved.archive.profile || {}; S.zipReader = null;
      if (saved.source === 'import' || saved.file) {
        S.archive = archiveShape(saved.archive); S.pull = null; S.isLocalArchive = true; S.activeTab = 'tree';
        if (saved.file) S.zipReader = new SuisuiZipReader(saved.file);
        enterSuisuiApp();
        if (saved.file && S.zipReader) S.zipReader.load().then(function () { bindMedia(); }).catch(function () { toast('账号数据已打开，但原备份包媒体暂时无法读取'); });
      } else if (!saved.complete && !S.token) {
        S.archive = archiveShape(saved.archive); S.pull = null; S.isLocalArchive = true; S.activeTab = 'tree'; enterSuisuiApp();
        toast('已打开已保存的数据；继续同步请重新登录');
      } else startPull(saved);
    }).catch(function () { toast('无法打开本地账号，请重试'); });
  }

  function bindLoginEvents() {
    if (!$('#mode-pwd')) return;
    var mode = 'pwd';
    function setMode(next) {
      mode = next;
      $('#mode-pwd').classList.toggle('active', next === 'pwd');
      $('#mode-code').classList.toggle('active', next === 'code');
      $('#password-row').classList.toggle('hidden', next !== 'pwd');
      $('#code-row').classList.toggle('hidden', next !== 'code');
    }
    $('#mode-pwd').onclick = function () { setMode('pwd'); };
    $('#mode-code').onclick = function () { setMode('code'); };

    $('#send-code').onclick = function () {
      var phone = $('#login-phone').value.trim(), btn = this, status = $('#login-status');
      if (!/^1\d{10}$/.test(phone)) { status.textContent = '请输入正确的 11 位手机号'; return; }
      btn.disabled = true;
      status.textContent = '正在发送验证码…';
      safeFetchJson('/api/suisui/send_code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone })
      }).then(function (data) {
        status.textContent = (data.msg || '已向岁岁请求发送验证码') + '（近期岁岁官方短信通道可能已停发，若收不到短信请尽量使用密码登录）';
        var end = Date.now() + 60000;
        (function tick() {
          var left = Math.ceil((end - Date.now()) / 1000);
          if (left <= 0) { btn.disabled = false; btn.textContent = '获取验证码'; }
          else { btn.textContent = left + 's'; setTimeout(tick, 1000); }
        }());
      }).catch(function (err) {
        btn.disabled = false;
        status.textContent = err.message || '发送失败';
      });
    };

    $('#login-submit').onclick = function () {
      var phone = $('#login-phone').value.trim();
      var password = mode === 'pwd' ? $('#login-password').value : $('#login-new-password').value;
      var code = $('#login-code').value.trim();
      var status = $('#login-status'), btn = this;
      if (!/^1\d{10}$/.test(phone)) { status.textContent = '请输入正确的 11 位手机号'; return; }
      if (mode === 'pwd' && !password) { status.textContent = '请输入登录密码'; return; }
      if (mode === 'code' && !/^\d{6}$/.test(code)) { status.textContent = '请输入 6 位短信验证码'; return; }
      btn.disabled = true;
      status.textContent = '正在登录岁岁…';
      safeFetchJson('/api/suisui/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone, password: password, code: code, mode: mode, demo: false })
      }).then(function (data) {
        revokeMediaCache();
        S.token = String(data.token || '');
        S.uid = String(data.uid || '');
        S.phone = phone;
        S.demo = false;
        S.userBean = data.userBean || {};
        S.zipReader = null;
        S.accountKey = String(S.uid || phone);
        return IDB.get().catch(function () { return null; }).then(function (saved) {
          startPull(saved && String(saved.uid) === S.uid && String(saved.phone) === phone ? saved : null);
        });
      }).catch(function (err) {
        btn.disabled = false;
        status.textContent = friendlyError(err.message || '登录失败，请检查账号或密码');
      });
    };
  }

  function startNativeImport() {
    S.nativeImportMsg = '请选择手机里保存的岁岁备份包';
    var status = $('#native-import-status');
    if (status) status.textContent = S.nativeImportMsg;
    if (window.SuisuiNative && typeof window.SuisuiNative.pickZip === 'function') {
      window.SuisuiNative.pickZip();
      return;
    }
    var input = $('#zip-input');
    if (input) input.click();
  }

  function bindFileEntries() {
    var openZip = $('#open-zip');
    if (openZip) {
      openZip.onclick = function () {
        if (isNativeShell()) {
          startNativeImport();
        } else {
          var input = $('#zip-input');
          if (input) input.click();
        }
      };
    }
    var zipInput = $('#zip-input');
    if (zipInput) zipInput.onchange = function (e) { openArchiveFile(e.target.files && e.target.files[0]); };
    var nativeBtn = $('#native-import');
    if (nativeBtn) nativeBtn.onclick = startNativeImport;
    var demoBtn = $('#open-demo');
    if (demoBtn) demoBtn.onclick = function () {
      revokeMediaCache();
      S.archive = archiveShape(clone(window.SUISUI_DEMO_ARCHIVE));
      S.demo = true;
      S.pull = null;
      S.zipReader = null;
      S.activeTab = 'tree';
      enterSuisuiApp();
    };
  }

  function accountKeyOf(archive, fallback) {
    var profile = archive && archive.profile || {};
    return String(profile.uid || profile.id || (fallback && (fallback.uid || fallback.phone)) || S.uid || S.phone || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function openArchiveFile(file) {
    if (!file) return;
    revokeMediaCache();
    if (/\.json$/i.test(file.name)) {
      file.text().then(function (txt) {
        S.archive = archiveShape(JSON.parse(txt));
        S.zipReader = null;
        S.pull = null;
        S.activeTab = 'tree';
        enterSuisuiApp();
        toast('已打开这份回忆');
      }).catch(function () { toast('文件内容格式不正确，请选择岁岁备份包'); });
      return;
    }
    try {
      var reader = new SuisuiZipReader(file);
      reader.load().then(function () {
        return reader.readJSON('data/archive.json');
      }).then(function (data) {
        S.archive = archiveShape(data);
        S.accountKey = accountKeyOf(S.archive);
        S.zipReader = reader;
        S.pull = null;
        S.isLocalArchive = true;
        S.activeTab = 'tree';
        IDB.put({ archive: S.archive, modules: {}, complete: true, source: 'import', file: file, uid: S.archive.profile.uid, phone: '' }).catch(function () {});
        enterSuisuiApp();
        toast('岁岁备份包已打开');
      }).catch(function () { toast('文件内容格式不正确，请选择岁岁备份包'); });
    } catch (e) {
      toast('这份备份包暂时打不开，请再试一次');
    }
  }

  /* ==================== 2. 数据同步引擎（支持批量多页极速拉取） ==================== */
  var PULL_MODULES = [
    { key: 'profile', label: '个人资料', icon: 'mine/ic_user_head_ni.png' },
    { key: 'tree', label: '我的树洞', icon: 'tab/tab_tree_sel.png' },
    { key: 'moods', label: '心情签到', icon: 'mood/mood_happy.png' },
    { key: 'diaries', label: '碎碎念日记', icon: 'mine/ic_mine_daily.png' },
    { key: 'letters_in', label: '邮局收信', icon: 'sorrow/letter_can_open.png' },
    { key: 'letters_reply', label: '邮局回信', icon: 'bwg/ic_letter_reply.png' },
    { key: 'letters_future', label: '未来与过去信', icon: 'bwg/ic_future_letter.png' },
    { key: 'fm', label: '电台与心愿', icon: 'fm/fm_radio.png' },
    { key: 'friends', label: '关注/粉丝/访客', icon: 'feed/ic_dynamic_folow.png' }
  ];

  function newCheckpoint(saved) {
    var initArchive = emptyArchive();
    if (S.userBean && S.userBean.nickname) {
      initArchive.profile = profileOf(S.userBean);
    }
    S.accountKey = accountKeyOf(saved && saved.archive, saved);
    var cp = saved || {
      id: 'active',
      phone: S.phone,
      uid: S.uid,
      demo: S.demo,
      modules: {},
      archive: initArchive,
      count: 0,
      complete: false
    };
    cp.archive = archiveShape(cp.archive || initArchive);
    cp.modules = cp.modules || {};
    PULL_MODULES.forEach(function (m) {
      if (!cp.modules[m.key]) cp.modules[m.key] = { done: false, cursor: '', pageNo: 1, count: 0 };
    });
    return cp;
  }

  function dedupItems(list) {
    var seen = {}, out = [];
    array(list).forEach(function (x) {
      var k = String((x && x._source) || '') + ':' + String((x && x.id) || '') + ':' + String((x && x.time) || '') + ':' + String((x && x.text) || '').slice(0, 24);
      if (!seen[k]) { seen[k] = true; out.push(x); }
    });
    return out;
  }

  function moduleItems(key, archive) {
    var d = archive || S.archive || emptyArchive();
    if (key === 'profile') return d.profile && d.profile.nickname ? [d.profile] : [];
    if (key === 'letters_in') return d.post.inbox || [];
    if (key === 'letters_reply') return d.post.replied || [];
    if (key === 'letters_future') return (d.museum && d.museum.future) || [];
    return d[key] || [];
  }

  function applyPage(cp, module, response) {
    var items = array(response.items).map(function (item) { return normalizeItem(item, module.key); });
    var prevLen = moduleItems(module.key, cp.archive).length;
    if (module.key === 'profile') {
      cp.archive.profile = profileOf(response.profile || items[0] || cp.archive.profile);
    } else if (module.key === 'letters_in') {
      cp.archive.post.inbox = dedupItems(cp.archive.post.inbox.concat(items));
    } else if (module.key === 'letters_reply') {
      cp.archive.post.replied = dedupItems(cp.archive.post.replied.concat(items));
    } else if (module.key === 'letters_future') {
      cp.archive.museum.future = dedupItems(cp.archive.museum.future.concat(items));
    } else {
      cp.archive[module.key] = dedupItems((cp.archive[module.key] || []).concat(items));
    }
    if (module.key === 'friends') cp.archive.friends = cp.archive[module.key];

    var newLen = moduleItems(module.key, cp.archive).length;
    var added = module.key === 'profile' ? 1 : Math.max(0, newLen - prevLen);
    var state = cp.modules[module.key];
    state.count = module.key === 'profile' ? 1 : newLen;
    state.cursor = response.nextCursor || '';
    state.pageNo += 1;
    state.done = !response.hasMore || (module.key !== 'profile' && items.length > 0 && added === 0);

    cp.count += added;
    cp.archive = archiveShape(cp.archive);
    cp.complete = PULL_MODULES.every(function (m) { return cp.modules[m.key].done; });
    return added;
  }

  function startPull(saved) {
    S.isLocalArchive = false;
    var cp = newCheckpoint(saved);
    S.archive = cp.archive;
    S.activeTab = 'tree';
    S.pull = { cp: cp, active: '', running: false, paused: false, stopped: false, errorMsg: '', retryCount: 0, startedAt: Date.now(), startCount: cp.count || 0, pendingTree: 0 };
    enterSuisuiApp();
    IDB.put(cp).catch(function () {});
    runPull();
  }

  function runPull() {
    var pull = S.pull;
    if (!pull || pull.running || pull.paused || pull.stopped) return;
    pull.running = true;
    pull.errorMsg = '';
    (async function () {
      var delays = [1200, 2500, 5000, 8000, 12000];
      while (!pull.paused && !pull.stopped) {
        var mod = PULL_MODULES.filter(function (m) { return !pull.cp.modules[m.key].done; })[0];
        if (!mod) { pull.cp.complete = true; break; }
        pull.active = mod.key;
        refreshTopBackupBar();
        var res;
        try {
          var state = pull.cp.modules[mod.key];
          res = await safeFetchJson('/api/suisui/pull_page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module: mod.key, cursor: state.cursor, pageNo: state.pageNo,
              batchPages: mod.key === 'tree' ? 2 : 4, token: S.token, phone: S.phone, uid: S.uid, demo: S.demo })
          });
        } catch (err) {
          if (pull.stopped || pull.paused) break;
          var retryable = err.retryable || err.name === 'AbortError' || err instanceof TypeError;
          if (retryable && pull.retryCount < delays.length) {
            var wait = delays[pull.retryCount++];
            refreshTopBackupBar(true);
            await new Promise(function (resolve) { setTimeout(resolve, wait); });
            continue;
          }
          pull.paused = true;
          pull.errorMsg = friendlyError(err.message || '网络开小差了，请稍后再试');
          refreshTopBackupBar();
          break;
        }
        if (pull.stopped) break;
        pull.retryCount = 0;
        var added = applyPage(pull.cp, mod, res);
        S.archive = pull.cp.archive;
        try { await IDB.put(pull.cp); } catch (err) {
          pull.paused = true; pull.errorMsg = '本地保存失败，请检查设备存储空间'; refreshTopBackupBar(); break;
        }
        if (pull.stopped) break;
        refreshTopBackupBar(true);
        if (mod.key === 'tree' && added && S.activeTab === 'tree') {
          var stage = $('#suisui-stage');
          if (stage && $('.tree-feed-list .empty-state', stage) && !hasPlayingAudio()) renderCurrentStage();
          else { pull.pendingTree += added; showNewTreeNotice(); }
        }
      }
      pull.running = false;
      pull.active = '';
      if (pull.stopped) return;
      refreshTopBackupBar();
      if (pull.cp.complete && !hasPlayingAudio()) renderCurrentStage();
    }());
  }

  function hasPlayingAudio() {
    return $$('audio').some(function (audio) { return !audio.paused && !audio.ended; }) || !!(S.mineBgmAudio && !S.mineBgmAudio.paused);
  }

  function showNewTreeNotice() {
    var feed = $('.tree-feed-list'), pull = S.pull;
    if (!feed || !pull || !pull.pendingTree) return;
    var btn = $('.new-tree-notice', feed);
    if (!btn) { btn = el('button', 'new-tree-notice'); btn.type = 'button'; feed.appendChild(btn); }
    btn.textContent = '已新拉取 ' + pull.pendingTree + ' 条记录，点击刷新查看';
    btn.onclick = function () { pull.pendingTree = 0; renderCurrentStage(); };
  }

  function counts(d) {
    var tree = array(d.tree), media = 0, audio = 0, comments = 0;
    var allRecords = tree.concat(
      array(d.moods),
      array(d.diaries),
      array(d.post && d.post.inbox),
      array(d.post && d.post.replied),
      array(d.museum && d.museum.future)
    );
    allRecords.forEach(function (x) {
      media += array(x.images).length;
      if (x.audio) audio += 1;
      array(x.comments).forEach(function (c) {
        comments += 1 + array(c.subComments).length;
        if (c.image) media += 1;
      });
    });
    return {
      mood: array(d.moods).length,
      diary: array(d.diaries).length,
      tree: tree.length,
      media: media,
      audio: audio,
      comments: comments,
      letters: array(d.post && d.post.inbox).length + array(d.post && d.post.replied).length + array(d.museum && d.museum.future).length,
      friends: array(d.friends).length
    };
  }

  /* ==================== 3. 原版岁岁 App 主框架 ==================== */
  var APP_TABS = [
    { key: 'tree', label: '树洞', icon: 'tab/tab_tree.png', iconSel: 'tab/tab_tree_sel.png' },
    { key: 'sorrow', label: '解忧', icon: 'tab/tab_sorrow.png', iconSel: 'tab/tab_sorrow_sel.png' },
    { key: 'mood', label: '心情', icon: 'tab/tab_mood.png', iconSel: 'tab/tab_mood_sel.png' },
    { key: 'fm', label: '互动', icon: 'tab/tab_hudong.png', iconSel: 'tab/tab_hudong_sel.png' },
    { key: 'mine', label: '我的', icon: 'tab/tab_mine.png', iconSel: 'tab/tab_mine_sel.png' }
  ];

  function enterSuisuiApp() {
    window.scrollTo(0, 0);
    var app = $('#app');
    app.innerHTML = '';
    S.archive = archiveShape(S.archive || emptyArchive());

    var shell = el('div', 'suisui-app-shell');
    shell.innerHTML =
      '<header class="backup-topbar" id="backup-topbar"></header>' +
      '<main class="suisui-stage" id="suisui-stage"></main>' +
      '<nav class="suisui-bottom-nav" id="suisui-bottom-nav"></nav>';
    app.appendChild(shell);

    refreshTopBackupBar();
    renderBottomNav();
    renderCurrentStage();
  }

  function pullPercent() {
    if (!S.pull) return 100;
    var cp = S.pull.cp;
    if (cp.complete) return 100;
    var done = PULL_MODULES.filter(function (m) { return cp.modules[m.key] && cp.modules[m.key].done; }).length;
    return Math.round(done / PULL_MODULES.length * 100);
  }

  function refreshTopBackupBar(lightweight) {
    var topbar = $('#backup-topbar');
    if (!topbar) return;
    var d = S.archive || emptyArchive();
    var c = counts(d);
    var isPureOffline = Boolean(S.isLocalArchive && !S.pull && !S.token);
    var pull = S.pull;
    var syncing = syncStillGoing();
    var pct = pullPercent();
    var activeMod = pull && pull.active ? PULL_MODULES.filter(function (m) { return m.key === pull.active; })[0] : null;

    var titleText = '';
    var subText = '';
    if (isPureOffline) {
      titleText = (d.profile.nickname || '岁友') + ' 的岁岁时光纪念馆 · 本地离线';
      subText = '离线浏览中 · 数据保存在手机本地';
    } else if (S.exporting) {
      titleText = S.exportProgressTitle || '正在整理文字、照片与语音…';
      subText = S.exportProgressSub || '请稍候，马上就好';
    } else if (pull && pull.errorMsg) {
      titleText = '先停一下：' + friendlyError(pull.errorMsg);
      subText = '已经整理好的回忆都还在，点右侧就能继续';
    } else if (pull && !pull.cp.complete) {
      titleText = '正在同步' + (activeMod ? '「' + activeMod.label + '」' : '岁岁数据') + ' (' + pct + '%)';
      subText = pull.retryCount ? '网络波动，正在自动重试 (第 ' + pull.retryCount + '/5 次)…' :
        '已拉取 ' + c.tree + ' 条树洞 · ' + c.comments + ' 条评论 · 约 ' + (((pull.cp.count || 0) - (pull.startCount || 0)) / Math.max(1, (Date.now() - pull.startedAt) / 1000)).toFixed(1) + ' 条/秒';
    } else {
      titleText = (d.profile.nickname || '岁友') + ' 的岁岁记忆已就绪';
      subText = '树洞 ' + c.tree + ' · 评论 ' + c.comments + ' · 配图 ' + c.media + ' · 语音 ' + c.audio + ' · 心情/日记 ' + (c.mood + c.diary);
    }

    if (lightweight && $('.backup-status-title', topbar)) {
      $('.backup-status-title', topbar).textContent = titleText;
      $('.backup-status-sub span', topbar).textContent = subText;
      var line = $('.backup-progress-line i', topbar);
      if (line) line.style.width = pct + '%';
      return;
    }

    var drawerHTML = '';
    if (S.drawerOpen) {
      drawerHTML = '<div class="backup-drawer">' +
        '<div class="drawer-modules">' +
        PULL_MODULES.map(function (m) {
          var st = (pull && pull.cp.modules[m.key]) || { count: moduleItems(m.key, d).length, done: true };
          var stLabel = st.done ? ('已同步 ' + st.count + ' 项') : (pull && pull.active === m.key ? '正在同步…' : '等待同步');
          return '<div class="drawer-mod-chip">' +
            '<img src="' + A + m.icon + '" alt="">' +
            '<div><b>' + esc(m.label) + '</b><span>' + esc(stLabel) + '</span></div>' +
          '</div>';
        }).join('') +
        '</div>' +
        '<div class="drawer-foot-bar">' +
          '<span>备份包里有离线纪念册、照片原图、语音和文字手账</span>' +
          '<div>' +
            '<button id="btn-export-txt-only" type="button">只保存文字手账</button>' +
            '<button id="btn-open-privacy" type="button">珍藏说明</button>' +
            (S.nativeShell
              ? '<button id="btn-switch-zip" type="button">切换本地备份包</button>' +
                '<button id="btn-logout-account" type="button">切换账号</button>'
              : '<button id="btn-switch-account" type="button">切换账号</button>') +
          '</div>' +
          (S.nativeShell ? '' : '<div class="drawer-apk-row">' + apkLinkHTML() + '</div>') +
        '</div>' +
      '</div>';
    }

    var saveBarHTML = '';
    if (S.lastZipBlobUrl && !S.exporting && !isPureOffline) {
      var sizeMB = S.lastZipBlob ? (S.lastZipBlob.size / 1048576).toFixed(2) + ' MB' : '';
      saveBarHTML = '<div class="ready-save-bar">' +
        '<span>回忆备份包已就绪' + (sizeMB ? ' (' + sizeMB + ')' : '') + '，可保存到手机/电脑（建议顺手存一份到微信文件传输助手防丢）：</span>' +
        '<div class="ready-save-actions">' +
          '<a class="btn btn-teal" href="' + esc(S.lastZipBlobUrl) + '" download="' + esc(S.lastZipFilename || '岁岁备份.zip') + '">保存到手机/电脑</a>' +
          (navigator.canShare ? '<button class="btn btn-soft" id="btn-ios-share" type="button">存储到文件</button>' : '') +
          (S.nativeShell ? '' : apkLinkHTML()) +
        '</div>' +
      '</div>';
    }

    var rightBtnsHTML = '';
    if (pull && !pull.cp.complete) {
      if (pull.paused) {
        rightBtnsHTML += '<button class="btn btn-teal" id="btn-resume-pull" type="button">继续同步</button>';
      } else {
        rightBtnsHTML += '<button class="btn btn-soft" id="btn-pause-pull" type="button">暂停</button>';
      }
    }
    rightBtnsHTML += '<button class="btn btn-soft" id="btn-switch-account" type="button">切换账号</button>';
    rightBtnsHTML += '<button class="btn btn-primary btn-export-primary" id="btn-export-all" type="button"' + (S.exporting || syncing ? ' disabled' : '') + '>' +
      (S.exporting ? '正在整理…' : (syncing ? '整理回忆中…' : '保存全部岁岁回忆')) +
    '</button>';

    topbar.innerHTML = '<div class="backup-topbar-inner">' +
      '<div class="backup-row-main">' +
        '<div class="backup-status-left">' +
          '<img src="' + A + 'icon/logo_suisui_app.png" alt="岁岁">' +
          '<div class="backup-status-text">' +
            '<div class="backup-status-title">' + esc(titleText) + '</div>' +
            '<div class="backup-status-sub">' +
              '<span>' + esc(subText) + '</span>' +
              '<button class="backup-detail-toggle" id="toggle-backup-drawer" type="button">' + (S.drawerOpen ? '收起明细' : '备份明细') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="backup-actions-right">' +
          rightBtnsHTML +
        '</div>' +
      '</div>' +
      ((pull && !pull.cp.complete) || S.exporting ? '<div class="backup-progress-line"><i style="width:' + (S.exporting ? (S.exportPct || 15) : pct) + '%"></i></div>' : '') +
      saveBarHTML +
      drawerHTML +
    '</div>';

    var toggleBtn = $('#toggle-backup-drawer', topbar);
    if (toggleBtn) toggleBtn.onclick = function () { S.drawerOpen = !S.drawerOpen; refreshTopBackupBar(); };
    var exportBtn = $('#btn-export-all', topbar);
    if (exportBtn) exportBtn.onclick = function () {
      if (syncStillGoing()) { toast('正在整理回忆中，请稍候…'); return; }
      exportFullZip();
    };
    var pauseBtn = $('#btn-pause-pull', topbar);
    if (pauseBtn) pauseBtn.onclick = function () { if (S.pull) { S.pull.paused = true; refreshTopBackupBar(); } };
    var resumeBtn = $('#btn-resume-pull', topbar);
    if (resumeBtn) resumeBtn.onclick = function () { if (S.pull) { S.pull.paused = false; refreshTopBackupBar(); runPull(); } };
    var txtBtn = $('#btn-export-txt-only', topbar);
    if (txtBtn) txtBtn.onclick = exportTextOnly;
    var privBtn = $('#btn-open-privacy', topbar);
    if (privBtn) privBtn.onclick = openNoticeModal;
    var switchBtn = $('#btn-switch-account', topbar);
    if (switchBtn) switchBtn.onclick = showAccountSwitcher;
    var switchZipBtn = $('#btn-switch-zip', topbar);
    if (switchZipBtn) switchZipBtn.onclick = startNativeImport;
    var logoutBtn = $('#btn-logout-account', topbar);
    if (logoutBtn) logoutBtn.onclick = function () {
      if (S.pull) S.pull.stopped = true;
      if (S.mineBgmAudio) { try { S.mineBgmAudio.pause(); } catch (e) {} }
      revokeMediaCache();
      S.token = ''; S.uid = ''; S.phone = ''; S.pull = null; S.archive = null; S.isLocalArchive = false;
      renderLanding();
    };
    bindApkLinks(topbar);
    var shareBtn = $('#btn-ios-share', topbar);
    if (shareBtn && S.lastZipBlob) {
      shareBtn.onclick = function () {
        try {
          var file = new File([S.lastZipBlob], S.lastZipFilename || '岁岁备份.zip', { type: 'application/zip' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: '岁岁时光备份包' }).catch(function () {});
          }
        } catch (e) {}
      };
    }
  }

  function renderBottomNav() {
    var nav = $('#suisui-bottom-nav');
    if (!nav) return;
    nav.innerHTML = '<div class="suisui-bottom-nav-inner">' +
      APP_TABS.map(function (t) {
        var active = S.activeTab === t.key;
        return '<button class="nav-tab-btn' + (active ? ' active' : '') + '" data-tab="' + t.key + '" type="button">' +
          '<img src="' + A + (active ? t.iconSel : t.icon) + '" alt="' + t.label + '">' +
          '<span>' + t.label + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
    $$('.nav-tab-btn', nav).forEach(function (btn) {
      btn.onclick = function () {
        S.activeTab = btn.getAttribute('data-tab');
        window.scrollTo(0, 0);
        renderBottomNav();
        renderCurrentStage();
      };
    });
  }

  function renderCurrentStage() {
    var stage = $('#suisui-stage');
    if (!stage) return;
    array(S.stageObservers).forEach(function (observer) { observer.disconnect(); });
    S.stageObservers = [];
    stage.innerHTML = '';
    if (S.activeTab !== 'mine' && S.mineBgmAudio && !S.mineBgmAudio.paused) {
      try { S.mineBgmAudio.pause(); } catch (e) {}
    }
    var renderers = {
      tree: renderTreeTab,
      sorrow: renderSorrowTab,
      mood: renderMoodTab,
      fm: renderInteractTab,
      mine: renderMineTab
    };
    (renderers[S.activeTab] || renderTreeTab)(stage);
    bindMedia(stage);
  }

  /* ==================== Tab 1：原版树洞与完整评论区 ==================== */
  var STAR_PLANETS = [
    { name: '倾诉星', img: 'ic_star_view_0.png' },
    { name: '治愈星', img: 'ic_star_view_1.png' },
    { name: '开心星', img: 'ic_star_view_2.png' },
    { name: '漫游星', img: 'ic_star_view_3.png' }
  ];

  function renderCommentNode(c) {
    var avatar = c.avatar || DEFAULT_AVATAR;
    var subs = array(c.subComments);
    var subHTML = '';
    if (subs.length) {
      subHTML = '<div class="sub-comments-list">' +
        subs.map(function (sc) {
          var sAvatar = sc.avatar || DEFAULT_AVATAR;
          return '<div class="sub-comment-item">' +
            '<img class="sub-comment-avatar avatar-img" src="' + srcAttr(sAvatar, DEFAULT_AVATAR) + '" data-media="' + srcAttr(sAvatar) + '" alt="">' +
            '<div class="sub-comment-main">' +
              '<div class="comment-head-row">' +
                '<div class="comment-user-wrap">' +
                  '<span class="comment-nick">' + esc(sc.nickname || '岁友') + '</span>' +
                  (sc.level ? '<span class="lv-badge">Lv.' + esc(sc.level) + '</span>' : '') +
                  (sc.isMember ? '<img class="vip-icon" src="' + A + 'mine/ic_vip.png" alt="会员">' : '') +
                '</div>' +
                '<span class="comment-meta-row">' + esc(sc.time || '') + (sc.region ? ' · ' + esc(sc.region) : '') + (sc.likeCount ? ' · ' + esc(sc.likeCount) + ' 赞' : '') + '</span>' +
              '</div>' +
              '<div class="comment-body-text">' +
                (sc.replyTo ? '<span class="sub-reply-target">回复 @' + esc(sc.replyTo) + '：</span>' : '') +
                esc(sc.content || '') +
              '</div>' +
              (sc.image ? '<img class="comment-pic" src="' + srcAttr(sc.image) + '" data-media="' + srcAttr(sc.image) + '" data-lightbox alt="评论配图">' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    return '<div class="comment-item">' +
      '<img class="comment-avatar avatar-img" src="' + srcAttr(avatar, DEFAULT_AVATAR) + '" data-media="' + srcAttr(avatar) + '" alt="">' +
      '<div class="comment-main">' +
        '<div class="comment-head-row">' +
          '<div class="comment-user-wrap">' +
            '<span class="comment-nick">' + esc(c.nickname || '岁友') + '</span>' +
            (c.level ? '<span class="lv-badge">Lv.' + esc(c.level) + '</span>' : '') +
            (c.isMember ? '<img class="vip-icon" src="' + A + 'mine/ic_vip.png" alt="会员">' : '') +
          '</div>' +
          '<span class="comment-like"><img src="' + A + 'feed/ic_give_hug_normal.png" alt="">' + (c.likeCount || 0) + '</span>' +
        '</div>' +
        '<div class="comment-meta-row">' + esc(c.time || '') + (c.region ? ' · ' + esc(c.region) : '') + '</div>' +
        '<div class="comment-body-text">' + esc(c.content || '') + '</div>' +
        (c.image ? '<img class="comment-pic" src="' + srcAttr(c.image) + '" data-media="' + srcAttr(c.image) + '" data-lightbox alt="评论配图">' : '') +
        subHTML +
      '</div>' +
    '</div>';
  }

  function buildTreeCard(item) {
    item = normalizeItem(item, 'tree');
    var p = profileOf((S.archive || {}).profile);
    var avatar = item.avatar && item.avatar !== DEFAULT_AVATAR ? item.avatar : (p.avatar || DEFAULT_AVATAR);
    var lv = item.level || p.growth_level || 1;
    var imgs = array(item.images);
    var gridCls = imgs.length === 1 ? ' single' : (imgs.length === 2 || imgs.length === 4 ? ' double' : '');

    var comments = array(item.comments);
    var totalCommCount = item.commentsCount || comments.length;
    var previewComments = comments.slice(0, 3);
    var hiddenComments = comments.slice(3);

    var commentsSectionHTML = '';
    if (comments.length > 0) {
      commentsSectionHTML = '<div class="tree-comments-section">' +
        '<div class="comments-visible-list">' + previewComments.map(renderCommentNode).join('') + '</div>' +
        (hiddenComments.length > 0
          ? '<div class="comments-extra-list hidden"></div>' +
            '<button class="comments-more-btn" type="button">展开全部 ' + totalCommCount + ' 条评论与楼中楼</button>'
          : '') +
      '</div>';
    }

    var card = el('article', 'tree-card' + (item.backgroundCover ? ' has-paper' : ''));
    if (item.backgroundCover) card.setAttribute('data-bg-media', item.backgroundCover);
    card.innerHTML =
      '<div class="tree-card-header">' +
        '<div class="tree-avatar-wrap">' +
          '<img class="tree-avatar avatar-img" src="' + srcAttr(avatar, DEFAULT_AVATAR) + '" data-media="' + srcAttr(avatar) + '" alt="">' +
        '</div>' +
        '<div class="tree-user-meta">' +
          '<div class="tree-user-line">' +
            '<span class="tree-nickname">' + esc(item.nickname || p.nickname || '岁友') + '</span>' +
            '<span class="lv-badge">Lv.' + esc(lv) + '</span>' +
            (item.isMember ? '<img class="vip-icon" src="' + A + 'mine/ic_vip.png" alt="">' : '') +
            (Number(item.topStatus) === 1 ? '<span class="pin-badge">置顶</span>' : '') +
          '</div>' +
          '<div class="tree-time-loc">' + esc(item.time || '') + (item.region ? ' · ' + esc(item.region) : '') + '</div>' +
        '</div>' +
      '</div>' +
      (item.topicTitle ? '<div class="tree-topic-tag">#' + esc(item.topicTitle) + '#</div>' : '') +
      '<div class="tree-content-text">' + esc(item.text || item.body || '') + '</div>' +
      (imgs.length ? '<div class="tree-img-grid' + gridCls + '">' + imgs.slice(0, 9).map(function (u) {
        return '<img src="' + srcAttr(u) + '" data-media="' + srcAttr(u) + '" data-lightbox alt="树洞配图">';
      }).join('') + '</div>' : '') +
      (item.audio ? '<div class="tree-voice-bar">' +
        '<img class="voice-icon" src="' + A + 'feed/ic_voice_play.png" alt="">' +
        '<span class="voice-dur">' + (item.audioSecond ? item.audioSecond + '"' : '语音') + '</span>' +
        '<audio controls playsinline preload="metadata" src="' + srcAttr(item.audio) + '" data-media="' + srcAttr(item.audio) + '"></audio>' +
      '</div>' : '') +
      '<div class="tree-action-bar">' +
        '<span class="tree-action-item"><img src="' + A + 'feed/ic_give_hug_normal.png" alt="抱抱"><span>' + item.likeCount + ' 抱抱</span></span>' +
        '<span class="tree-action-item"><img src="' + A + 'tab/tab_hudong.png" alt="评论"><span>' + totalCommCount + ' 评论</span></span>' +
        (item.giftCount > 0 ? '<span class="tree-action-item"><img src="' + A + 'bwg/ic_letter_gift.png" alt="礼物"><span>' + item.giftCount + ' 份礼物</span></span>' : '') +
      '</div>' +
      commentsSectionHTML;

    var voice = $('.tree-voice-bar', card);
    if (voice) {
      var audio = $('audio', voice), dur = $('.voice-dur', voice);
      function updateVoice() {
        voice.classList.toggle('playing', !audio.paused && !audio.ended);
        var total = isFinite(audio.duration) ? Math.floor(audio.duration) : Number(item.audioSecond || 0);
        dur.textContent = (!audio.paused ? Math.floor(audio.currentTime) + '" / ' : '') + (total ? total + '"' : '语音');
      }
      voice.onclick = function (event) {
        if (event.target === audio || audio.contains(event.target)) return;
        if (audio.paused) { var promise = audio.play(); if (promise && promise.catch) promise.catch(function () { toast('语音暂时无法播放，请重试'); }); }
        else audio.pause();
      };
      audio.addEventListener('play', function () {
        $$('audio').forEach(function (other) { if (other !== audio) other.pause(); });
        if (S.mineBgmAudio && S.mineBgmAudio !== audio) S.mineBgmAudio.pause();
        updateVoice();
      });
      ['pause', 'ended', 'timeupdate', 'loadedmetadata'].forEach(function (name) { audio.addEventListener(name, updateVoice); });
      audio.addEventListener('error', function () { voice.classList.remove('playing'); toast('语音加载失败，请检查网络或原文件'); });
    }

    var moreBtn = $('.comments-more-btn', card);
    if (moreBtn) {
      moreBtn.onclick = function () {
        var extra = $('.comments-extra-list', card);
        if (!extra) return;
        if (!extra.dataset.loaded) {
          extra.innerHTML = hiddenComments.map(renderCommentNode).join('');
          extra.dataset.loaded = '1';
          bindMedia(extra);
          bindLightbox(extra);
        }
        var isHidden = extra.classList.toggle('hidden');
        moreBtn.textContent = isHidden ? ('展开全部 ' + totalCommCount + ' 条评论与楼中楼') : '收起评论';
      };
    }

    $$('[data-lightbox]', card).forEach(function (img) {
      img.onclick = function () {
        mediaURL(img.getAttribute('data-media') || img.src).then(openLightbox);
      };
    });

    return card;
  }

  function appendPaged(container, items, makeNode, label) {
    var cursor = 0, observer;
    var button = el('button', 'load-more-records');
    button.type = 'button';
    container.appendChild(button);
    function next() {
      if (!container.isConnected) { if (observer) observer.disconnect(); return; }
      var end = Math.min(cursor + 30, items.length), fragment = document.createDocumentFragment();
      while (cursor < end) fragment.appendChild(makeNode(items[cursor++]));
      bindMedia(fragment);
      container.insertBefore(fragment, button);
      var left = items.length - cursor;
      if (!left) { if (observer) observer.disconnect(); button.remove(); }
      else button.textContent = '加载更多' + label + '（剩余 ' + left + ' 条）';
    }
    button.onclick = next;
    next();
    if (cursor < items.length && window.IntersectionObserver) {
      observer = new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) next(); }, { rootMargin: '250px' });
      observer.observe(button);
      (S.stageObservers || (S.stageObservers = [])).push(observer);
    }
  }

  function renderTreeTab(stage) {
    var d = S.archive || emptyArchive();
    var c = counts(d);
    var banner = el('section', 'tree-planet-banner');
    banner.innerHTML =
      '<div class="tree-planet-top">' +
        '<div>' +
          '<h2>我的岁岁树洞</h2>' +
          '<p>共珍藏 ' + c.tree + ' 条树洞 · ' + c.media + ' 张配图 · ' + c.audio + ' 段语音 · ' + c.comments + ' 条评论</p>' +
        '</div>' +
        '<img class="planet-main-img" src="' + A + 'ic_star_view_0.png" alt="">' +
      '</div>' +
      '<div class="tree-planets-strip">' +
        STAR_PLANETS.map(function (sp) {
          return '<div class="planet-item"><img src="' + A + sp.img + '" alt=""><span>' + sp.name + '</span></div>';
        }).join('') +
      '</div>';
    stage.appendChild(banner);

    var feed = el('div', 'tree-feed-list');
    stage.appendChild(feed);
    var treeList = array(d.tree).slice();
    if (!treeList.length) {
      feed.innerHTML = '<div class="empty-state"><img src="' + A + 'empty/empty_star.png" alt=""><div>' + (S.pull && !S.pull.cp.complete ? '正在同步你的树洞记录…' : '暂无树洞记录') + '</div></div>';
    } else {
      appendPaged(feed, treeList, buildTreeCard, '树洞');
    }
    if (S.pull) { S.pull.pendingTree = 0; }
  }

  /* ==================== Tab 2：原版解忧馆与不晚邮局 ==================== */
  function renderSorrowTab(stage) {
    var d = archiveShape(S.archive || emptyArchive());
    var p = d.profile;
    var inbox = array(d.post && d.post.inbox);
    var replied = array(d.post && d.post.replied);
    var future = array(d.museum && d.museum.future);

    var hero = el('section', 'sorrow-scene-card sorrow-top-banner');
    hero.innerHTML =
      '<img class="sorrow-banner-art" src="' + A + 'ic_sorrow_home.png" alt="">' +
      '<div class="sorrow-scene-shade"></div>' +
      '<div class="sorrow-top-pills">' +
        '<span class="sorrow-pill"><img src="' + A + 'sorrow/sorrow_house.png" alt="">解忧博物馆</span>' +
        '<span class="sorrow-pill"><img src="' + A + 'sorrow/letter_can_open.png" alt="">共 ' + (inbox.length + replied.length + future.length) + ' 封信件</span>' +
      '</div>' +
      '<div class="sorrow-house-title">' +
        '<h2>' + esc(p.restaurantName || '不晚解忧馆') + '</h2>' +
        '<p>在这里收下跨越时间的来信、回信与寄往未来的心愿</p>' +
      '</div>' +
      '<img class="sorrow-wave" src="' + A + 'ic_sorrow_hu_bottom.png" alt="">';
    stage.appendChild(hero);

    var subNav = el('div', 'sub-pill-nav');
    var tabs = [
      { key: 'inbox', label: '寄出的信 (' + inbox.length + ')' },
      { key: 'replied', label: '往来回信 (' + replied.length + ')' },
      { key: 'future', label: '时空信件 (' + future.length + ')' }
    ];
    subNav.innerHTML = tabs.map(function (t) {
      return '<button class="' + (S.sorrowTab === t.key ? 'active' : '') + '" data-st="' + t.key + '" type="button">' + t.label + '</button>';
    }).join('');
    stage.appendChild(subNav);

    var grid = el('div', 'letter-cards-grid');
    var activeList = S.sorrowTab === 'inbox' ? inbox : (S.sorrowTab === 'replied' ? replied : future);
    if (!activeList.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><img src="' + A + 'sorrow/letter_empty.png" alt=""><div>该信箱暂无信件记录</div></div>';
    } else {
      activeList.forEach(function (letter) {
        var card = el('article', 'letter-envelope-card');
        var greeting = callLine(letter);
        var openDay = letter.majorDay || (letter._module === 'letters_future' ? dayText(letter.arrive) : '');
        card.innerHTML =
          '<img class="env-icon" src="' + A + 'sorrow/letter_can_open.png" alt="">' +
          '<img class="stamp-icon" src="' + A + 'sorrow/letter_stamp.png" alt="">' +
          (Number(letter.museumStatus) === 1 ? '<span class="museum-badge"><img src="' + A + 'bwg/ic_bwg_home_icon.png" alt="">馆藏</span>' : '') +
          (greeting ? '<div class="letter-call">' + esc(greeting) + '</div>' : '') +
          '<strong>' + esc(letter.title || '一封岁岁书信') + '</strong>' +
          (openDay ? '<div class="letter-open-day">约定开启日：' + esc(openDay) + '</div>' : '') +
          '<p>' + esc(letter.body || letter.text || '') + '</p>' +
          ((letter.images && letter.images.length) || letter.audio || letter.video
            ? '<div class="letter-attach">' + mediaGridHTML(letter.images) +
              (letter.audio ? '<audio controls playsinline preload="metadata" src="' + srcAttr(letter.audio) + '" data-media="' + srcAttr(letter.audio) + '"></audio>' : '') +
              (letter.video ? '<video controls playsinline preload="metadata" src="' + srcAttr(letter.video) + '" data-media="' + srcAttr(letter.video) + '"></video>' : '') +
              '</div>'
            : '') +
          '<small>' + esc(letter.time || '') + (letter.nickname ? ' · ' + esc(letter.nickname) : '') + '</small>';
        card.onclick = function () { openLetterModal(letter); };
        bindLightbox(card);
        grid.appendChild(card);
      });
    }
    stage.appendChild(grid);
    stage.appendChild(el('img', 'sorrow-page-wave')).src = A + 'ic_sorrow_hu_bottom.png';

    $$('button', subNav).forEach(function (btn) {
      btn.onclick = function () {
        S.sorrowTab = btn.getAttribute('data-st');
        renderCurrentStage();
      };
    });
  }

  function mediaGridHTML(images) {
    var imgs = array(images).filter(Boolean);
    if (!imgs.length) return '';
    var gridCls = imgs.length === 1 ? ' single' : (imgs.length === 2 || imgs.length === 4 ? ' double' : '');
    return '<div class="tree-img-grid' + gridCls + '">' + imgs.slice(0, 9).map(function (u) {
      return '<img src="' + srcAttr(u) + '" data-media="' + srcAttr(u) + '" data-lightbox alt="配图">';
    }).join('') + '</div>';
  }

  function bindLightbox(root) {
    $$('[data-lightbox]', root).forEach(function (img) {
      img.onclick = function (e) {
        if (e) e.stopPropagation();
        mediaURL(img.getAttribute('data-media') || img.src).then(openLightbox);
      };
    });
  }

  function openLetterModal(letter) {
    letter = normalizeItem(letter, letter._module || 'letters');
    var greeting = callLine(letter);
    var openDay = letter.majorDay || (letter._module === 'letters_future' ? dayText(letter.arrive) : '');
    var mask = el('div', 'modal-mask');
    mask.innerHTML = '<article class="letter-paper-modal">' +
      '<button class="close-btn" aria-label="关闭">×</button>' +
      '<img class="stamp" src="' + A + 'sorrow/letter_stamp.png" alt="">' +
      (Number(letter.museumStatus) === 1 ? '<div class="museum-badge"><img src="' + A + 'bwg/ic_bwg_home_icon.png" alt="">馆藏</div>' : '') +
      (greeting ? '<div class="letter-call">' + esc(greeting) + '</div>' : '') +
      '<h3>' + esc(letter.title || '岁岁书信') + '</h3>' +
      (openDay ? '<div class="letter-open-day">约定开启日：' + esc(openDay) + '</div>' : '') +
      '<div class="meta">' + esc(letter.time || '') + (letter.from ? ' · 来自 ' + esc(letter.from) : '') + (letter.to ? ' · 寄给 ' + esc(letter.to) : '') + '</div>' +
      '<div class="body">' + esc(letter.body || letter.text || '') + '</div>' +
      ((letter.images && letter.images.length) || letter.audio || letter.video
        ? '<div class="letter-attach">' + mediaGridHTML(letter.images) +
          (letter.audio ? '<audio controls playsinline preload="metadata" src="' + srcAttr(letter.audio) + '" data-media="' + srcAttr(letter.audio) + '"></audio>' : '') +
          (letter.video ? '<video controls playsinline preload="metadata" src="' + srcAttr(letter.video) + '" data-media="' + srcAttr(letter.video) + '"></video>' : '') +
          '</div>'
        : '') +
    '</article>';
    mask.onclick = function (e) { if (e.target === mask || e.target.closest('.close-btn')) mask.remove(); };
    document.body.appendChild(mask);
    bindMedia(mask);
    bindLightbox(mask);
  }

  /* ==================== Tab 3：原版心情与碎碎念日记本 ==================== */
  function renderMoodTab(stage) {
    var d = archiveShape(S.archive || emptyArchive());
    var moods = array(d.moods);
    var diaries = array(d.diaries);

    var banner = el('section', 'mood-banner-card');
    banner.innerHTML =
      '<img class="mood-main-face" src="' + A + 'mood/mood_happy.png" alt="">' +
      '<div class="mood-banner-info">' +
        '<h2>今日心情与碎碎念手账</h2>' +
        '<p>已记录 ' + moods.length + ' 次心情打卡 · ' + diaries.length + ' 篇碎碎念日记</p>' +
      '</div>';
    stage.appendChild(banner);

    var report = signReportView(d.profile);
    if (report) {
      var reportCard = el('section', 'sign-report-card');
      var keepText = report.continueDays ? '，连续记录 ' + report.continueDays + ' 天' : '';
      reportCard.innerHTML =
        '<h3>情绪统计报告</h3>' +
        '<p>已陪伴打卡 ' + (report.totalDays || moods.length) + ' 天' + keepText + '。这些颜色，是你走过的心情。</p>' +
        report.ratios.map(function (row) {
          var pct = Math.max(0, Math.min(100, Number(row.percent) || 0));
          return '<div class="sign-bar-row"><span>' + esc(row.name) + '</span><div class="sign-bar"><i style="width:' + pct + '%"></i></div><b>' + pct + '%</b></div>';
        }).join('');
      stage.appendChild(reportCard);
    }

    var subNav = el('div', 'sub-pill-nav');
    subNav.innerHTML =
      '<button class="' + (S.moodTab === 'moods' ? 'active' : '') + '" data-mt="moods" type="button">心情打卡 (' + moods.length + ')</button>' +
      '<button class="' + (S.moodTab === 'diaries' ? 'active' : '') + '" data-mt="diaries" type="button">碎碎念日记本 (' + diaries.length + ')</button>';
    stage.appendChild(subNav);

    var listWrap = el('div');
    if (S.moodTab === 'moods') {
      if (!moods.length) {
        listWrap.innerHTML = '<div class="empty-state"><img src="' + A + 'mood/mood_home_empty.png" alt=""><div>暂无心情打卡记录</div></div>';
      } else {
        moods.forEach(function (m) {
          var row = el('article', 'mood-record-card');
          row.innerHTML =
            '<img src="' + moodIconPath(m) + '" alt="">' +
            '<div class="mood-record-body">' +
              '<strong>' + esc(m.moodName || '心情打卡') + (m.causeName ? ' · ' + esc(m.causeName) : '') + '</strong>' +
              '<small>' + esc(m.time || '') + '</small>' +
              (m.causeDesc ? '<p>' + esc(m.causeDesc) + '</p>' : '') +
              (m.text && m.text !== m.causeDesc ? '<p>' + esc(m.text) + '</p>' : '') +
            '</div>';
          listWrap.appendChild(row);
        });
      }
    } else {
      if (!diaries.length) {
        listWrap.innerHTML = '<div class="empty-state"><img src="' + A + 'misc/ic_diary_home_first.png" alt=""><div>还没有写过碎碎念日记</div></div>' +
          '<img class="diary-bottom-art" src="' + A + 'misc/ic_diary_home_first_bottom.png" alt="">';
      } else {
        diaries.forEach(function (item) {
          var row = el('article', 'mood-record-card');
          row.innerHTML =
            '<img src="' + A + 'mine/ic_mine_daily.png" alt="">' +
            '<div class="mood-record-body">' +
              '<strong>' + esc(item.title || '碎碎念日记') + '</strong>' +
              '<small>' + esc(item.time || '') + '</small>' +
              '<p>' + esc(item.text || item.body || '') + '</p>' +
              mediaGridHTML(item.images) +
            '</div>';
          bindLightbox(row);
          listWrap.appendChild(row);
        });
        var diaryArt = el('img', 'diary-bottom-art');
        diaryArt.src = A + 'misc/ic_diary_home_first_bottom.png';
        diaryArt.alt = '';
        listWrap.appendChild(diaryArt);
      }
    }
    stage.appendChild(listWrap);

    $$('button', subNav).forEach(function (btn) {
      btn.onclick = function () {
        S.moodTab = btn.getAttribute('data-mt');
        renderCurrentStage();
      };
    });
  }

  function personRowHTML(person, relationLabel) {
    var pAvatar = person.avatar || DEFAULT_AVATAR;
    var sex = sexIcon(person);
    return '<img class="avatar-img" src="' + srcAttr(pAvatar, DEFAULT_AVATAR) + '" data-media="' + srcAttr(pAvatar) + '" alt="">' +
      '<div class="person-item-info">' +
        '<div class="person-name-line">' +
          '<strong>' + esc(person.nickname || person.name || '岁友') + '</strong>' +
          '<span class="person-badges">' +
            (Number(person.eachFollow) === 1 ? '<span class="mutual-badge">互相关注</span>' : '') +
            (sex ? '<img class="sex-icon" src="' + sex + '" alt="">' : '') +
            (person.isMember ? '<img class="vip-icon" src="' + A + 'mine/ic_vip.png" alt="">' : '') +
          '</span>' +
        '</div>' +
        '<small>' + esc(relationLabel || person.signature || person.text || person.last || (person.time ? '来访于 ' + person.time : '岁岁相遇')) + '</small>' +
      '</div>' +
      (person.time ? '<span style="font-size:11px;color:var(--muted)">' + esc(String(person.time).slice(0, 16)) + '</span>' : '');
  }

  /* ==================== Tab 4：互动 / 岁友、电台与星夜寄语墙 ==================== */
  function friendSourceLabel(person) {
    var source = String((person && (person._source || person.type || person.kind)) || '').toLowerCase();
    if (source === 'follow' || source === 'following') return '关注';
    if (source === 'fans' || source === 'fan' || source === 'follower') return '粉丝';
    if (source === 'visitors' || source === 'visitor' || source === 'visit') return '来访于' + (person.time ? ' ' + person.time : '');
    return person && person.time ? '来访于 ' + person.time : '岁岁相遇';
  }

  function renderInteractTab(stage) {
    var d = S.archive || emptyArchive();
    var fmList = array(d.fm);
    var friends = array(d.friends);

    var people = el('section', 'interact-friends-card');
    people.innerHTML = '<h3>我的岁友 (' + friends.length + ')</h3>';
    stage.appendChild(people);
    if (!friends.length) {
      people.insertAdjacentHTML('beforeend', '<div class="empty-state" style="padding:12px"><img src="' + A + 'empty/empty_search.png" alt=""><div>还没有岁友记录</div></div>');
    } else {
      appendPaged(people, friends.slice(), function (person) {
        var row = el('div', 'person-item-row');
        row.innerHTML = personRowHTML(person, friendSourceLabel(person));
        return row;
      }, '岁友');
    }

    var banner = el('section', 'fm-banner-card');
    banner.innerHTML =
      '<img src="' + A + 'fm/fm_radio.png" alt="岁岁电台">' +
      '<div>' +
        '<h2 style="margin:0 0 4px;font-size:18px">岁岁电台与心愿</h2>' +
        '<p style="margin:0;font-size:12px;color:var(--muted)">收录你的电台音频、心愿单与岁友毕业寄语墙</p>' +
      '</div>';
    stage.appendChild(banner);

    var trackWrap = el('div');
    stage.appendChild(trackWrap);
    if (!fmList.length) {
      trackWrap.innerHTML = '<div class="empty-state" style="padding:24px 16px"><img src="' + A + 'empty/empty_song.png" alt=""><div>暂无个人电台与心愿记录</div></div>';
    } else {
      appendPaged(trackWrap, fmList.slice(), function (f) {
        var card = el('article', 'fm-track-card');
        card.innerHTML =
          '<img src="' + srcAttr(f.cover || (A + 'fm/fm_music.png')) + '" data-media="' + srcAttr(f.cover || (A + 'fm/fm_music.png')) + '" alt="">' +
          '<div class="fm-track-info">' +
            '<strong>' + esc(f.title || f.text || '岁岁电台') + '</strong>' +
            '<small>' + esc(f.owner || f.nickname || '') + (f.duration || f.audioSecond ? ' · ' + esc(f.duration || (f.audioSecond + 's')) : '') + '</small>' +
            ((f.audio || f.src) ? '<audio controls playsinline preload="metadata" style="width:100%;height:30px;margin-top:6px" src="' + srcAttr(f.audio || f.src) + '" data-media="' + srcAttr(f.audio || f.src) + '"></audio>' : '') +
          '</div>';
        return card;
      }, '电台与心愿');
    }

    var wall = el('section', 'starlight-wall-card');
    wall.innerHTML =
      '<h3>岁友星夜寄语墙</h3>' +
      '<p style="margin:0;font-size:12px;color:var(--muted)">留下一句给岁岁和岁友们的告别或祝福</p>' +
      '<div class="starlight-input-row">' +
        '<input id="starlight-input" maxlength="80" placeholder="写下一句温暖的寄语（80字内）…">' +
        '<button class="btn btn-teal" id="starlight-send" type="button">点亮星光</button>' +
      '</div>' +
      '<div id="starlight-notes-box">正在加载星夜寄语…</div>';
    stage.appendChild(wall);

    loadStarlightWall(wall);
  }

  function loadStarlightWall(wall) {
    var box = $('#starlight-notes-box', wall);
    function renderNotes(data) {
      if (!box) return;
      var notes = array(data && data.notes);
      box.innerHTML = notes.length
        ? notes.slice(0, 15).map(function (n) {
            return '<div class="starlight-note-item">' + esc(n.text) + '<span>' + esc(n.time || '') + '</span></div>';
          }).join('')
        : '<div class="muted">还没有寄语</div>';
    }
    safeFetchJson('/api/starlight').then(renderNotes).catch(function () {
      if (box) box.innerHTML = '<div class="starlight-note-item">愿每一颗星星都有安歇的港湾，不急不忙，岁岁安康。</div>';
    });
    var sendBtn = $('#starlight-send', wall);
    if (sendBtn) {
      sendBtn.onclick = function () {
        var inp = $('#starlight-input', wall);
        var txt = inp ? inp.value.trim() : '';
        if (!txt) { toast('请先输入寄语内容'); return; }
        sendBtn.disabled = true;
        safeFetchJson('/api/starlight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: txt })
        }).then(function (data) {
          if (inp) inp.value = '';
          sendBtn.disabled = false;
          renderNotes(data);
          toast('已点亮星光并留下寄语');
        }).catch(function () {
          sendBtn.disabled = false;
          toast('提交失败，请稍后重试');
        });
      };
    }
  }

  function toggleMineBgm(url, btn) {
    if (!url) return;
    if (!S.mineBgmAudio) S.mineBgmAudio = new Audio();
    var audio = S.mineBgmAudio;
    if (!audio.paused && audio.dataset.src === url) {
      audio.pause();
      if (btn) btn.classList.remove('playing');
      return;
    }
    mediaURL(url, 'audio/mpeg').then(function (src) {
      if (!src) return;
      if (audio.dataset.src !== url) {
        audio.src = src;
        audio.dataset.src = url;
        audio.loop = true;
      }
      audio.play().then(function () {
        if (btn) btn.classList.add('playing');
      }).catch(function () {
        toast('暂时没法播放主页音乐');
      });
    });
  }

  /* ==================== Tab 5：原版个人主页与关注/粉丝/访客 ==================== */
  function renderMineTab(stage) {
    var d = archiveShape(S.archive || emptyArchive());
    var p = profileOf(d.profile);
    var fr = array(d.friends);
    var follows = fr.filter(function (x) { return x._source === 'follow' || x.type === 'follow' || x.kind === 'follow'; });
    var fans = fr.filter(function (x) { return x._source === 'fans' || x.type === 'fan' || x.kind === 'fan'; });
    var visitors = fr.filter(function (x) { return x._source === 'visitors' || x.type === 'visitor' || x.kind === 'visitor'; });

    var profileCard = el('section', 'mine-profile-card');
    profileCard.innerHTML =
      '<div class="mine-header-bg"' + (p.homepageCover ? ' data-bg-media="' + esc(p.homepageCover) + '"' : '') + '>' +
        (p.profileMusic ? '<button class="mine-bgm-btn" id="mine-bgm-btn" type="button" data-bgm="' + esc(p.profileMusic) + '"><img src="' + A + 'icon/ic_music_play.png" alt=""><span>主页音乐</span></button>' : '') +
        '<div class="mine-join-stamp">加入岁岁<b>' + esc(p.joinDays || 1) + '</b>天</div>' +
      '</div>' +
      '<div class="mine-profile-body">' +
        '<div class="mine-avatar-wrap">' +
          '<img class="mine-avatar avatar-img" src="' + srcAttr(p.avatar, DEFAULT_AVATAR) + '" data-media="' + srcAttr(p.avatar) + '" alt="头像">' +
          (p.profileFrame ? '<img class="mine-avatar-frame" src="' + srcAttr(p.profileFrame) + '" data-media="' + srcAttr(p.profileFrame) + '" alt="">' : '') +
        '</div>' +
        '<div class="mine-name-row">' +
          '<h2>' + esc(p.nickname) + '</h2>' +
          '<span class="lv-badge">Lv.' + esc(p.growth_level || 1) + '</span>' +
          (p.isGuardian ? '<span class="guardian-badge">守护者</span>' : '') +
        '</div>' +
        '<p class="mine-sign">' + esc(p.signature || '暂未填写签名') + '</p>' +
        (p.labels && p.labels.length ? '<div class="mine-labels">' + p.labels.map(function (lb) { return '<span class="label-pill">' + esc(lb) + '</span>'; }).join('') + '</div>' : '') +
        (p.betterThanPercent ? '<p class="mine-better">比 ' + esc(p.betterThanPercent) + '% 的岁友更常把心事安放在这里</p>' : '') +
        '<div class="mine-sub-tags">' +
          '<span>属地：' + esc(p.region) + '</span>' +
          '<span>·</span>' +
          '<span>' + esc(p.restaurantName) + '</span>' +
          (p.joinTime ? '<span>· 注册于 ' + esc(p.joinTime.slice(0, 10)) + '</span>' : '') +
        '</div>' +
        '<div class="mine-stats-bar">' +
          '<button class="mine-stat-btn' + (S.mineTab === 'follow' ? ' active' : '') + '" data-mtab="follow" type="button">' +
            '<b>' + (p.followCount || follows.length) + '</b><span>关注</span>' +
          '</button>' +
          '<button class="mine-stat-btn' + (S.mineTab === 'fans' ? ' active' : '') + '" data-mtab="fans" type="button">' +
            '<b>' + (p.fansCount || fans.length) + '</b><span>粉丝</span>' +
          '</button>' +
          '<button class="mine-stat-btn' + (S.mineTab === 'visitors' ? ' active' : '') + '" data-mtab="visitors" type="button">' +
            '<b>' + (p.visitCount || visitors.length) + '</b><span>访客</span>' +
          '</button>' +
          '<button class="mine-stat-btn" id="mine-go-tree" type="button">' +
            '<b>' + array(d.tree).length + '</b><span>树洞</span>' +
          '</button>' +
        '</div>' +
      '</div>';
    stage.appendChild(profileCard);

    /* 原版我的功能图标快捷栏 */
    var shortcuts = el('section', 'mine-shortcuts-card');
    shortcuts.innerHTML =
      '<button class="mine-shortcut-item" data-jump="mood-diaries" type="button"><img src="' + A + 'mine/ic_mine_daily.png" alt=""><span>我的日记</span></button>' +
      '<button class="mine-shortcut-item" data-jump="sorrow-future" type="button"><img src="' + A + 'mine/ic_mine_future.png" alt=""><span>未来信件</span></button>' +
      '<button class="mine-shortcut-item" data-jump="fm" type="button"><img src="' + A + 'mine/ic_mine_wish.png" alt=""><span>心愿与电台</span></button>' +
      '<button class="mine-shortcut-item" data-jump="privacy" type="button"><img src="' + A + 'mine/ic_mine_safe.png" alt=""><span>安全说明</span></button>' +
      '<button class="mine-shortcut-item" data-jump="accounts" type="button"><img src="' + A + 'mine/ic_user_head_ni.png" alt=""><span>切换账号</span></button>';
    stage.appendChild(shortcuts);

    var peopleCard = el('section', 'mine-people-card');
    var activeGroup = S.mineTab === 'follow' ? follows : (S.mineTab === 'fans' ? fans : visitors);
    var groupTitle = S.mineTab === 'follow'
      ? ('我的关注 (' + follows.length + ')')
      : (S.mineTab === 'fans' ? ('我的粉丝 (' + fans.length + ')') : ('最近来访记录 (' + visitors.length + ')'));
    peopleCard.innerHTML = '<h3>' + groupTitle + '</h3>';
    if (!activeGroup.length) {
      peopleCard.insertAdjacentHTML('beforeend', '<div class="empty-state" style="padding:20px"><img src="' + A + 'empty/empty_search.png" alt=""><div>暂无相关岁友记录</div></div>');
    } else {
      activeGroup.forEach(function (person) {
        var row = el('div', 'person-item-row');
        row.innerHTML = personRowHTML(person);
        peopleCard.appendChild(row);
      });
    }
    stage.appendChild(peopleCard);

    $$('[data-mtab]', profileCard).forEach(function (btn) {
      btn.onclick = function () {
        S.mineTab = btn.getAttribute('data-mtab');
        renderCurrentStage();
      };
    });
    var bgmBtn = $('#mine-bgm-btn', profileCard);
    if (bgmBtn) {
      bgmBtn.onclick = function () { toggleMineBgm(bgmBtn.getAttribute('data-bgm'), bgmBtn); };
      if (S.mineBgmAudio && !S.mineBgmAudio.paused) bgmBtn.classList.add('playing');
    }
    var goTree = $('#mine-go-tree', profileCard);
    if (goTree) {
      goTree.onclick = function () {
        S.activeTab = 'tree';
        renderBottomNav();
        renderCurrentStage();
      };
    }
    $$('[data-jump]', shortcuts).forEach(function (btn) {
      btn.onclick = function () {
        var j = btn.getAttribute('data-jump');
        if (j === 'mood-diaries') { S.activeTab = 'mood'; S.moodTab = 'diaries'; renderBottomNav(); renderCurrentStage(); }
        else if (j === 'sorrow-future') { S.activeTab = 'sorrow'; S.sorrowTab = 'future'; renderBottomNav(); renderCurrentStage(); }
        else if (j === 'fm') { S.activeTab = 'fm'; renderBottomNav(); renderCurrentStage(); }
        else if (j === 'privacy') { openNoticeModal(); }
        else if (j === 'accounts') { showAccountSwitcher(); }
      };
    });
  }

  function openLightbox(url) {
    if (!url) return;
    var box = el('div', 'lightbox');
    box.innerHTML = '<button aria-label="关闭">×</button><img src="' + esc(url) + '" alt="原图预览">';
    box.onclick = function () { box.remove(); };
    document.body.appendChild(box);
  }

  /* ==================== 4. 极速全量导出引擎（12路并发 + 完整评论头像 + 离线纪念馆） ==================== */
  function commentsToPlainText(comments, depth) {
    depth = depth || 0;
    var pad = new Array(depth + 1).join('  ');
    return array(comments).map(function (c) {
      var head = pad + '- ' + (c.nickname || '岁友') + (c.level ? ' [Lv.' + c.level + ']' : '') + (c.replyTo ? ' 回复 @' + c.replyTo : '') + '：' + (c.content || '');
      var tail = (c.time || c.region) ? ' (' + [c.time, c.region].filter(Boolean).join(' · ') + ')' : '';
      var sub = c.subComments && c.subComments.length ? '\n' + commentsToPlainText(c.subComments, depth + 1) : '';
      return head + tail + sub;
    }).join('\n');
  }

  function formatArchiveText(archive, markdown) {
    var d = archiveShape(archive), p = d.profile, out = [];
    var h = function (title) { out.push(markdown ? '## ' + title : '【' + title + '】'); };
    out.push(markdown ? '# 岁岁时光备份手账 · ' + p.nickname : '岁岁时光备份手账 · ' + p.nickname);
    out.push('导出时间：' + new Date().toLocaleString());
    out.push('');
    h('个人资料');
    out.push('昵称：' + p.nickname + ' (Lv.' + (p.growth_level || 1) + ')');
    out.push('签名：' + p.signature);
    out.push('属地：' + p.region);
    out.push('加入时间：' + (p.joinTime || '未知') + ' · 陪伴 ' + (p.joinDays || 1) + ' 天');
    out.push('解忧馆：' + p.restaurantName);
    out.push('关注 / 粉丝 / 访客：' + p.followCount + ' / ' + p.fansCount + ' / ' + p.visitCount);
    out.push('');

    function section(title, items, fn) {
      h(title + ' (' + items.length + ')');
      if (!items.length) out.push('（暂无记录）');
      items.forEach(function (item, idx) {
        out.push((idx + 1) + '. ' + fn(item));
        out.push('');
      });
    }

    section('我的树洞', d.tree, function (m) {
      return [
        m.time + (m.region ? ' · ' + m.region : ''),
        m.text,
        m.images.length ? '配图：' + m.images.length + ' 张' : '',
        m.audio ? '语音：' + m.audioSecond + ' 秒' : '',
        '抱抱：' + m.likeCount + ' · 评论：' + m.commentsCount,
        m.comments.length ? '评论区：\n' + commentsToPlainText(m.comments, 1) : ''
      ].filter(Boolean).join('\n');
    });
    section('心情打卡', d.moods, function (m) {
      return [m.time, m.moodName + (m.causeName ? ' · ' + m.causeName : ''), m.text].filter(Boolean).join('\n');
    });
    section('碎碎念日记', d.diaries, function (m) {
      return [m.time, m.title, m.text].filter(Boolean).join('\n');
    });
    section('不晚邮局收信', d.post.inbox, function (m) {
      return [m.time, m.title, m.body || m.text].filter(Boolean).join('\n');
    });
    section('不晚邮局回信', d.post.replied, function (m) {
      return [m.time, m.title, m.body || m.text].filter(Boolean).join('\n');
    });
    section('未来与过去信', d.museum.future, function (m) {
      return [m.time, m.title, m.body || m.text].filter(Boolean).join('\n');
    });
    section('关注 / 粉丝 / 访客', d.friends, function (m) {
      return [m.nickname || m.name, m.signature || m.text, m.time].filter(Boolean).join(' · ');
    });
    return out.join('\n');
  }

  function triggerDownload(blobUrl, filename) {
    var link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function exportTextOnly() {
    var d = archiveForExport();
    var name = '岁岁时光手账_' + (d.profile.nickname || '岁友') + '_' + new Date().toISOString().slice(0, 10) + '.txt';
    var blob = new Blob([formatArchiveText(d, false)], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    triggerDownload(url, name);
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    toast('已下载全文 TXT 手账');
  }

  function extension(url, contentType) {
    var rawUrl = String(url || '');
    try {
      var u = new URL(rawUrl, location.origin);
      var pathParam = u.searchParams.get('path') || u.pathname;
      var m = String(pathParam).match(/\.([a-z0-9]{2,5})$/i);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    var m2 = rawUrl.split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
    if (m2) return m2[1].toLowerCase();
    var type = String(contentType || '').toLowerCase();
    return type.indexOf('png') >= 0 ? 'png'
      : (type.indexOf('jpeg') >= 0 || type.indexOf('jpg') >= 0) ? 'jpeg'
      : type.indexOf('wav') >= 0 ? 'wav'
      : type.indexOf('mpeg') >= 0 ? 'mp3'
      : 'jpeg';
  }

  var MEDIA_KEY_RE = /^(images?|audio|avatar|avatarFrame|src|cover|voice|homepageCover|profileFrame|profileMusic|backgroundCover|video)$/i;

  function collectMediaRefs(archive) {
    var refs = [], seen = {};
    function add(url, kind) {
      url = String(url || '').trim();
      if (!url || seen[url] || !safeMediaURL(url) || /^(data:|assets\/|\.\/assets\/)/i.test(url)) return;
      seen[url] = true;
      refs.push({ url: url, kind: kind || 'media', index: refs.length + 1 });
    }
    function walk(value, key) {
      if (typeof value === 'string') {
        if (MEDIA_KEY_RE.test(key || '') && safeMediaURL(value)) add(value, key);
      } else if (Array.isArray(value)) {
        value.forEach(function (x) { walk(x, key); });
      } else if (value && typeof value === 'object') {
        Object.keys(value).forEach(function (k) {
          if (k === '_raw') return;
          walk(value[k], k);
        });
      }
    }
    walk(archive, '');
    return refs;
  }

  function fetchMedia(ref, attempt) {
    attempt = attempt || 0;
    if (S.zipReader && S.zipReader.has(ref.url)) {
      return S.zipReader.readBytes(ref.url).then(function (bytes) {
        return { bytes: bytes, ext: extension(ref.url, '') };
      }).catch(function () { return null; });
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    return fetch(ref.url, { signal: controller.signal }).then(function (res) {
      if (!res.ok) throw new Error('媒体下载失败');
      return res.arrayBuffer().then(function (buf) {
        return { bytes: new Uint8Array(buf), ext: extension(ref.url, res.headers.get('Content-Type')) };
      });
    }).catch(function () {
      if (attempt >= 3) return null;
      return new Promise(function (resolve) { setTimeout(resolve, [500, 1500, 3000][attempt]); }).then(function () { return fetchMedia(ref, attempt + 1); });
    }).finally(function () { clearTimeout(timer); });
  }

  function updateExportProgressDOM() {
    var title = $('.backup-status-title'), sub = $('.backup-status-sub span'), line = $('.backup-progress-line i');
    if (title) title.textContent = S.exportProgressTitle || '';
    if (sub) sub.textContent = S.exportProgressSub || '';
    if (line) line.style.width = (S.exportPct || 0) + '%';
  }

  function syncStillGoing() {
    S.syncing = !!(S.pull && S.pull.cp && !S.pull.cp.complete);
    return S.syncing;
  }

  function stripFailedApiMedia(value, failedSet, key) {
    if (typeof value === 'string') {
      if (MEDIA_KEY_RE.test(key || '') && failedSet[value] && /\/api\//.test(value)) return '';
      return value;
    }
    if (Array.isArray(value)) return value.map(function (x) { return stripFailedApiMedia(x, failedSet, key); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        out[k] = k === '_raw' ? value[k] : stripFailedApiMedia(value[k], failedSet, k);
      });
      return out;
    }
    return value;
  }

  function rewriteMedia(value, urlMap, key) {
    if (typeof value === 'string') {
      if (MEDIA_KEY_RE.test(key || '')) return urlMap[value] || value;
      return value;
    }
    if (Array.isArray(value)) return value.map(function (x) { return rewriteMedia(x, urlMap, key); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        out[k] = k === '_raw' ? value[k] : rewriteMedia(value[k], urlMap, k);
      });
      return out;
    }
    return value;
  }

  function standaloneHTML(archive) {
    var json = JSON.stringify(archive).replace(/</g, '\\u003c');
    var tpl = [
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
      '<title>岁岁 · 时光纪念馆（离线珍藏版）</title>',
      '<style>',
      'body{margin:0;background:linear-gradient(180deg,#DBEBEE 0%,#E8F2F2 45%,#F7F6F2 100%);background-attachment:fixed;color:#474A4D;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px}',
      'main{max-width:680px;margin:auto;padding:18px 14px 60px}',
      '.hero{background:#fff;border-radius:20px;padding:18px;margin-bottom:14px;box-shadow:0 4px 16px rgba(62,92,102,.06);display:flex;align-items:center;gap:14px}',
      '.hero img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #E6F4F1}',
      'h1{margin:0 0 4px;font-size:20px;color:#2E3133}nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}',
      'button{border:0;border-radius:999px;padding:8px 16px;background:#fff;color:#57A69A;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.04)}',
      'button.active{background:#57A69A;color:#fff}',
      '.card{background:#fff;border-radius:18px;padding:16px;margin:12px 0;line-height:1.75;box-shadow:0 4px 16px rgba(62,92,102,.06)}',
      '.head{display:flex;align-items:center;gap:10px;margin-bottom:8px}.head img{width:38px;height:38px;border-radius:50%;object-fit:cover;background:#EEF3F4}',
      '.lv{display:inline-block;padding:1px 6px;border-radius:99px;font-size:10px;color:#EF6418;background:#FFF0E6;margin-left:5px}',
      '.meta{color:#8A9199;font-size:11px}.body{white-space:pre-wrap;word-break:break-word;color:#2E3133}',
      '.pics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px}.pics img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px}',
      'audio{width:100%;margin-top:10px}.comms{margin-top:10px;padding:10px 12px;background:#F8F9FA;border-radius:12px;font-size:12px}',
      '.ci{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.05)}.ci:last-child{border-bottom:0}.ci img.ava{width:28px;height:28px;border-radius:50%;object-fit:cover;background:#E8EEF0;flex:none}',
      '.ci img.pic{width:72px;height:72px;border-radius:8px;object-fit:cover;margin-top:6px}',
      '.sub{margin-top:4px;padding-left:8px;border-left:2px solid #E3E8EC}',
      '.extra{margin-top:6px;color:#6B7B80;font-size:12px}.vip-icon{width:16px;height:16px;object-fit:contain;vertical-align:middle;margin-left:3px}',
      '</style></head><body><main id="app"></main>',
      '<script>var ARCHIVE=' + json + ';',
      '(function(){',
      'var d=ARCHIVE,a=document.getElementById("app"),p=d.profile||{};',
      'var AV="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'%3E%3Ccircle cx=\'32\' cy=\'32\' r=\'32\' fill=\'%23E7F3F1\'/%3E%3Ccircle cx=\'32\' cy=\'26\' r=\'10\' fill=\'%238FB8B0\'/%3E%3Cpath d=\'M14 54c4-10 12-14 18-14s14 4 18 14\' fill=\'%238FB8B0\'/%3E%3C/svg%3E";',
      'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\\x22/g,"&quot;").replace(/\\x27/g,"&#39;");}',
      'function av(u){u=String(u||"");if(!u||/^(\\.\\/)?assets\\//i.test(u))return AV;return u;}',
      'function imgTag(u,cls){if(!u)return "";var src=cls==="ava"?av(u):u;return "<img class=\\""+cls+"\\" src=\\""+esc(src)+"\\" onerror=\\"this.style.display=\'none\'\\">";}',
      'function renderComm(c){',
      '  var sub=(c.subComments||[]).map(function(sc){return "<div class=ci>"+imgTag(sc.avatar,"ava")+"<div><b>"+esc(sc.nickname||"岁友")+"</b>"+(sc.level?"<span class=lv>Lv."+esc(sc.level)+"</span>":"")+(sc.isMember?"<img class=vip-icon src=\"./assets/mine/ic_vip.png\" alt=\"会员\">":"")+" <span class=meta>"+esc(sc.time||"")+(sc.region?" · "+esc(sc.region):"")+(sc.likeCount?" · "+esc(sc.likeCount)+" 赞":"")+"</span><div>"+(sc.replyTo?"回复 @"+esc(sc.replyTo)+"：":"")+esc(sc.content||"")+"</div>"+imgTag(sc.image,"pic")+"</div></div>";}).join("");',
      '  return "<div class=ci>"+imgTag(c.avatar,"ava")+"<div style=flex:1><div><b>"+esc(c.nickname||"岁友")+"</b>"+(c.level?"<span class=lv>Lv."+esc(c.level)+"</span>":"")+(c.isMember?"<img class=vip-icon src=\"./assets/mine/ic_vip.png\" alt=\"会员\">":"")+" <span class=meta>"+esc(c.time||"")+(c.region?" · "+esc(c.region):"")+"</span></div><div>"+esc(c.content||"")+"</div>"+imgTag(c.image,"pic")+(sub?"<div class=sub>"+sub+"</div>":"")+"</div></div>";',
      '}',
      'function card(x){',
      '  var h="<article class=card><div class=head>"+imgTag(x.avatar||p.avatar,"ava")+"<div><div><b>"+esc(x.nickname||p.nickname||"岁友")+"</b>"+(x.level||p.growth_level?"<span class=lv>Lv."+esc(x.level||p.growth_level)+"</span>":"")+"</div><div class=meta>"+esc(x.time||"")+(x.region?" · "+esc(x.region):"")+"</div></div></div>";',
      '  if(x.moodName||x.causeName||x.causeDesc){h+="<div class=extra>"+esc([x.moodName,x.causeName].filter(Boolean).join(" · "))+(x.causeDesc?"<div>"+esc(x.causeDesc)+"</div>":"")+"</div>";}',
      '  if(x.majorDay){h+="<div class=extra>约定开启日："+esc(x.majorDay)+"</div>";}',
      '  h+="<div class=body>"+esc(x.text||x.body||x.title||x.signature||"")+"</div>";',
      '  if(x.likeCount||x.commentsCount){h+="<div class=extra>"+esc(x.likeCount||0)+" 抱抱 · "+esc(x.commentsCount||0)+" 评论</div>";}',
      '  if(x.images&&x.images.length){h+="<div class=pics>"+x.images.map(function(i){return "<img src=\\""+esc(i)+"\\" onerror=\\"this.style.display=\'none\'\\">";}).join("")+"</div>";}',
      '  if(x.audio){h+="<audio controls playsinline src=\\""+esc(x.audio)+"\\"></audio>";}',
      '  if(x.comments&&x.comments.length){h+="<div class=comms>"+x.comments.map(renderComm).join("")+"</div>";}',
      '  return h+"</article>";',
      '}',
      'function mine(){var sr=p.signReport||{},rs=Array.isArray(sr.ratios)?sr.ratios:[];return "<article class=card><div class=head>"+imgTag(p.avatar,"ava")+"<div><h2 style=\"margin:0\">"+esc(p.nickname||"岁友")+" <span class=lv>Lv."+esc(p.growth_level||1)+"</span></h2><div class=meta>"+esc(p.region||"")+" · "+esc(p.restaurantName||"岁岁解忧馆")+"</div></div></div><div class=body>"+esc(p.signature||"暂未填写签名")+"</div><div class=extra>加入岁岁 "+esc(p.joinDays||p.companion_days||1)+" 天 · IP 属地："+esc(p.region||"未知")+"</div><div class=extra>关注 "+esc(p.followCount||0)+" · 粉丝 "+esc(p.fansCount||0)+" · 访客 "+esc(p.visitCount||0)+" · 树洞 "+esc(p.treeholeCount||(d.tree||[]).length)+"</div>"+(p.labels&&p.labels.length?"<div class=extra>性格标签："+p.labels.map(function(x){return "<span class=lv>"+esc(x)+"</span>";}).join(" ")+"</div>":"")+(rs.length?"<div class=extra><b>情绪统计报告</b><br>"+rs.map(function(x){return esc(x.name)+"："+esc(x.percent||x.count||0)+(x.percent?"%":"");}).join(" · ")+"</div>":"")+"</article>";}',
      'var tabs=[["tree","树洞 ("+(d.tree||[]).length+")"],["mood","心情与日记 ("+((d.moods||[]).length+(d.diaries||[]).length)+")"],["letter","解忧邮局"],["fm","心愿与FM ("+(d.fm||[]).length+")"],["friends","关注/粉丝/访客 ("+(d.friends||[]).length+")"],["mine","我的资料"]];',
      'a.innerHTML="<div class=hero>"+imgTag(p.avatar,"ava")+"<div><h1>"+esc(p.nickname||"岁友")+" 的岁岁纪念馆</h1><div>"+esc(p.signature||"")+"</div><div class=meta>本地离线珍藏版 · 解压至同目录即可查看配图与播放语音</div></div></div><nav id=nav></nav><section id=items></section>";',
      'var nav=document.getElementById("nav");',
      'function show(k){',
      '  nav.innerHTML=tabs.map(function(t){return "<button class=\\\""+(t[0]===k?"active":"")+"\\\" data-k=\\\""+t[0]+"\\\">"+t[1]+"</button>";}).join("");',
      '  Array.prototype.forEach.call(nav.querySelectorAll("button"),function(b){b.onclick=function(){show(b.getAttribute("data-k"));};});',
      '  if(k==="mine"){document.getElementById("items").innerHTML=mine();return;}',
      '  var xs=k==="tree"?(d.tree||[]):k==="mood"?[].concat(d.moods||[],d.diaries||[]):k==="letter"?[].concat((d.post||{}).inbox||[],(d.post||{}).sent||[],(d.post||{}).replied||[],(d.museum||{}).future||[]):k==="fm"?(d.fm||[]):(d.friends||[]);',
      '  document.getElementById("items").innerHTML=xs.length?xs.map(card).join(""):"<div class=card>该分类下暂无记录</div>";',
      '}',
      'show("tree");',
      '})();<\/script></body></html>'
    ];
    return tpl.join('\n');
  }

  async function exportFullZip() {
    if (syncStillGoing()) {
      toast('正在整理回忆中，请稍候…');
      return;
    }
    if (S.exporting) return;
    S.exporting = true;
    S.exportPct = 5;
    S.exportProgressTitle = '正在整理文字、照片与语音…';
    S.exportProgressSub = '请稍候，马上就好';
    refreshTopBackupBar();

    try {
      var archive = archiveForExport();
      var writer = new SuisuiZipWriter();
      var refs = collectMediaRefs(archive);
      var urlMap = {};
      var failedUrls = [];
      var completed = 0, totalDownloadedBytes = 0, samples = [], nextRef = 0;
      var queue = refs.slice();

      async function mediaWorker() {
        while (nextRef < queue.length) {
          var ref = queue[nextRef++];
          var res = await fetchMedia(ref);
          completed += 1;
          if (res && res.bytes) {
            totalDownloadedBytes += res.bytes.byteLength;
            samples.push({ at: Date.now(), bytes: res.bytes.byteLength });
            var cutoff = Date.now() - 3000;
            while (samples.length && samples[0].at < cutoff) samples.shift();
            var path = 'media/' + String(ref.kind).replace(/[^a-z0-9_-]/gi, 'media') + '_' + ref.index + '.' + res.ext;
            writer.add(path, res.bytes);
            urlMap[ref.url] = path;
          } else {
            failedUrls.push(ref.url);
          }
          var elapsed = Math.max(0.001, (Date.now() - (samples[0] ? samples[0].at : Date.now())) / 1000);
          var speed = samples.reduce(function (sum, item) { return sum + item.bytes; }, 0) / elapsed / 1048576;
          S.exportPct = 8 + Math.round(completed / Math.max(1, refs.length) * 80);
          S.exportProgressTitle = '正在收录照片与语音 (' + completed + ' / ' + refs.length + ')';
          S.exportProgressSub = '已下载 ' + (totalDownloadedBytes / 1048576).toFixed(1) + ' MB · 速度 ' + speed.toFixed(1) + ' MB/s（自动重试保障中）';
          updateExportProgressDOM();
        }
      }

      var workers = [];
      for (var w = 0; w < 6; w++) workers.push(mediaWorker());
      await Promise.all(workers);

      S.exportPct = 92;
      S.exportProgressTitle = '正在写好离线纪念册，马上就能翻看…';
      refreshTopBackupBar();

      var exportData = rewriteMedia(archive, urlMap, '');
      var failedSet = {};
      failedUrls.forEach(function (u) { failedSet[u] = true; });
      var htmlArchive = stripFailedApiMedia(exportData, failedSet, '');
      writer.add('打开岁岁纪念馆.html', standaloneHTML(htmlArchive));
      writer.add('data/archive.json', JSON.stringify(exportData));
      writer.add('manifest.json', JSON.stringify({
        version: 2,
        accountKey: accountKeyOf(archive),
        uid: String(archive.profile.uid || S.uid || ''),
        nickname: archive.profile.nickname || '',
        generatedAt: new Date().toISOString(),
        totalMedia: refs.length,
        savedMedia: refs.length - failedUrls.length,
        failedMediaCount: failedUrls.length,
        urlMap: urlMap
      }, null, 2));
      writer.add('岁岁记忆全文合集.md', formatArchiveText(exportData, true));
      writer.add('岁岁记忆全文合集.txt', formatArchiveText(exportData, false));
      writer.add('README-如何查看我的回忆.txt', [
        '【岁岁 · 时光纪念馆 本地完整备份包】',
        '1. 电脑查看：将本压缩包完整解压后，双击「打开岁岁纪念馆.html」即可离线查看全部树洞、配图、评论与播放语音。',
        '2. 手机查看：打开岁岁备份网页，点击首页「打开本地备份包」，直接打开已保存的岁岁备份包。',
        '3. 记事本阅读：可直接打开「岁岁记忆全文合集.txt」或「.md」按时间轴阅读全部文字与历史评论。'
      ].join('\n'));

      var blob = await writer.finalize();
      if (S.lastZipBlobUrl) {
        try { URL.revokeObjectURL(S.lastZipBlobUrl); } catch (e) {}
      }
      var filename = '岁岁时光备份_' + (archive.profile.nickname || '岁友') + '_' + new Date().toISOString().slice(0, 10) + '.zip';
      S.lastZipBlob = blob;
      S.lastZipFilename = filename;
      S.lastZipBlobUrl = URL.createObjectURL(blob);
      S.exporting = false;
      refreshTopBackupBar();

      triggerDownload(S.lastZipBlobUrl, filename);
      if (isNativeShell()) {
        sendZipToNative(blob, filename);
      }
      var savedCount = refs.length - failedUrls.length;
      toast(isNativeShell()
        ? ('岁岁回忆备份包已生成并已存入 App 本地，正在唤起系统保存窗口…')
        : (failedUrls.length
          ? ('已收录 ' + savedCount + ' 份照片与语音（有 ' + failedUrls.length + ' 份原文件在岁岁端已失效） · 请将 .zip 存到电脑硬盘/网盘，别只留手机里')
          : ('岁岁回忆备份包已生成（共收录 ' + savedCount + ' 份照片与语音） · 请将 .zip 存到电脑硬盘/网盘，别只留手机里')));
    } catch (err) {
      S.exporting = false;
      refreshTopBackupBar();
      toast(friendlyError(err.message || '没有保存成功，请再试一次'));
    }
  }

  window.exportZip = exportFullZip;

  function openNativeArchive(data) {
    revokeMediaCache();
    S.nativeShell = true;
    S.isLocalArchive = true;
    S.archive = archiveShape(data);
    S.zipReader = null;
    S.pull = null;
    S.demo = false;
    S.activeTab = 'tree';
    enterSuisuiApp();
  }

  function nativeArchiveList() {
    if (!window.SuisuiNative || typeof window.SuisuiNative.listNativeArchives !== 'function') return [];
    try {
      var parsed = JSON.parse(window.SuisuiNative.listNativeArchives() || '[]');
      return array(parsed).map(function (item) { return typeof item === 'string' ? { accountKey: item } : item; });
    } catch (e) { return []; }
  }

  function switchNativeArchive(key) {
    if (!window.SuisuiNative || typeof window.SuisuiNative.switchNativeArchive !== 'function') return false;
    try { return window.SuisuiNative.switchNativeArchive(key) === true; } catch (e) { return false; }
  }

  function loadNativeArchive() {
    var hinted = window.SuisuiNative && typeof window.SuisuiNative.hasArchive === 'function' && window.SuisuiNative.hasArchive();
    return fetch('/archive/data/archive.json', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('missing');
      return response.json();
    }).then(openNativeArchive).catch(function () {
      if (!hinted) throw new Error('missing');
      return fetch('/archive/data/archive.json', { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('missing');
        return response.json();
      }).then(openNativeArchive);
    });
  }

  window.onNativeImportProgress = function (pct, msg) {
    S.nativeImportPct = Number(pct || 0);
    S.nativeImportMsg = String(msg || '正在把回忆放进纪念馆…');
    var bar = $('#native-import-bar');
    var status = $('#native-import-status');
    if (bar) bar.style.width = Math.max(0, Math.min(100, S.nativeImportPct)) + '%';
    if (status) status.textContent = S.nativeImportMsg;
    if (status) return;
    var overlay = document.getElementById('native-import-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'native-import-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(219,235,238,.94);display:flex;align-items:center;justify-content:center;padding:24px;';
      overlay.innerHTML = '<div style="background:#fff;border-radius:18px;padding:22px 20px;max-width:320px;width:100%;text-align:center"><div id="native-overlay-msg" style="font-weight:600;color:#2E3133"></div><div class="native-import-line"><i id="native-overlay-bar" style="width:0"></i></div></div>';
      document.body.appendChild(overlay);
    }
    var om = document.getElementById('native-overlay-msg');
    if (om) om.textContent = S.nativeImportMsg;
    var ob = document.getElementById('native-overlay-bar');
    if (ob) ob.style.width = Math.max(0, Math.min(100, S.nativeImportPct)) + '%';
  };

  window.onNativeImportDone = function (ok, errMsg) {
    var overlay = document.getElementById('native-import-overlay');
    if (overlay) overlay.remove();
    if (!ok) {
      var fail = friendlyError(errMsg || '导入没有完成，请再试一次');
      S.nativeImportMsg = fail;
      var status = $('#native-import-status');
      if (status) status.textContent = fail;
      toast(fail);
      return;
    }
    window.onNativeImportProgress(100, '回忆已经到家，正在翻开纪念馆…');
    fetch('/archive/data/archive.json', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('missing');
      return response.json();
    }).then(openNativeArchive).catch(function () {
      toast('备份包已经放好了，但暂时还打不开，请再试一次');
    });
  };

  window.suisuiHandleBack = function () {
    if (document.getElementById('native-import-overlay')) return true;
    var light = document.querySelector('.lightbox');
    if (light) { light.remove(); return true; }
    var mask = document.querySelector('.modal-mask');
    if (mask) { mask.remove(); return true; }
    if (S.drawerOpen) {
      S.drawerOpen = false;
      refreshTopBackupBar();
      return true;
    }
    if (!document.querySelector('.login-screen') && S.activeTab && S.activeTab !== 'tree') {
      S.activeTab = 'tree';
      window.scrollTo(0, 0);
      renderBottomNav();
      renderCurrentStage();
      return true;
    }
    return false;
  };

  function logoutToLanding() {
    if (S.pull) S.pull.stopped = true;
    if (S.mineBgmAudio) { try { S.mineBgmAudio.pause(); } catch (e) {} }
    revokeMediaCache();
    S.token = ''; S.uid = ''; S.phone = ''; S.pull = null; S.archive = null; S.isLocalArchive = false;
    renderLanding();
  }

  function showAccountSwitcher() {
    var mask = el('div', 'modal-mask');
    mask.innerHTML = '<article class="modal-card account-switch-card">' +
      '<button class="close-btn" aria-label="关闭">×</button>' +
      '<h2>切换或管理账号</h2>' +
      '<div id="account-switch-list">正在读取已存账号…</div>' +
      '<div class="account-switch-footer" style="margin-top:14px;display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn btn-primary" id="btn-modal-login-new" type="button" style="width:100%">+ 登录其他新账号 / 返回登录页</button>' +
        (S.nativeShell ? '<button class="btn btn-soft" id="btn-modal-import-zip" type="button" style="width:100%">导入本地 .zip 备份包</button>' : '') +
      '</div>' +
    '</article>';
    mask.onclick = function (event) { if (event.target === mask || event.target.closest('.close-btn')) mask.remove(); };
    document.body.appendChild(mask);
    var loginNewBtn = $('#btn-modal-login-new', mask);
    if (loginNewBtn) loginNewBtn.onclick = function () { mask.remove(); logoutToLanding(); };
    var importZipBtn = $('#btn-modal-import-zip', mask);
    if (importZipBtn) importZipBtn.onclick = function () { mask.remove(); startNativeImport(); };
    Promise.all([IDB.read('accounts_index_v1').catch(function () { return []; }), Promise.resolve(nativeArchiveList())]).then(function (parts) {
      var map = {};
      array(parts[0]).concat(parts[1]).forEach(function (item) {
        var key = item.key || item.accountKey;
        if (key) map[key] = Object.assign({}, map[key], item, { key: key });
      });
      var accounts = Object.keys(map).map(function (key) { return map[key]; });
      var box = $('#account-switch-list', mask);
      box.innerHTML = accounts.length ? accounts.map(function (item) {
        return '<button class="saved-account" data-switch-account="' + esc(item.key) + '" type="button"><div><b>' + esc(item.nickname || item.key) + '</b><small>' + esc(item.phoneMasked || '') + (item.phoneMasked ? ' · ' : '') + '树洞 ' + Number(item.treeCount || 0) + '</small></div><span>' + (item.key === S.accountKey ? '当前' : '进入') + '</span></button>';
      }).join('') : '<p style="color:#86909c;font-size:13px;margin:8px 0">当前还没有其他已保存账号，可点击下方按钮登录新账号</p>';
      $$('[data-switch-account]', box).forEach(function (btn) {
        btn.onclick = function () {
          var key = btn.getAttribute('data-switch-account');
          mask.remove();
          if (S.nativeShell && switchNativeArchive(key)) {
            S.accountKey = key;
            loadNativeArchive().catch(function () { enterSavedAccount(key); });
          } else enterSavedAccount(key);
        };
      });
    }).catch(function () { $('#account-switch-list', mask).textContent = '账号列表读取失败'; });
  }

  function boot() {
    S.nativeShell = isNativeShell();
    if (window.__SUISUI_ARCHIVE__) {
      S.archive = archiveShape(window.__SUISUI_ARCHIVE__);
      S.zipReader = null;
      enterSuisuiApp();
      return;
    }
    if (S.nativeShell) {
      loadNativeArchive().catch(function () { renderLanding(); });
      return;
    }
    renderLanding();
  }

  document.addEventListener('DOMContentLoaded', boot);
  window.SuisuiApp = { safeFetchJson: safeFetchJson, exportZip: exportFullZip, _state: S };
}());
