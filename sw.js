// Service worker for nathanpenny.fun: offline support and installability.
// Bump CACHE_VERSION whenever deployed assets change meaningfully; old
// caches are deleted on activation.

const CACHE_VERSION = 'v17';
const CACHE_NAME = `nathanpenny-fun-${CACHE_VERSION}`;

// Core assets precached at install time so the site shell works offline.
const PRECACHE = [
  './',
  './index.html',
  './pages/about.html',
  './pages/blog.html',
  './pages/gallery.html',
  './pages/creations.html',
  './pages/contact.html',
  './pages/achievements.html',
  './404.html',
  './styles/style.css',
  './fonts/open-sans-latin-400.woff2',
  './fonts/fontawesome/css/all.min.css',
  './fonts/fontawesome/webfonts/fa-solid-900.woff2',
  './fonts/fontawesome/webfonts/fa-brands-400.woff2',
  './fonts/fontawesome/webfonts/fa-regular-400.woff2',
  './fonts/fontawesome/webfonts/fa-v4compatibility.woff2',
  './scripts/main.js',
  './data/gallery.json',
  './data/creations.json',
  './data/music-library.json',
  './feed.xml',
  './manifest.json',
  './NP-logo.svg',
  './images/og-image.jpg',
  './images/NathanPenny.webp',
  './images/icon-180.png',
  './images/icon-192.png',
  './images/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests; let the browser do the rest
  // (analytics, the comments API, and the remote video are all cross-origin).
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages and code files (css/js/json/xml): network-first so deployments show
  // up immediately, with the cached copy as the offline fallback. Offline and
  // not cached: serve the real 404 page with a 404 status instead of the
  // homepage masquerading as some other page.
  const isPage = event.request.mode === 'navigate' || url.pathname.endsWith('.html');
  const isCode = /\.(css|js|json|xml)$/.test(url.pathname);
  if (isPage || isCode) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => {
          const hit = await caches.match(event.request);
          if (hit) return hit;
          // Read the body out first: hand-constructing from the cached
          // Response's stream inside the worker can fail outright.
          const notFound = await caches.match('./404.html');
          if (!notFound) return Response.error();
          const html = await notFound.text();
          return new Response(html, {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // Static assets (images, audio, fonts): cache-first, filled on first use.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }))
  );
});
