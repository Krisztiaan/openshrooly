// @ts-nocheck

const CONTROL_IDS = ["humidity", "temperature", "air", "light", "water"];

const VIEWONLY_TEXT =
  "Device offline — controls stay read-only until connectivity returns.";

function setText(node, value) {
  if (!node) return;
  node.textContent = value ?? "";
}

function setHidden(node, hidden) {
  if (!node) return;
  node.hidden = hidden;
}

function setDisabled(element, disabled) {
  if (!element) return;
  element.disabled = disabled;
}

function showDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (dialog.open) dialog.close();
  dialog.removeAttribute("open");
}

function isDialogBackdropClick(dialog, event) {
  if (!dialog) return false;
  if (event.target !== dialog) return false;
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

function bindHumidity(callbacks) {
  const { onNumberChange, onClose } = callbacks;
  const dialog = document.querySelector('[data-control-dialog="humidity"]');
  if (!dialog) return null;

  const viewOnly = dialog.querySelector('[data-control-viewonly="humidity"]');
  const targetInput = dialog.querySelector('[data-control-input="target_humidity"]');
  const hysteresisInput = dialog.querySelector('[data-control-input="humidity__hysteresis"]');
  const speedInput = dialog.querySelector('[data-control-input="humidifier__speed"]');
  const speedDisplay = dialog.querySelector('[data-control-display="humidifier__speed"]');
  const presetButtons = Array.from(dialog.querySelectorAll('[data-control-preset]'));
  const closeButton = dialog.querySelector('[data-control-close="humidity"]');

  const listeners = [];

  const handleClose = () => {
    closeDialog(dialog);
    onClose?.("humidity");
  };

  if (closeButton) {
    const handler = (event) => {
      event.preventDefault();
      handleClose();
    };
    closeButton.addEventListener("click", handler);
    listeners.push(() => closeButton.removeEventListener("click", handler));
  }

  const cancelHandler = (event) => {
    event.preventDefault();
    handleClose();
  };
  dialog.addEventListener("cancel", cancelHandler);
  listeners.push(() => dialog.removeEventListener("cancel", cancelHandler));

  const backdropHandler = (event) => {
    if (isDialogBackdropClick(dialog, event)) handleClose();
  };
  dialog.addEventListener("click", backdropHandler);
  listeners.push(() => dialog.removeEventListener("click", backdropHandler));

  if (targetInput) {
    const handler = (event) => onNumberChange?.("target_humidity", event.currentTarget.value);
    targetInput.addEventListener("input", handler);
    listeners.push(() => targetInput.removeEventListener("input", handler));
  }
  if (hysteresisInput) {
    const handler = (event) =>
      onNumberChange?.("humidity__hysteresis", event.currentTarget.value);
    hysteresisInput.addEventListener("input", handler);
    listeners.push(() => hysteresisInput.removeEventListener("input", handler));
  }
  if (speedInput) {
    const handler = (event) => onNumberChange?.("humidifier__speed", event.currentTarget.value);
    speedInput.addEventListener("input", handler);
    listeners.push(() => speedInput.removeEventListener("input", handler));
  }
  presetButtons.forEach((button) => {
    const handler = (event) => {
      event.preventDefault();
      const target = button.dataset.target;
      const hysteresis = button.dataset.hysteresis;
      if (target !== undefined) onNumberChange?.("target_humidity", target);
      if (hysteresis !== undefined) onNumberChange?.("humidity__hysteresis", hysteresis);
    };
    button.addEventListener("click", handler);
    listeners.push(() => button.removeEventListener("click", handler));
  });

  return {
    show: () => showDialog(dialog),
    close: handleClose,
    update({ controlsDisabled, viewOnlyMessage, values }) {
      setHidden(viewOnly, !(controlsDisabled && viewOnlyMessage));
      if (controlsDisabled && viewOnlyMessage && viewOnly) {
        setText(viewOnly, viewOnlyMessage);
      }
      setDisabled(targetInput, controlsDisabled);
      setDisabled(hysteresisInput, controlsDisabled);
      setDisabled(speedInput, controlsDisabled);
      presetButtons.forEach((button) => setDisabled(button, controlsDisabled));

      if (targetInput && values?.targetHumidity !== undefined) {
        targetInput.value = values.targetHumidity;
      }
      if (hysteresisInput && values?.humidityHysteresis !== undefined) {
        hysteresisInput.value = values.humidityHysteresis;
      }
      if (speedInput && values?.humidifierSpeed !== undefined) {
        speedInput.value = values.humidifierSpeed;
        if (speedDisplay) {
          const displayValue = Number.isFinite(Number(values.humidifierSpeed))
            ? `${Math.round(Number(values.humidifierSpeed))}%`
            : "--";
          setText(speedDisplay, displayValue);
        }
      } else if (speedDisplay) {
        setText(speedDisplay, "--");
      }
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}

function bindTemperature(callbacks) {
  const { onNumberChange, onSwitchChange, onClose } = callbacks;
  const dialog = document.querySelector('[data-control-dialog="temperature"]');
  if (!dialog) return null;

  const viewOnly = dialog.querySelector('[data-control-viewonly="temperature"]');
  const targetInput = dialog.querySelector('[data-control-input="temperature__target"]');
  const hysteresisInput = dialog.querySelector('[data-control-input="temperature__hysteresis"]');
  const warningMinInput = dialog.querySelector(
    '[data-control-input="temperature__warning_minimum"]'
  );
  const warningMaxInput = dialog.querySelector(
    '[data-control-input="temperature__warning_maximum"]'
  );
  const ventHoldInput = dialog.querySelector(
    '[data-control-input="temperature__vent_holdoff_minutes"]'
  );
  const toggle = dialog.querySelector('[data-control-switch="temperature_control_enabled"]');
  const summary = dialog.querySelector('[data-control-temperature-summary]');
  const closeButton = dialog.querySelector('[data-control-close="temperature"]');

  const listeners = [];

  const handleClose = () => {
    closeDialog(dialog);
    onClose?.("temperature");
  };

  if (closeButton) {
    const handler = (event) => {
      event.preventDefault();
      handleClose();
    };
    closeButton.addEventListener("click", handler);
    listeners.push(() => closeButton.removeEventListener("click", handler));
  }

  const cancelHandler = (event) => {
    event.preventDefault();
    handleClose();
  };
  dialog.addEventListener("cancel", cancelHandler);
  listeners.push(() => dialog.removeEventListener("cancel", cancelHandler));

  const backdropHandler = (event) => {
    if (isDialogBackdropClick(dialog, event)) handleClose();
  };
  dialog.addEventListener("click", backdropHandler);
  listeners.push(() => dialog.removeEventListener("click", backdropHandler));

  const bindNumber = (input, id) => {
    if (!input) return;
    const handler = (event) => onNumberChange?.(id, event.currentTarget.value);
    input.addEventListener("input", handler);
    listeners.push(() => input.removeEventListener("input", handler));
  };

  bindNumber(targetInput, "temperature__target");
  bindNumber(hysteresisInput, "temperature__hysteresis");
  bindNumber(warningMinInput, "temperature__warning_minimum");
  bindNumber(warningMaxInput, "temperature__warning_maximum");
  bindNumber(ventHoldInput, "temperature__vent_holdoff_minutes");

  if (toggle) {
    const handler = (event) =>
      onSwitchChange?.("temperature_control_enabled", event.currentTarget.checked);
    toggle.addEventListener("change", handler);
    listeners.push(() => toggle.removeEventListener("change", handler));
  }

  return {
    show: () => showDialog(dialog),
    close: handleClose,
    update({ controlsDisabled, viewOnlyMessage, values }) {
      setHidden(viewOnly, !(controlsDisabled && viewOnlyMessage));
      if (controlsDisabled && viewOnlyMessage && viewOnly) {
        setText(viewOnly, viewOnlyMessage);
      }
      [
        targetInput,
        hysteresisInput,
        warningMinInput,
        warningMaxInput,
        ventHoldInput,
      ].forEach((input) => setDisabled(input, controlsDisabled));
      if (toggle) {
        setDisabled(toggle, controlsDisabled);
      }

      if (targetInput && values?.tempTarget !== undefined) {
        targetInput.value = values.tempTarget;
      }
      if (hysteresisInput && values?.tempHysteresis !== undefined) {
        hysteresisInput.value = values.tempHysteresis;
      }
      if (warningMinInput && values?.tempWarningMin !== undefined) {
        warningMinInput.value = values.tempWarningMin;
      }
      if (warningMaxInput && values?.tempWarningMax !== undefined) {
        warningMaxInput.value = values.tempWarningMax;
      }
      if (ventHoldInput && values?.ventHoldMinutes !== undefined) {
        ventHoldInput.value = values.ventHoldMinutes;
      }
      if (toggle && values?.tempControlEnabled !== undefined) {
        toggle.checked = Boolean(values.tempControlEnabled);
      }
      if (summary && values?.tempTarget !== undefined && values?.tempHysteresis !== undefined) {
        const min = (Number(values.tempTarget) - Number(values.tempHysteresis)).toFixed(1);
        const max = (Number(values.tempTarget) + Number(values.tempHysteresis)).toFixed(1);
        summary.textContent = `Maintain ${min}°C – ${max}°C`;
      }
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}

function bindAir(callbacks) {
  const { onNumberChange, onClose } = callbacks;
  const dialog = document.querySelector('[data-control-dialog="air"]');
  if (!dialog) return null;

  const viewOnly = dialog.querySelector('[data-control-viewonly="air"]');
  const inputs = Array.from(dialog.querySelectorAll('[data-control-input]'));
  const closeButton = dialog.querySelector('[data-control-close="air"]');

  const listeners = [];
  const handleClose = () => {
    closeDialog(dialog);
    onClose?.("air");
  };

  if (closeButton) {
    const handler = (event) => {
      event.preventDefault();
      handleClose();
    };
    closeButton.addEventListener("click", handler);
    listeners.push(() => closeButton.removeEventListener("click", handler));
  }

  const cancelHandler = (event) => {
    event.preventDefault();
    handleClose();
  };
  dialog.addEventListener("cancel", cancelHandler);
  listeners.push(() => dialog.removeEventListener("cancel", cancelHandler));

  const backdropHandler = (event) => {
    if (isDialogBackdropClick(dialog, event)) handleClose();
  };
  dialog.addEventListener("click", backdropHandler);
  listeners.push(() => dialog.removeEventListener("click", backdropHandler));
  inputs.forEach((input) => {
    const handler = (event) => onNumberChange?.(event.currentTarget.dataset.controlInput, event.currentTarget.value);
    input.addEventListener("input", handler);
    listeners.push(() => input.removeEventListener("input", handler));
  });

  return {
    show: () => showDialog(dialog),
    close: handleClose,
    update({ controlsDisabled, viewOnlyMessage, values }) {
      setHidden(viewOnly, !(controlsDisabled && viewOnlyMessage));
      if (controlsDisabled && viewOnlyMessage && viewOnly) {
        setText(viewOnly, viewOnlyMessage);
      }
      inputs.forEach((input) => {
        setDisabled(input, controlsDisabled);
        const id = input.dataset.controlInput;
        if (id && values && values[id] !== undefined) {
          input.value = values[id];
        }
      });
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}

function bindLighting(callbacks) {
  const { onNumberChange, onSelectChange, onColorChange, onClose } = callbacks;
  const dialog = document.querySelector('[data-control-dialog="light"]');
  if (!dialog) return null;

  const viewOnly = dialog.querySelector('[data-control-viewonly="light"]');
  const sunriseSelect = dialog.querySelector('[data-control-select="lights__sunrise_hour"]');
  const durationInput = dialog.querySelector('[data-control-input="lights__duration__hours_"]');
  const luxInput = dialog.querySelector('[data-control-input="white_led_intensity"]');
  const colorInput = dialog.querySelector('[data-control-color]');
  const modeButtons = Array.from(dialog.querySelectorAll('[data-control-mode]'));
  const closeButton = dialog.querySelector('[data-control-close="light"]');

  const listeners = [];

  const handleClose = () => {
    closeDialog(dialog);
    onClose?.("light");
  };

  if (closeButton) {
    const handler = (event) => {
      event.preventDefault();
      handleClose();
    };
    closeButton.addEventListener("click", handler);
    listeners.push(() => closeButton.removeEventListener("click", handler));
  }

  const cancelHandler = (event) => {
    event.preventDefault();
    handleClose();
  };
  dialog.addEventListener("cancel", cancelHandler);
  listeners.push(() => dialog.removeEventListener("cancel", cancelHandler));

  const backdropHandler = (event) => {
    if (isDialogBackdropClick(dialog, event)) handleClose();
  };
  dialog.addEventListener("click", backdropHandler);
  listeners.push(() => dialog.removeEventListener("click", backdropHandler));

  if (sunriseSelect && !sunriseSelect.options.length) {
    for (let i = 0; i < 48; i += 1) {
      const value = (i * 0.5).toFixed(1).replace(/\.0$/, "");
      const date = new Date(0, 0, 0, 0);
      date.setMinutes(Number(value) * 60);
      const option = document.createElement("option");
      option.value = value;
      option.textContent = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      sunriseSelect.appendChild(option);
    }
  }

  const sunriseHandler = (event) =>
    onNumberChange?.("lights__sunrise_hour", event.currentTarget.value);
  if (sunriseSelect) {
    sunriseSelect.addEventListener("change", sunriseHandler);
    listeners.push(() => sunriseSelect.removeEventListener("change", sunriseHandler));
  }

  const durationHandler = (event) =>
    onNumberChange?.("lights__duration__hours_", event.currentTarget.value);
  if (durationInput) {
    durationInput.addEventListener("input", durationHandler);
    listeners.push(() => durationInput.removeEventListener("input", durationHandler));
  }

  const luxHandler = (event) =>
    onNumberChange?.("white_led_intensity", event.currentTarget.value);
  if (luxInput) {
    luxInput.addEventListener("input", luxHandler);
    listeners.push(() => luxInput.removeEventListener("input", luxHandler));
  }

  if (colorInput) {
    const handler = (event) => onColorChange?.(event.currentTarget.value);
    colorInput.addEventListener("input", handler);
    listeners.push(() => colorInput.removeEventListener("input", handler));
  }

  modeButtons.forEach((button) => {
    const handler = (event) => {
      event.preventDefault();
      const value = button.dataset.value;
      if (value !== undefined) onSelectChange?.("lighting_mode", value);
    };
    button.addEventListener("click", handler);
    listeners.push(() => button.removeEventListener("click", handler));
  });

  return {
    show: () => showDialog(dialog),
    close: handleClose,
    update({ controlsDisabled, viewOnlyMessage, values }) {
      setHidden(viewOnly, !(controlsDisabled && viewOnlyMessage));
      if (controlsDisabled && viewOnlyMessage && viewOnly) {
        setText(viewOnly, viewOnlyMessage);
      }
      setDisabled(sunriseSelect, controlsDisabled);
      setDisabled(durationInput, controlsDisabled);
      setDisabled(luxInput, controlsDisabled);
      setDisabled(colorInput, controlsDisabled);
      modeButtons.forEach((button) => setDisabled(button, controlsDisabled));

      if (sunriseSelect && values?.lightsSunrise !== undefined) {
        sunriseSelect.value = String(values.lightsSunrise);
      }
      if (durationInput && values?.lightsDuration !== undefined) {
        durationInput.value = values.lightsDuration;
      }
      if (luxInput && values?.luxValue !== undefined) {
        luxInput.value = values.luxValue;
      }
      if (colorInput && values?.currentColor !== undefined) {
        colorInput.value = values.currentColor;
      }
      if (modeButtons.length && values?.lightsMode !== undefined) {
        modeButtons.forEach((button) => {
          const active = button.dataset.value === values.lightsMode;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}

function bindWater(callbacks) {
  const { onCalibrate, onClose } = callbacks;
  const dialog = document.querySelector('[data-control-dialog="water"]');
  if (!dialog) return null;

  const viewOnly = dialog.querySelector('[data-control-viewonly="water"]');
  const statusNode = dialog.querySelector('[data-control-water-status]');
  const successNode = dialog.querySelector('[data-control-water-success]');
  const button = dialog.querySelector('[data-control-action="calibrate_water"]');
  const closeButton = dialog.querySelector('[data-control-close="water"]');

  const listeners = [];
  const handleClose = () => {
    closeDialog(dialog);
    onClose?.("water");
  };

  if (closeButton) {
    const handler = (event) => {
      event.preventDefault();
      handleClose();
    };
    closeButton.addEventListener("click", handler);
    listeners.push(() => closeButton.removeEventListener("click", handler));
  }

  const cancelHandler = (event) => {
    event.preventDefault();
    handleClose();
  };
  dialog.addEventListener("cancel", cancelHandler);
  listeners.push(() => dialog.removeEventListener("cancel", cancelHandler));

  const backdropHandler = (event) => {
    if (isDialogBackdropClick(dialog, event)) handleClose();
  };
  dialog.addEventListener("click", backdropHandler);
  listeners.push(() => dialog.removeEventListener("click", backdropHandler));
  if (button) {
    const handler = (event) => {
      event.preventDefault();
      onCalibrate?.();
    };
    button.addEventListener("click", handler);
    listeners.push(() => button.removeEventListener("click", handler));
  }

  return {
    show: () => showDialog(dialog),
    close: handleClose,
    update({ controlsDisabled, viewOnlyMessage, values }) {
      setHidden(viewOnly, !(controlsDisabled && viewOnlyMessage));
      if (controlsDisabled && viewOnlyMessage && viewOnly) {
        setText(viewOnly, viewOnlyMessage);
      }
      setDisabled(button, controlsDisabled);

      if (values) {
        const { calibrationStatus, calibrationSuccess, reservoirCalibrated } = values;
        if (successNode) {
          setHidden(successNode, !calibrationSuccess);
        }
        if (statusNode) {
          const message = calibrationSuccess
            ? "Calibration request sent."
            : calibrationStatus || (reservoirCalibrated ? "Calibrated recently." : "Tap to calibrate");
          setHidden(statusNode, !message);
          if (message) setText(statusNode, message);
        }
      }
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}

/**
 * Attach behaviour to control dialogs and return an imperative API.
 * @param {Object} callbacks
 * @param {(id: string, value: string) => void} callbacks.onNumberChange
 * @param {(id: string, value: boolean) => void} [callbacks.onSwitchChange]
 * @param {(id: string, value: string) => void} [callbacks.onSelectChange]
 * @param {(value: string) => void} [callbacks.onColorChange]
 * @param {() => void} [callbacks.onCalibrate]
 * @param {(id: string) => void} [callbacks.onClose]
 */
export function setupControlModals(callbacks) {
  const contexts = {
    humidity: bindHumidity(callbacks),
    temperature: bindTemperature(callbacks),
    air: bindAir(callbacks),
    light: bindLighting(callbacks),
    water: bindWater(callbacks),
  };

  const show = (id) => {
    const ctx = contexts[id];
    if (ctx) ctx.show();
  };

  const close = (id) => {
    const ctx = contexts[id];
    if (ctx) ctx.close();
  };

  return {
    show,
    close,
    update({ controlsDisabled = false, viewOnlyMessage = VIEWONLY_TEXT, humidity = {}, temperature = {}, air = {}, lighting = {}, water = {} }) {
      contexts.humidity?.update({
        controlsDisabled,
        viewOnlyMessage,
        values: {
          targetHumidity: humidity.targetHumidity,
          humidityHysteresis: humidity.humidityHysteresis,
          humidifierSpeed: humidity.humidifierSpeed,
        },
      });
      contexts.temperature?.update({
        controlsDisabled,
        viewOnlyMessage,
        values: {
          tempTarget: temperature.tempTarget,
          tempHysteresis: temperature.tempHysteresis,
          tempWarningMin: temperature.tempWarningMin,
          tempWarningMax: temperature.tempWarningMax,
          ventHoldMinutes: temperature.ventHoldMinutes,
          tempControlEnabled: temperature.tempControlEnabled,
        },
      });
      contexts.air?.update({
        controlsDisabled,
        viewOnlyMessage,
        values: {
          air_exchange__cycle_minutes: air.airExchangePeriod,
          air_exchange__run_minutes: air.airExchangeDuration,
          air_exchange__target_rpm: air.fanTargetRpm,
          air_exchange__holdoff_minutes: air.airExchangeHoldoff,
          air_exchange__boost_threshold: air.airExchangeBoost,
        },
      });
      contexts.light?.update({
        controlsDisabled,
        viewOnlyMessage,
        values: {
          lightsMode: lighting.lightsMode,
          lightsSunrise: lighting.lightsSunrise,
          lightsDuration: lighting.lightsDuration,
          luxValue: lighting.luxValue,
          currentColor: lighting.currentColor,
        },
      });
      contexts.water?.update({
        controlsDisabled,
        viewOnlyMessage,
        values: {
          calibrationStatus: water.calibrationStatus,
          calibrationSuccess: water.calibrationSuccess,
          reservoirCalibrated: water.reservoirCalibrated,
        },
      });
    },
    destroy() {
      CONTROL_IDS.forEach((id) => {
        const ctx = contexts[id];
        ctx?.destroy?.();
      });
    },
  };
}
