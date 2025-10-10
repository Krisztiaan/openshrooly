import { h, render } from './vendor/preact.module.js'
import { useEffect } from './vendor/hooks.module.js'
import htm from './vendor/htm.module.js'
import { Dashboard } from './components/dashboard.js'

const html = htm.bind(h)

function App() {
  useEffect(() => {
    document.body.classList.add('loaded')
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/app/service-worker.js')
        .catch((error) => console.error('[PWA] Service worker registration failed', error))
    }
    return () => {
      document.body.classList.remove('loaded')
    }
  }, [])

  return html`<${Dashboard} />`
}

render(html`<${App} />`, document.getElementById('app'))
