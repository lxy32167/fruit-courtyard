const CACHE = 'arrows-escape-v1';
const CORE = ['./', './index.html', './styles.css', './app.js', './engine.js', './manifest.webmanifest', './assets/icon.svg', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png', './data/manifest.json', './data/main-000.json'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('arrows-escape-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    // Packs are immutable within a cache version; app shell uses network first.
    if (cached && /\/data\/.*\.json$/.test(url.pathname)) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (cached) return cached;
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw error;
    }
  }));
});
