/* Service worker: network-first for the page, styles, and scripts (so updates
   appear together), cache-first for assets. Falls back to cache offline. */
const CACHE = 'pb-score-v6';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './formats.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function runtimeFallback(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return request.mode === 'navigate' ? caches.match('./index.html') : null;
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Runtime files are network-first so HTML, CSS, and both scripts never drift.
  const pathname = new URL(request.url).pathname;
  const runtimeFile = ['/styles.css', '/formats.js', '/app.js']
    .some((file) => pathname.endsWith(file));
  if (request.mode === 'navigate' || runtimeFile) {
    event.respondWith(
      fetch(request).then((response) => {
        const responseUrl = new URL(response.url || request.url);
        const sameOrigin = responseUrl.origin === self.location.origin;
        if (!response.ok || !sameOrigin) {
          return runtimeFallback(request).then((cached) => cached || response);
        }
        const copy = response.clone();
        return caches.open(CACHE)
          .then((cache) => cache.put(request, copy))
          .then(() => response);
      }).catch(() => runtimeFallback(request))
    );
    return;
  }

  // Assets: cache-first for speed, fetch and cache on miss.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
