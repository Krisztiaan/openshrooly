# OpenShrooly ESPHome Development Instructions

## Building and Uploading After Web UI Changes

**IMPORTANT**: When you make changes to the web UI (webapp), you MUST follow these steps IN ORDER:

1. Make your changes in the static web dashboard (files under `/home/gxs/dev/openshrooly/webapp/`). No build step is required—the firmware consumes the source files directly.

2. **COMPILE** the ESPHome firmware (the build now auto-regenerates embedded assets):
```bash
source ~/dev/esphome/.venv/bin/activate && esphome compile openshrooly.yaml
```

3. Upload via OTA:
```bash
source ~/dev/esphome/.venv/bin/activate && esphome upload openshrooly.yaml --device openshrooly.local
```

**WARNING**: If you skip the compile step, the upload will use the OLD firmware without your new web UI changes!

## Compiling the Project (ESPHome changes only)

Before compiling, activate the ESPHome virtual environment:

```bash
source ~/dev/esphome/.venv/bin/activate
```

Then compile the configuration:

```bash
esphome compile openshrooly.yaml
```

## Project Overview

OpenShrooly is an ESPHome-based mushroom growing environment controller with:
- Temperature and humidity monitoring
- Air exchange control
- Humidifier control
- Light control
- E-paper display with LVGL interface
- 4 touch buttons for UI navigation
- Web interface (static HTM + Preact modules embedded in firmware)
- Home Assistant integration

## Key Components

- **Main config**: `openshrooly.yaml`
- **Components**: Located in `components/` directory
- **Scripts**: Located in `scripts/` directory
- **External components**: Located in `external_components/` directory
- **Web UI**: Located in `/home/gxs/dev/openshrooly/webapp/` (HTM + Preact modules served as static files)
