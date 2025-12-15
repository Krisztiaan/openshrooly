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

1. Update the dashboard source under `webapp/` (Svelte + Vite).
2. Build the dashboard into `webapp/dist` (`cd webapp && npm ci && npm run build`).
3. Compile the firmware — the PlatformIO pre-build hook regenerates `static_files.h/.cpp` from `webapp/dist` and links the gzip-compressed assets into flash (PROGMEM).

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

Edit the dashboard source in `webapp/` (Vite entry in `index.html`, components in `src/`, and static assets in `public/`).

### 2. Build the dashboard bundle

```bash
cd webapp
npm ci
npm run build
```

### 3. Compile and upload (auto-embeds dashboard assets)

```bash
source ~/dev/esphome/.venv/bin/activate
esphome run openshrooly.yaml
```

> **Tip:** The pre-build hook calls `embed_static_files.py` every time you compile. You can also run it manually if you want to regenerate the headers without compiling.

## Why Not LittleFS?

This approach embeds files in firmware instead of using LittleFS because:

- **Simpler deployment**: Single firmware file contains everything
- **No separate upload step**: No need to upload filesystem image
- **Better compression**: Files are gzip-compressed at build time
- **Efficient storage**: PROGMEM stores data in flash, preserving RAM
- **Reliable updates**: OTA updates include web interface changes

## Captive Portal

The captive portal continues to work as normal. The root path `/` still serves the ESPHome web interface, while `/app/*` serves the embedded dashboard.

- `/` - ESPHome web interface (captive portal redirects here)
- `/app/` - The embedded dashboard
- All other ESPHome API endpoints remain functional
