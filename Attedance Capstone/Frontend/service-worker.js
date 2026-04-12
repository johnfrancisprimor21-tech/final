// AttendTrack Service Worker
// Caches all frontend assets for offline access

const CACHE_NAME = 'attendtrack-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/role-selector.html',
  '/student-dashboard.html',
  '/student-dashboard.css',
  '/student-dashboard.js',
  '/teacher-dashboard.html',
  '/teacher-script.js',
  '/teacher-style.css',
  '/stylestudent.css',
  '/auth.js',
  '/js/api-client.js',
  '/js/config.json',
  '/manifest.json'
];

// ── INSTALL: cache all assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching assets...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: clear old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: network first, fallback to cache ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // For API calls (Railway backend) — always go network, never cache
  if (url.hostname.includes('railway.app')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For everything else — try network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a valid response, cache it and return it
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // If nothing in cache either, return the login page as fallback
          return caches.match('/login.html');
        });
      })
  );
});
