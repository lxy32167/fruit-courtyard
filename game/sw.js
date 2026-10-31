const CACHE = 'fruit-courtyard-v3-single-use';
const ROOT = new URL('./', self.location.href);
const CORE = [
  './', 'index.html', 'styles.css', 'game.js', 'fruits.js', 'physics.js', 'renderer.js', 'storage.js', 'audio.js',
  'vendor/matter.min.js', 'manifest.webmanifest', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  ...Array.from({ length: 11 }, (_, i) => `assets/fruits/fruit-${String(i + 1).padStart(2, '0')}.png`),
  ...['drop', 'merge', 'merge-large', 'lose', 'watermelon', 'button', 'bomb', 'tidy', 'upgrade', 'shake'].map(name => `assets/audio/${name}.wav`),
  ...['bomb', 'tidy', 'upgrade', 'shake'].map(name => `assets/props/${name}.png`),
].map(path => new URL(path, ROOT).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fruit-courtyard-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // Prefer fresh files during local development; cached files remain an offline fallback.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !url.pathname.endsWith('/music.wav')) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match(new URL('index.html', ROOT).href) : Response.error())));
});
