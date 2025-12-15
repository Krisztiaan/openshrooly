# OpenShrooly Dashboard — Svelte Port

This project is a full Svelte + Vite rewrite of the legacy build-less Preact dashboard. It preserves the ESPHome-compatible UI, offline-first behaviour, and modal/settings interactions while taking advantage of Svelte's reactivity and the Vite toolchain.

Static assets (icons, service worker, manifest, quotes) live under `public/` so the firmware embed pipeline can continue to consume the same files that were served previously.

## Getting Started

```bash
npm install
npm run dev
```

Running the dev server produces the dashboard at `http://localhost:5173/app/`. The service worker remains disabled on localhost to mirror the original behaviour; build output or hosts other than `localhost` will register it automatically.

The Vite dev server includes an embedded ESPHome-style mock API, so `npm run dev` is all you need to exercise the dashboard without hardware connected. The mock responds to `/json`, `/events`, and the per-entity endpoints (`/sensor/:id`, `/number/:id/set`, etc.) used by the UI.

## Quality Checks

- `npm run check` – type-checks `.svelte`, `.ts`, and the annotated `.js` helper modules.
- `npm run build` – builds the production bundle into `dist/` (service worker, manifest, and static assets from `public/` are copied automatically). Run this before embedding assets into the firmware.

### Styling

- Styling is powered by Tailwind CSS 4 with the official Vite plugin. Utility application lives in `src/app.css`, which layers Tailwind primitives over the existing markup.
- The dashboard now relies on Tailwind’s default palette and spacing scale (no bespoke design tokens).

## Project Structure

- `src/App.svelte` – the Svelte port of the dashboard runtime. It wires up connectivity, OTA, settings, and modal logic while delegating DOM synchronisation to the existing helper modules.
- `src/lib/` – shared helpers copied from the legacy dashboard (ESPHome API wrapper, entity formatters, preferences, timezones).
- `src/dom/` – the imperative DOM helpers (`overview`, `settings`, `modals`) reused unchanged from the original project.
- `public/` – icons, PWA manifest, service worker, and supporting JSON data embedded into the firmware.

## Notes

- The dashboard still loads the SVG sprite on demand (`icons/sprite.svg`) to keep the initial bundle lean.
- Local preferences (timezone) are stored in `localStorage` under `openshrooly:prefs`, matching the original naming so devices retain settings during the migration.
