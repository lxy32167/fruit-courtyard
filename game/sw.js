const CACHE = 'fruit-courtyard-v4-fast-audio';
const ROOT = new URL('./', self.location.href);
const CORE = [
  './', 'index.html', 'styles.css', 'game.js', 'fruits.js', 'physics.js', 'renderer.js', 'storage.js', 'audio.js',
  'vendor/matter.min.js', 'manifest.webmanifest', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  ...Array.from({ length: 11 }, (_, i) => `assets/fruits/fruit-${String(i + 1).padStart(2, '0')}.png`),
  ...['drop', 'merge', 'merge-large', 'lose', 'watermelon', 'button', 'bomb', 'tidy', 'upgrade', 'shake'].map(name => `assets/audio/${name}.m4a`),
  ...['bomb', 'tidy', 'upgrade', 'shake'].map(name => `assets/props/${name}.png`),
].map(path => new URL(path, ROOT).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fruit-courtyard-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const asset = url.pathname.startsWith(new URL('assets/', ROOT).pathname)
    || url.pathname.startsWith(new URL('vendor/', ROOT).pathname);
  // Resolve cached images/audio immediately, even if the network remains stalled.
  if (asset) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && response.status === 200 && !url.pathname.endsWith('/music.m4a') && !url.pathname.endsWith('/music.wav')) {
        await cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    }));
    return;
  }
  // Keep code fresh, but do not leave a cached game waiting on an overseas request.
  const network = fetch(event.request, { cache: 'no-cache' }).then(async response => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone()).catch(() => {});
      return response;
    }
    return (await caches.match(event.request)) || response;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
      || (event.request.mode === 'navigate' ? await caches.match(new URL('index.html', ROOT).href) : null);
    if (!cached) return network;
    let timer;
    try {
      return await Promise.race([
        network.catch(() => cached),
        new Promise(resolve => { timer = setTimeout(() => resolve(cached), 2500); }),
      ]);
    } finally { clearTimeout(timer); }
  })());
});
