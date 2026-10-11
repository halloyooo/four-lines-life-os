/* 四线生活系统 · Service Worker
 *
 * 更新策略（v2 起）：
 *   HTML 导航请求  → 网络优先，失败回落缓存。联网时永远拿到最新版本，离线时照常打开。
 *   其余静态资源  → 缓存优先 + 后台回源刷新（stale-while-revalidate）。
 *
 * v1 曾是无脑缓存优先，一旦装机就永远停在旧版；改动 HTML 必须手改 CACHE_NAME 才生效。
 * 现在只有新增 / 删除 APP_SHELL 条目时才需要动版本号。
 */
const VERSION = 'v2';
const CACHE_NAME = 'four-lines-life-os-' + VERSION;
const APP_SHELL = [
  './mobile.html',
  './mobile.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 单个资源 404 不该让整次安装失败，所以逐个 add 而非 addAll。
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch(() => undefined))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function cacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

function store(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  const wantsHtml = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (wantsHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheable(response)) store(request, response);
          return response;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match('./mobile.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (cacheable(response)) store(request, response);
        return response;
      });
      if (!cached) return network;
      // 已有缓存就立刻返回，回源只为刷新缓存；离线时这次 fetch 失败不应冒泡。
      event.waitUntil(network.catch(() => undefined));
      return cached;
    })
  );
});
