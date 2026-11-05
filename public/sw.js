/* 岁岁·时光纪念馆 Service Worker — 网络优先 + 离线回退 */
var CACHE = 'suisui-shell-v8';
var SHELL = [
  './index.html',
  './css/app.css?v=2026110508',
  './js/zip-engine.js?v=2026110508',
  './js/demo-data.js?v=2026110508',
  './js/app.js?v=2026110508',
  './manifest.webmanifest',
  './assets/manifest.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.pathname.indexOf('/download/') === 0 || /\.apk$/i.test(url.pathname)) return;

  var isAsset = /\.(png|jpg|jpeg|gif|webp|svg|mp3|wav|ico)$/i.test(url.pathname);
  if (isAsset) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.ok && url.origin === self.location.origin) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
  } else {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return cached;
        });
      })
    );
  }
});
