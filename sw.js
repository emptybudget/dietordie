// sw.js — network-first 서비스 워커.
// 항상 네트워크를 먼저 시도해 재배포된 새 버전을 반영하고,
// 오프라인일 때만 캐시로 대체한다.

const CACHE = 'ddiet-v1';
const ASSETS = [
  '.',
  'index.html',
  'style.css',
  'app.js',
  'storage.js',
  'manifest.json',
  'icon.svg',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // 성공한 동일 출처 응답은 캐시를 갱신해 둔다.
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
