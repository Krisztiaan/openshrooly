# OpenShrooly Dashboard (HTM + Preact, No Build)

This directory hosts the build-less dashboard served directly from the ESPHome web server. It reuses Preact's runtime and `htm` templates as ESM modules, so the firmware only needs to embed static HTML/CSS/JS files.

## Development

Open `index.html` in a modern browser via a local web server, or point it to a live device. No bundler is required—just edit the files and reload. The dashboard registers a service worker and PWA manifest, so running it from `http://localhost` mirrors the offline behaviour baked into the firmware.

### Mock firmware API

For local development without a device you can launch the Node mock server, which serves the dashboard and happy-path ESPHome endpoints:

```
node scripts/mock-server.js
```

This starts http://localhost:4000, proxies static files from `webapp/`, and implements `/json`, `/sensor/*`, `/number/*`, `/switch/*`, `/select/*`, and `/events` with in-memory state.

To auto-restart the mock server whenever dashboard files change, you can use `npx nodemon` (no global install needed):

```
npx nodemon --watch webapp --ext js,mjs,css,html,json --exec "node scripts/mock-server.js"
```

If you already have `watchexec` installed, a similar command is:

```
watchexec --clear --restart --watch webapp --exts js,mjs,css,html,json -- node scripts/mock-server.js
```

## Updating vendor modules

`./vendor/` contains pinned copies of:

- `preact@10.22.0`
- `preact/hooks@10.22.0`
- `htm@3.1.1`

Refresh them manually with `curl` if upstream releases are needed.

## Embedding into firmware

The PlatformIO build step runs `embed_static_files.py` automatically via `extra_scripts` in `esphome/openshrooly.yaml`, so compiling firmware always regenerates the embedded headers. You can still run the script manually if you want to diff the output without compiling.
