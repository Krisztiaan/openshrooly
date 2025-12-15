// @ts-nocheck

import { formatSinceShort } from "../lib/format.js";

/**
 * @typedef {Object} SensorSnapshot
 * @property {boolean} hasValue
 * @property {string | null} value
 * @property {string | null} [detail]
 */

/**
 * @typedef {Object} ControlSnapshot
 * @property {boolean} isActive
 * @property {boolean} isAvailable
 * @property {string} [detail]
 */

const sensorSelectors = {
  temperature: "[data-sensor=\"temperature\"]",
  humidity: "[data-sensor=\"humidity\"]",
  "ambient-light": "[data-sensor=\"ambient-light\"]",
  reservoir: "[data-sensor=\"reservoir\"]",
};

const controlSelectors = {
  humidifier: "[data-control=\"humidifier\"]",
  "air-exchange": "[data-control=\"air-exchange\"]",
  "heat-guard": "[data-control=\"heat-guard\"]",
  lighting: "[data-control=\"lighting\"]",
};

const cache = {
  sensors: new Map(),
  controls: new Map(),
};

const getSensorNode = (id) => {
  if (!cache.sensors.has(id)) {
    const selector = sensorSelectors[id];
    cache.sensors.set(id, selector ? document.querySelector(selector) : null);
  }
  return cache.sensors.get(id);
};

const getControlNode = (id) => {
  if (!cache.controls.has(id)) {
    const selector = controlSelectors[id];
    cache.controls.set(id, selector ? document.querySelector(selector) : null);
  }
  return cache.controls.get(id);
};

const setText = (element, text) => {
  if (!element) return;
  if (text == null || text === "") {
    element.textContent = "";
  } else {
    element.textContent = text;
  }
};

const noResponseMessage = (lastUpdate) => {
  if (!lastUpdate) return "No Response";
  const since = formatSinceShort(lastUpdate);
  return since ? `No Response ${since}` : "No Response";
};

/**
 * Synchronise live sensor/control data into the overview strip.
 * @param {Object} params
 * @param {Record<string, SensorSnapshot>} params.sensors
 * @param {Record<string, ControlSnapshot>} params.controls
 * @param {boolean} params.offline
 * @param {boolean} params.controlsDisabled
 * @param {Date | null} params.lastUpdate
 * @param {{ text: string, author?: string | null } | null} params.quote
 */
export function updateOverview({
  sensors = {},
  controls = {},
  offline,
  controlsDisabled,
  lastUpdate,
  quote,
}) {
  const noResponse = noResponseMessage(lastUpdate);

  Object.entries(sensors).forEach(([id, data]) => {
    const button = getSensorNode(id);
    if (!button) return;
    const available = !offline && data.hasValue;
    button.dataset.available = available ? "true" : "false";
    const shouldDisable = controlsDisabled && !available;
    button.toggleAttribute("disabled", shouldDisable);

    const valueEl = button.querySelector('[data-field="value"]');

    if (valueEl) {
      valueEl.dataset.state = available ? "available" : "unavailable";
      setText(valueEl, available && data.value ? data.value : noResponse);
    }
  });

  Object.entries(controls).forEach(([id, data]) => {
    const button = getControlNode(id);
    if (!button) return;
    const hasRecentData = data.isAvailable && Boolean(lastUpdate);
    const available = !offline && hasRecentData;
    const active = available && data.isActive;

    button.dataset.available = available ? "true" : "false";
    button.dataset.active = active ? "true" : "false";
    button.dataset.state = data.isActive ? "on" : "off";
    if (controlsDisabled) {
      button.setAttribute("disabled", "true");
    } else {
      button.removeAttribute("disabled");
    }

    const detailEl = button.querySelector('[data-field="detail"]');
    const detailText = available && data.detail ? data.detail : noResponse;
    setText(detailEl, detailText);
  });

  const quoteRoot = document.querySelector("[data-quote]");
  if (quoteRoot) {
    if (quote && quote.text) {
      quoteRoot.hidden = false;
      const textEl = quoteRoot.querySelector("[data-quote-text]");
      const authorEl = quoteRoot.querySelector("[data-quote-author]");
      setText(textEl, `“${quote.text}”`);
      if (authorEl) {
        setText(authorEl, quote.author ? `— ${quote.author}` : "");
      }
    } else {
      quoteRoot.hidden = true;
    }
  }
}
