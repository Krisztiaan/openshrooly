import { h, render } from "./vendor/preact.module.js";
import { useEffect } from "./vendor/hooks.module.js";
import htm from "./vendor/htm.module.js";
import { Dashboard } from "./components/dashboard.js";

const html = htm.bind(h);

function App() {
  useEffect(() => {
    document.body.classList.add("loaded");
    const localHosts = new Set(["localhost", "127.0.0.1", ""]);
    const shouldUseServiceWorker = !localHosts.has(window.location.hostname);

    if ("serviceWorker" in navigator) {
      if (shouldUseServiceWorker) {
        const swUrl = new URL("./service-worker.js", import.meta.url);
        navigator.serviceWorker
          .register(swUrl.href)
          .catch((error) =>
            console.error("[PWA] Service worker registration failed", error),
          );
      } else {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => registration.unregister());
        });
      }
    }
    return () => {
      document.body.classList.remove("loaded");
    };
  }, []);

  return html`<${Dashboard} />`;
}

render(html`<${App} />`, document.getElementById("app"));
