/** Purl Service Worker — PWA install + Share Target */

const CACHE_NAME = 'purl-v1';
const PRECACHE = [
  '/capture.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json'
];

// 설치: 캡처 페이지 프리캐시
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// 활성화: 오래된 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 폴백
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
