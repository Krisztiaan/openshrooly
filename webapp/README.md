# OpenShrooly Dashboard (HTM + Preact, No Build)

This directory hosts the build-less dashboard served directly from the ESPHome web server. It reuses Preact's runtime and `htm` templates as ESM modules, so the firmware only needs to embed static HTML/CSS/JS files.

## Development

Open `index.html` in a modern browser via a local web server, or point it to a live device. No bundler is required—just edit the files and reload. The dashboard registers a service worker and PWA manifest, so running it from `http://localhost` mirrors the offline behaviour baked into the firmware.

```
python3 -m http.server -d webapp
```

The dashboard expects ESPHome's native REST endpoints (e.g. `/sensor/*`, `/switch/*`) and `EventSource` at `/events`.

## Updating vendor modules

`./vendor/` contains pinned copies of:

- `preact@10.22.0`
- `preact/hooks@10.22.0`
- `htm@3.1.1`

Refresh them manually with `curl` if upstream releases are needed.

## Embedding into firmware

Run the existing embed script from the repository root:

```
python3 esphome/external_components/web_server/embed_static_files.py \
  webapp \
  esphome/external_components/web_server/static_files.h \
  esphome/external_components/web_server/static_files.cpp
```

Because filenames stay stable, the generated C++ output should now be deterministic across environments.
