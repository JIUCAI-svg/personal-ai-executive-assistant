const CACHE = 'forward-shell-v2';
const BASE = self.registration.scope.endsWith('/') ? self.registration.scope : `${self.registration.scope}/`;
const ASSETS = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}app-icon.svg`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_REMINDER') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: '/app-icon.svg',
      badge: '/app-icon.svg',
      tag: 'forward-reminder'
    });
  }
});
