const CACHE_VERSION = 'openshrooly-dashboard-v2'
const CACHE_NAME = CACHE_VERSION

const BASE_PATH = (() => {
  const path = new URL('.', self.location.href).pathname
  if (path === '/' || path === '') return ''
  return path.replace(/\/$/, '')
})()

const RELATIVE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles/app.css',
  './components/dashboard.js',
  './components/sensor-card.js',
  './components/status-card.js',
  './lib/esphome-api.js',
  './vendor/preact.module.js',
  './vendor/hooks.module.js',
  './vendor/htm.module.js',
  './manifest.webmanifest',
  './service-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.svg',
  './icons/favicon.svg',
]

const ASSET_URLS = Array.from(
  new Set(
    RELATIVE_ASSETS.map((relativePath) => new URL(relativePath, self.location.href).pathname).concat(
      BASE_PATH && BASE_PATH !== '/' ? [BASE_PATH] : []
    )
  )
)

const INDEX_PATH = new URL('./index.html', self.location.href).pathname

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_URLS))
      .catch((error) => console.error('[ServiceWorker] Asset caching failed', error))
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

const ASSET_SET = new Set(ASSET_URLS)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.pathname.endsWith('/events')) return

  if (url.origin !== self.location.origin) return

  const isAsset = ASSET_SET.has(url.pathname)
  const isNavigation = request.mode === 'navigate'
  const withinScope = BASE_PATH
    ? url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`)
    : isAsset || url.pathname === '/' || url.pathname === ''

  if (!isAsset && !(isNavigation && withinScope)) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(INDEX_PATH))
    })
  )
})
