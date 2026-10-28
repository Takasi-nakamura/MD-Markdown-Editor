/* MD Editor service worker: versioned cache + safe offline fallback. */
const CACHE_PREFIX = 'md-editor-';
const CACHE_NAME = 'md-editor-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (asset) => {
      try {
        const response = await fetch(new Request(asset, { cache: 'reload' }));
        if (response.ok) await cache.put(asset, response);
      } catch {
        // Installation should still succeed if an optional shell request fails.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Private browsing / storage limits must not break the page response.
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== self.location.origin || !url.href.startsWith(scopeUrl.href)) return;

  // Always prefer the latest deployed HTML, but keep a cached copy for offline use.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await cacheResponse(new URL('./index.html', scopeUrl).href, response);
        return response;
      } catch {
        return (await caches.match(request)) ||
          (await caches.match(new URL('./index.html', scopeUrl).href)) ||
          (await caches.match(new URL('./', scopeUrl).href)) ||
          new Response('オフラインです。接続後にもう一度お試しください。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  // Cache-first for local static assets, with a background refresh when online.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const networkUpdate = fetch(request).then(async (response) => {
      await cacheResponse(request, response);
      return response;
    });
    if (cached) {
      event.waitUntil(networkUpdate.catch(() => {}));
      return cached;
    }
    try {
      return await networkUpdate;
    } catch {
      return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});
