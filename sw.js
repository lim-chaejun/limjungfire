// 소방체크 Service Worker
const CACHE_NAME = 'sobangcheck-v2';

// 캐싱할 정적 자원
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/firebase.js',
  '/js/components.js',
  '/data/facilities.json',
  '/assets/favicon.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/manifest.json'
];

// 설치 이벤트 - 정적 자원 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 활성화 이벤트 - 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 타임아웃 fetch 헬퍼
function fetchWithTimeout(request, timeout = 5000) {
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

// Fetch 이벤트 - Network First 전략 (5초 타임아웃)
self.addEventListener('fetch', (event) => {
  // API 요청은 캐싱하지 않음
  if (event.request.url.includes('/api/') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('firebaseio.com') ||
      event.request.url.includes('gstatic.com/firebasejs')) {
    return;
  }

  event.respondWith(
    fetchWithTimeout(event.request, 5000)
      .then((response) => {
        // 성공적인 응답은 캐시에 저장
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 또는 타임아웃 시 캐시에서 반환
        return caches.match(event.request);
      })
  );
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
