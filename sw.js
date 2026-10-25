// Here Comes the Sun: the app's own files always come from the network when it is reachable,
// bypassing GitHub Pages' 10-minute cache, so a new version shows up on the next load; the last
// copy is kept for offline use. Fonts are served from the cache once fetched. Everything else
// (forecast, routing, restaurants, webcams) is live data and goes straight to the network.
const CACHE = 'here-comes-the-sun';
const FONTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const { origin } = new URL(request.url);
  if (origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (FONTS.includes(origin)) event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
