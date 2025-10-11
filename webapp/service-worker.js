const STAMPED_CACHE_VERSION = '__CACHE_VERSION_STAMPED__'
const DEV_HOSTNAMES = ['localhost', '127.0.0.1', '']
const DEV_MODE =
  STAMPED_CACHE_VERSION === '__CACHE_VERSION_STAMPED__' ||
  DEV_HOSTNAMES.includes(self.location.hostname || '')
const CACHE_NAME = DEV_MODE
  ? 'openshrooly-dashboard-dev'
  : STAMPED_CACHE_VERSION

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
  './components/modal-sheet.js',
  './components/toggle-switch.js',
  './components/sensor-card.js',
  './components/settings-row.js',
  './components/status-card.js',
  './lib/esphome-api.js',
  './vendor/preact.module.js',
  './vendor/preact.module.js.map',
  './vendor/hooks.module.js',
  './vendor/hooks.module.js.map',
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
  if (DEV_MODE) return
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSET_URLS))
      .catch((error) => console.error('[ServiceWorker] Asset caching failed', error))
  )
})

self.addEventListener('activate', (event) => {
  if (DEV_MODE) {
    event.waitUntil(self.clients.claim())
    return
  }

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('openshrooly-dashboard-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

const ASSET_SET = new Set(ASSET_URLS)

self.addEventListener('fetch', (event) => {
  if (DEV_MODE) return

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

  if (!isAsset && !(isNavigation && withinScope)) return

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
