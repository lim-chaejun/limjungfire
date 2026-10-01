// 소방체크 Service Worker
// 캐시 이름을 바꾸면 activate 단계에서 이전 캐시(구버전 JS·데이터)가 모두 삭제된다.
const CACHE_NAME = 'sobangcheck-v4';

// 캐싱할 정적 자원 (리다이렉트되는 /index.html 은 제외)
const STATIC_ASSETS = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/js/firebase.js',
  '/js/components.js',
  '/js/lib/html.js',
  '/js/lib/building-types.js',
  '/js/lib/law-versions.js',
  '/data/facilities.json',
  '/assets/favicon.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/manifest.json'
];

// 네트워크가 느릴 때 캐시로 전환하기까지 기다리는 시간 (정적 자원만)
const STATIC_TIMEOUT_MS = 5000;

// 설치 이벤트 - 정적 자원 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 활성화 이벤트 - 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
  self.clients.claim();
});

// 타임아웃 fetch 헬퍼 (timeout이 없으면 네트워크 응답을 끝까지 기다림)
function fetchWithTimeout(request, timeout) {
  if (!timeout) return fetch(request);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    fetch(request).then((response) => {
      clearTimeout(timer);
      resolve(response);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Network First: 성공 응답은 캐시에 저장하고, 네트워크 실패 시에만 캐시 사용
async function networkFirst(request, timeout) {
  try {
    const response = await fetchWithTimeout(request, timeout);
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('오프라인 상태이거나 네트워크 응답이 없습니다.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // GET 이외(분석 비콘 POST 등)는 개입하지 않음
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 외부 도메인(공공데이터 API, 지도, Firebase, 분석 등)은 개입하지 않음
  // — 5초 타임아웃으로 느린 건축물대장 API 조회가 실패하거나 서비스키가 포함된 응답이 캐시되지 않도록
  if (url.origin !== self.location.origin) return;

  // 자체 API 프록시는 캐시하지 않음
  if (url.pathname.startsWith('/api/')) return;

  // 법령 데이터는 느리더라도 최신 응답을 기다린다 (오래된 법령 데이터 노출 방지)
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(networkFirst(request, 0));
    return;
  }

  event.respondWith(networkFirst(request, STATIC_TIMEOUT_MS));
});

// ============================================
// FCM 푸시 알림 핸들러 (향후 확장용)
// ============================================

// self.addEventListener('push', (event) => {
//   if (!event.data) return;
//
//   const data = event.data.json();
//   const options = {
//     body: data.body || '',
//     icon: '/assets/icons/icon-192.png',
//     badge: '/assets/icons/icon-192.png',
//     data: data.data || {}
//   };
//
//   event.waitUntil(
//     self.registration.showNotification(data.title || '소방체크', options)
//   );
// });

// self.addEventListener('notificationclick', (event) => {
//   event.notification.close();
//
//   const urlToOpen = event.notification.data?.url || '/';
//
//   event.waitUntil(
//     clients.matchAll({ type: 'window', includeUncontrolled: true })
//       .then((clientList) => {
//         for (const client of clientList) {
//           if (client.url === urlToOpen && 'focus' in client) {
//             return client.focus();
//           }
//         }
//         return clients.openWindow(urlToOpen);
//       })
//   );
// });
