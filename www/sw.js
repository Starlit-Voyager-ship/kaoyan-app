/* ========================================
   考研学习助手 - Service Worker
   缓存应用壳，支持离线打开；跨域 API 请求不缓存。
   ======================================== */
const CACHE = 'kaoyan-app-v5';
const ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './css/components.css',
  './css/modules.css',
  './css/pet.css',
  './js/utils.js',
  './js/store.js',
  './js/auth.js',
  './js/pomodoro.js',
  './js/ai-assistant.js',
  './js/english/vocabulary.js',
  './js/english/articles.js',
  './js/english/sentences.js',
  './js/english/essay.js',
  './js/math/question-bank.js',
  './js/math/weak-points.js',
  './js/reports.js',
  './js/friend-wake.js',
  './js/pet.js',
  './js/pet-ui.js',
  './js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/pet/chibi.png'
];

// 安装：预缓存应用壳
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 请求拦截：同源静态资源优先用缓存，跨域（AI API）直接走网络
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 不缓存 DeepSeek/千问等接口

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return resp;
        })
        .catch(() => cached);
    })
  );
});
