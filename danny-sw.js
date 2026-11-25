// The file-scoped registration controls only the game document on the shared Pages origin.
const cacheName = 'junkdrawer-danny-shell-2026.11.25.1';
const page = './danny-the-pimple-popper.html';
const files = [page, './analytics-lite.js', './andi-the-rat-slayer/three.min.js',
  ...['style.css','game.js','render.js','input.js','simulation.js','instruments.js','audio.js',
    'storage.js','skin.jpg','BarlowCondensed-Bold.ttf','Barlow-Medium.ttf','icon-192.png',
    'icon-512.png','manifest.webmanifest'].map(name => './danny/' + name)];
const urls = new Set(files.map(path => new URL(path,self.location.href).href));
self.addEventListener('install', e => {
  e.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('junkdrawer-danny-shell-') && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate') url.search='';
  if (!urls.has(url.href)) return;
  e.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.href)) || fetch(e.request)));
});
