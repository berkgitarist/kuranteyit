const CACHE_VERSION = 'kuran-teyit-v64';

const STATIC_CACHE =
  `${CACHE_VERSION}-static`;

const DATA_CACHE =
  `${CACHE_VERSION}-data`;

const APP_SHELL = [
  './',
  './index.html',
  './guide.html',
  './evidence.html',
  './privacy.html',
  './licenses.html',
  './manifest.webmanifest',

  './css/style.css?v=61',
  './css/style.css?v=63',
  './css/evidence.css?v=62',

  './js/script.js?v=61',
  './js/evidence.js?v=55',
  './js/guide.js?v=63',

  './js/modules/core-utils.js',
  './js/modules/navigation-utils.js',
  './js/modules/meal-normalizer.js',
  './js/modules/note-validator.js',

  './assets/images/logo-main.png',
  './assets/images/logo-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL.map((url) =>
            cache.add(url)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheKeys) =>
        Promise.all(
          cacheKeys
            .filter(
              (key) =>
                key.startsWith('kuran-teyit-') &&
                key !== STATIC_CACHE &&
                key !== DATA_CACHE
            )
            .map((key) =>
              caches.delete(key)
            )
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache =
    await caches.open(cacheName);

  const cachedResponse =
    await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse =
    await fetch(request);

  if (networkResponse.ok) {
    await cache.put(
      request,
      networkResponse.clone()
    );
  }

  return networkResponse;
}

async function networkFirst(
  request,
  cacheName,
  fallbackUrl = null,
  fetchOptions = {}
) {
  const cache =
    await caches.open(cacheName);

  try {
    const networkResponse =
      await fetch(request, fetchOptions);

    if (networkResponse.ok) {
      await cache.put(
        request,
        networkResponse.clone()
      );
    }

    return networkResponse;
  } catch (error) {
    const cachedResponse =
      await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    if (fallbackUrl) {
      const fallbackResponse =
        await cache.match(fallbackUrl);

      if (fallbackResponse) {
        return fallbackResponse;
      }
    }

    return Response.error();
  }
}

async function freshDataFirst(request) {
  /*
   * JSON/veri dosyalari icin cache-first kullanmiyoruz.
   * Boylece quran_tr.json her istekte once Cloudflare'daki
   * guncel deployment'tan alinmaya calisilir.
   *
   * cache: 'no-store' tarayicinin HTTP cache'inden eski bir
   * cevap donmesini engeller. Basarili cevap DATA_CACHE'e yazilir;
   * internet yoksa son basarili kopya offline yedek olarak kullanilir.
   */
  return networkFirst(
    request,
    DATA_CACHE,
    null,
    { cache: 'no-store' }
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url =
    new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(
        request,
        STATIC_CACHE,
        './index.html',
        { cache: 'no-cache' }
      )
    );

    return;
  }

  /*
   * Kritik duzeltme:
   * quran_tr.json dahil tum yerel JSON/data dosyalari artik
   * CACHE-FIRST degil NETWORK-FIRST calisir.
   * Bu sayede GitHub -> Cloudflare deploy hook sonrasi yeni veri,
   * eski Service Worker Cache API kopyasi tarafindan maskelenmez.
   */
  if (
    url.pathname.includes('/data/') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(
      freshDataFirst(request)
    );

    return;
  }

  if (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(
      networkFirst(
        request,
        STATIC_CACHE,
        null,
        { cache: 'no-cache' }
      )
    );

    return;
  }

  event.respondWith(
    cacheFirst(
      request,
      STATIC_CACHE
    )
  );
});
