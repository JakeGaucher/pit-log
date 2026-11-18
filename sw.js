// Pit Log service worker.
// Cache-first app shell so the app opens instantly and offline. A new release installs in the
// background and waits; the page shows "New version available — Reload" (F-05).
// >>> Bump VERSION on every deploy. <<<
const VERSION = '0.2.0';
const CACHE = 'pitlog-v' + VERSION;
const SHELL = ['./', './index.html', './app.css', './core.js', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // Fetch fresh copies (bypass HTTP cache) so the new cache never holds stale files.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // No skipWaiting here: the page decides when to switch.
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pitlog-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit ||
      fetch(e.request).catch(() => e.request.mode === 'navigate' ? c.match('./index.html') : Response.error())))
  );
});
