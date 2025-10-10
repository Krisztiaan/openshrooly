const CACHE_VERSION = 'openshrooly-dashboard-v1'
const CACHE_NAME = `${CACHE_VERSION}`
const ASSETS = [
  '/app/',
  '/app/index.html',
  '/app/app.js',
  '/app/styles/app.css',
  '/app/components/dashboard.js',
  '/app/components/sensor-card.js',
  '/app/components/status-card.js',
  '/app/lib/esphome-api.js',
  '/app/vendor/preact.module.js',
  '/app/vendor/hooks.module.js',
  '/app/vendor/htm.module.js',
  '/app/manifest.webmanifest',
  '/app/service-worker.js',
  '/app/icons/icon-192.png',
  '/app/icons/icon-512.png',
  '/app/icons/icon-maskable.svg',
  '/app/icons/favicon.svg'
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch((err) => {
      console.error('[ServiceWorker] Asset caching failed', err)
    })
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('openshrooly-dashboard-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never try to cache the EventSource stream
  if (url.pathname.endsWith('/events')) {
    return
  }

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/app/') || url.pathname === '/' || url.pathname === '/app') {
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) return cached
          return fetch(request)
            .then((response) => {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
              return response
            })
            .catch(() => caches.match('/app/index.html'))
        })
      )
    }
  }
})
