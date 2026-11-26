// The file-scoped registration controls only the game document on the shared Pages origin.
const cacheName = 'junkdrawer-danny-shell-2026.11.25.6';
// Expansion media and modules are cached on first use, so the base install stays small and the
// expansion remains playable offline after one online visit.
const expansionCache = 'junkdrawer-danny-expansion-2026.11.25.6';
const page = './dani-the-pimple-popper.html';
const legacy = new URL('./danny-the-pimple-popper.html',self.location.href).href;
const expansionPrefixes = ['./danny/pore-explorer/','./danny/midnight-clinic/'].map(path => new URL(path,self.location.href).href);
const files = [page, './analytics-lite.js', './andi-the-rat-slayer/three.min.js',
  ...['style.css','game.js','render.js','input.js','simulation.js','instruments.js','audio.js',
    'storage.js','content.js','progression.js','reservoir.js','base.json','forehead.jpg','jaw.jpg','temple.jpg','nose.jpg','skin.jpg','BarlowCondensed-Bold.ttf','Barlow-Medium.ttf','icon-192.png',
    'icon-512.png','manifest.webmanifest'].map(name => './danny/' + name)];
const urls = new Set(files.map(path => new URL(path,self.location.href).href));
self.addEventListener('install', e => {
  e.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files.map(file => new Request(file,{cache:"reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // A player can visit the new URL while the original offline worker is still active.
    // Retire the two pre-rename caches only after replacing that worker on its own scope.
    if (self.registration.scope === legacy) {
      await Promise.all(['2026.11.25.1','2026.11.25.2','2026.11.25.3','2026.11.25.4','2026.11.25.5'].map(version =>
        caches.delete('junkdrawer-danny-shell-' + version)));
    }
    // Drop superseded shells and expansion caches from earlier releases; never touch other apps.
    for (const name of await caches.keys()) {
      if (name === cacheName || !name.startsWith('junkdrawer-danny-')) continue;
      if (name.startsWith('junkdrawer-danny-shell-') || name.startsWith('junkdrawer-danny-expansion-'))
        await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate') {
    url.search='';
    url.hash='';
    // Run the game even if an offline legacy installation has no canonical registration yet.
    if (url.href === legacy) url.href=new URL(page,self.location.href).href;
  }
  if (urls.has(url.href)) {
    e.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.href)) || fetch(e.request)));
    return;
  }
  if (url.origin === self.location.origin && expansionPrefixes.some(prefix => url.href.startsWith(prefix))) {
    // First-party expansion assets: cache after the first successful fetch, then serve locally.
    e.respondWith((async () => {
      const cache = await caches.open(expansionCache);
      const hit = await cache.match(url.href,{ignoreSearch:true});
      if (hit) return hit;
      const response = await fetch(e.request);
      if (response.ok && response.type === 'basic') await cache.put(url.href,response.clone());
      return response;
    })());
  }
});
