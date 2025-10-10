# Modified Web Server Component with Embedded Static Files

This is a modified version of ESPHome's built-in `web_server` component that adds support for serving embedded static files from flash memory.

## Features

- All original ESPHome web_server functionality preserved
- Embeds static HTML/CSS/JS assets directly into firmware as gzip-compressed byte arrays
- Serves files from flash memory (PROGMEM), so no LittleFS upload step is required
- Routes `/app/*` requests to the embedded dashboard and falls back to `index.html` for SPA routing
- Captive portal compatible — the ESPHome UI at `/` continues to work as before

## How It Works

Unlike the standard LittleFS approach, this component embeds static dashboard files while compiling the firmware:

1. Prepare or update the web assets under `webapp/` (the current dashboard uses native Preact + HTM modules).
2. Run `embed_static_files.py` to gzip the assets and regenerate `static_files.h/.cpp`.
3. Point `app_html_include` at the dashboard HTML (`webapp/index.html`) so the base page is bundled.
4. Build the firmware — the assets are linked into flash and served straight from PROGMEM.

## Usage

The component works exactly like the standard `web_server` component:

```yaml
web_server:
  port: 80
  version: 3
  include_internal: true
```

## Build Workflow

### 1. Update the dashboard assets

Edit the files in `webapp/` (`index.html`, `app.js`, `styles/app.css`, `components/`, `vendor/`, etc.). The dashboard now ships as native ES modules, so you can develop by opening `index.html` with any static file server—no bundler step is required.

### 2. Embed the static files

From the repository root run:

```bash
python3 esphome/external_components/web_server/embed_static_files.py \
  webapp \
  esphome/external_components/web_server/static_files.h \
  esphome/external_components/web_server/static_files.cpp \
  app
```

The optional fourth argument controls the URL prefix; using `app` keeps all assets available under `/app/*`, matching the paths referenced in `index.html`.

### 3. Compile and upload

```bash
source ~/dev/esphome/.venv/bin/activate
esphome run openshrooly.yaml
```

## Why Not LittleFS?

This approach embeds files in firmware instead of using LittleFS because:

- **Simpler deployment**: Single firmware file contains everything
- **No separate upload step**: No need to upload filesystem image
- **Better compression**: Files are gzip-compressed at build time
- **Efficient storage**: PROGMEM stores data in flash, preserving RAM
- **Reliable updates**: OTA updates include web interface changes

## Captive Portal

The captive portal continues to work as normal. The root path `/` still serves the ESPHome web interface, while `/app/*` serves your Next.js application.

- `/` - ESPHome web interface (captive portal redirects here)
- `/app/` - The embedded dashboard
- All other ESPHome API endpoints remain functional
