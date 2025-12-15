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

const STATIC_RELATIVE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './quotes.json',
  './service-worker.js',
  './vite.svg',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.svg',
  './icons/sprite.svg',
]

const htmlFromOrigin = (relativePath) => new URL(relativePath, self.location.href).pathname

const manifestPaths = ['./.vite/manifest.json', './manifest.json']

const resolveAssetSet = async () => {
  const urls = new Set(STATIC_RELATIVE_ASSETS.map(htmlFromOrigin))

  if (BASE_PATH && BASE_PATH !== '/') {
    urls.add(BASE_PATH)
  }

  try {
    const manifest = await fetchViteManifest()
    if (manifest) {
      Object.values(manifest).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return

        if (entry.file) {
          urls.add(htmlFromOrigin(entry.file))
        }

        if (Array.isArray(entry.css)) {
          entry.css.forEach((cssPath) => urls.add(htmlFromOrigin(cssPath)))
        }

        if (Array.isArray(entry.assets)) {
          entry.assets.forEach((assetPath) => urls.add(htmlFromOrigin(assetPath)))
        }

        collectImportedAssets(entry.imports, manifest, urls)
        collectImportedAssets(entry.dynamicImports, manifest, urls)
      })
    }
  } catch (error) {
    console.warn('[ServiceWorker] Unable to read Vite manifest; precache may be incomplete', error)
  }

  return urls
}

const collectImportedAssets = (imports, manifest, urls) => {
  if (!Array.isArray(imports)) return

  imports.forEach((imported) => {
    const importedEntry = manifest[imported]
    if (!importedEntry || typeof importedEntry !== 'object') return

    if (importedEntry.file) {
      urls.add(htmlFromOrigin(importedEntry.file))
    }

    if (Array.isArray(importedEntry.css)) {
      importedEntry.css.forEach((cssPath) => urls.add(htmlFromOrigin(cssPath)))
    }

    if (Array.isArray(importedEntry.assets)) {
      importedEntry.assets.forEach((assetPath) => urls.add(htmlFromOrigin(assetPath)))
    }

    collectImportedAssets(importedEntry.imports, manifest, urls)
    collectImportedAssets(importedEntry.dynamicImports, manifest, urls)
  })
}

const fetchViteManifest = async () => {
  for (const manifestPath of manifestPaths) {
    try {
      const response = await fetch(new URL(manifestPath, self.location.href), {
        cache: 'no-cache',
      })

      if (response.ok) {
        return response.json()
      }

      console.warn(`[ServiceWorker] Failed to fetch ${manifestPath}: ${response.status}`)
    } catch (error) {
      console.warn(`[ServiceWorker] Error fetching ${manifestPath}`, error)
    }
  }

  return null
}

const assetSetPromise = DEV_MODE ? Promise.resolve(new Set()) : resolveAssetSet()

const INDEX_PATH = new URL('./index.html', self.location.href).pathname

self.addEventListener('install', (event) => {
  self.skipWaiting()
  if (DEV_MODE) return
  event.waitUntil(
    assetSetPromise
      .then((assetSet) => caches.open(CACHE_NAME).then((cache) => cache.addAll(Array.from(assetSet))))
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

self.addEventListener('fetch', (event) => {
  if (DEV_MODE) return

  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.pathname.endsWith('/events')) return

  if (url.origin !== self.location.origin) return

  event.respondWith(
    assetSetPromise.then((assetSet) => {
      const isAsset = assetSet.has(url.pathname)
      const isNavigation = request.mode === 'navigate'
      const withinScope = BASE_PATH
        ? url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`)
        : isAsset || url.pathname === '/' || url.pathname === ''

      if (!isAsset && !(isNavigation && withinScope)) {
        return fetch(request)
      }

      return caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request)
          .then((response) => {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            return response
          })
          .catch(() => (isNavigation ? caches.match(INDEX_PATH) : undefined))
      })
    })
  )
})
