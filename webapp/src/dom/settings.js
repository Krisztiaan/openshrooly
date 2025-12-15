/** @typedef {(value: string) => void} TimezoneChange */

// @ts-nocheck

const cache = {};

const select = (selector) => document.querySelector(selector);

function qs(root, selector) {
  return root ? root.querySelector(selector) : null;
}

/**
 * Wire up the native settings dialog and expose control helpers.
 * @param {Object} params
 * @param {() => void} params.onClose
 * @param {() => void} params.onOpenFirmware
 * @param {(enabled: boolean) => void} params.onToggleBle
 * @param {() => void} params.onCalibrate
 * @param {() => void} params.onManageTrusted
 * @param {TimezoneChange} params.onTimezoneChange
 * @param {(file: File | null) => void} params.onOtaSelect
 * @param {() => void} params.onOtaUpload
 * @param {() => void} params.onOtaClear
 * @param {(id: string) => void} params.onOtaReleaseSelect
 * @param {() => void} params.onOtaReleaseLoad
 * @param {() => void} params.onOtaReleaseRefresh
 */
export function setupSettingsSheet({
  onClose,
  onOpenFirmware,
  onToggleBle,
  onCalibrate,
  onManageTrusted,
  onTimezoneChange,
  onOtaSelect,
  onOtaUpload,
  onOtaClear,
  onOtaReleaseSelect,
  onOtaReleaseLoad,
  onOtaReleaseRefresh,
}) {
  if (!cache.initialized) {
    cache.dialog = select("[data-settings-dialog]");
    cache.container = cache.dialog?.querySelector("[data-settings-container]");
    cache.closeButton = cache.dialog?.querySelector("[data-settings-close]");
    cache.timezoneButton = cache.dialog?.querySelector("[data-settings-timezone]");
    cache.timezoneSelect = cache.dialog?.querySelector("[data-settings-timezone-select]");
    cache.timezoneLabel = cache.dialog?.querySelector("[data-settings-timezone-label]");
    cache.viewOnly = cache.dialog?.querySelector("[data-settings-viewonly]");
    cache.lastSnapshot = cache.dialog?.querySelector("[data-settings-last-snapshot]");
    cache.voltage = cache.dialog?.querySelector("[data-settings-voltage]");
    cache.fan = cache.dialog?.querySelector("[data-settings-fan]");
    cache.wifiMode = cache.dialog?.querySelector("[data-settings-wifi-mode]");
    cache.wifiSsid = cache.dialog?.querySelector("[data-settings-wifi-ssid]");
    cache.ip = cache.dialog?.querySelector("[data-settings-ip]");
    cache.bleToggle = cache.dialog?.querySelector("[data-settings-ble-toggle]");
    cache.openFirmware = cache.dialog?.querySelector("[data-settings-open-firmware]");
    cache.calibrate = cache.dialog?.querySelector("[data-settings-calibrate]");
    cache.trusted = cache.dialog?.querySelector("[data-settings-trusted]");
    cache.calibrationSection = cache.dialog?.querySelector("[data-settings-calibration-status]");
    cache.calibrationMessage = cache.dialog?.querySelector("[data-settings-calibration-message]");
    cache.licenseToggle = cache.dialog?.querySelector("[data-settings-toggle-license]");
    cache.licenseContent = cache.dialog?.querySelector("[data-settings-license-content]");
    cache.otaFile = cache.dialog?.querySelector("[data-settings-ota-file]");
    cache.otaFileInfo = cache.dialog?.querySelector("[data-settings-ota-fileinfo]");
    cache.otaUpload = cache.dialog?.querySelector("[data-settings-ota-upload]");
    cache.otaClear = cache.dialog?.querySelector("[data-settings-ota-clear]");
    cache.otaStatus = cache.dialog?.querySelector("[data-settings-ota-status]");
    cache.otaMessage = cache.dialog?.querySelector("[data-settings-ota-message]");
    cache.otaProgress = cache.dialog?.querySelector("[data-settings-ota-progress]");
    cache.otaReleaseSelect = cache.dialog?.querySelector("[data-settings-ota-release]");
    cache.otaReleaseLoad = cache.dialog?.querySelector("[data-settings-ota-release-load]");
    cache.otaReleaseRefresh = cache.dialog?.querySelector("[data-settings-ota-release-refresh]");
    cache.otaReleaseStatus = cache.dialog?.querySelector("[data-settings-ota-release-status]");
    cache.otaReleaseError = cache.dialog?.querySelector("[data-settings-ota-release-error]");
    cache.otaCurrentVersion = cache.dialog?.querySelector("[data-settings-ota-current-version]");

    cache.closeButton?.addEventListener("click", () => onClose?.());
    cache.dialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      onClose?.();
    });
    cache.dialog?.addEventListener("click", (event) => {
      if (event.target === cache.dialog) onClose?.();
    });
    cache.timezoneButton?.addEventListener("click", () => {
      if (!cache.timezoneSelect) return;
      cache.timezoneSelect.disabled = cache.timezoneButton.dataset.disabled === "true";
      if (cache.timezoneSelect.disabled) return;
      if (typeof cache.timezoneSelect.showPicker === "function") {
        cache.timezoneSelect.showPicker();
      } else {
        cache.timezoneSelect.focus({ preventScroll: true });
        cache.timezoneSelect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    cache.timezoneSelect?.addEventListener("change", (event) => {
      onTimezoneChange?.(event.target.value);
    });
    cache.openFirmware?.addEventListener("click", () => onOpenFirmware?.());
    cache.calibrate?.addEventListener("click", () => onCalibrate?.());
    cache.trusted?.addEventListener("click", () => onManageTrusted?.());
    cache.bleToggle?.addEventListener("change", (event) => {
      onToggleBle?.(event.target.checked);
    });
    cache.licenseToggle?.addEventListener("click", () => {
      const expanded = cache.licenseContent?.hidden === false;
      if (cache.licenseContent) {
        cache.licenseContent.hidden = expanded;
      }
      if (cache.licenseToggle) {
        cache.licenseToggle.textContent = expanded ? "Show licenses" : "Hide licenses";
      }
    });
    cache.otaFile?.addEventListener("change", (event) => {
      const file = event.target.files?.[0] || null;
      onOtaSelect?.(file);
    });
    cache.otaUpload?.addEventListener("click", () => onOtaUpload?.());
    cache.otaClear?.addEventListener("click", () => onOtaClear?.());
    cache.otaReleaseSelect?.addEventListener("change", (event) => {
      onOtaReleaseSelect?.(event.target.value);
    });
    cache.otaReleaseLoad?.addEventListener("click", () => onOtaReleaseLoad?.());
    cache.otaReleaseRefresh?.addEventListener("click", () => onOtaReleaseRefresh?.());

    cache.initialized = true;
  }

  return {
    show: () => {
      if (!cache.dialog) return;
      if (typeof cache.dialog.showModal === "function") cache.dialog.showModal();
      else cache.dialog.setAttribute("open", "");
    },
    close: () => {
      if (!cache.dialog) return;
      if (cache.dialog.open) cache.dialog.close();
      cache.dialog.removeAttribute("open");
    },
    isOpen: () => Boolean(cache.dialog?.open),
    update(data) {
      if (!cache.dialog) return;
      const {
        controlsDisabled,
        timezoneLabel,
        timezoneOptions = [],
        timezoneValue,
        lastSnapshot,
        voltageDisplay,
        fanSpeedDisplay,
        wifiMode,
        wifiSSID,
        ipAddress,
        bleEnabled,
        calibrationStatus,
        calibrationSuccess,
        licenseText,
        firmwareVersion = '—',
        firmwareReleaseOptions = [],
        selectedFirmwareRelease = '',
        firmwareReleaseLoading = false,
        firmwareReleaseDownloading = false,
        firmwareReleaseError = '',
        firmwareReleaseStatus = '',
        otaFile,
        otaStatus,
        otaMessage,
        otaProgress,
      } = data;

      if (cache.viewOnly) cache.viewOnly.hidden = !controlsDisabled;

      if (cache.timezoneButton) cache.timezoneButton.dataset.disabled = controlsDisabled ? "true" : "false";
      if (cache.timezoneSelect) {
        cache.timezoneSelect.disabled = controlsDisabled;
        cache.timezoneSelect.innerHTML = timezoneOptions
          .map(
            (group) =>
              `<optgroup label="${group.label}">${group.options
                .map(
                  (option) =>
                    `<option value="${option.value}" ${option.value === timezoneValue ? "selected" : ""}>${option.label}</option>`
                )
                .join("")}</optgroup>`
          )
          .join("");
      }
      if (cache.timezoneLabel) cache.timezoneLabel.textContent = timezoneLabel || "—";
      if (cache.lastSnapshot) cache.lastSnapshot.textContent = lastSnapshot || "—";
      if (cache.voltage) cache.voltage.textContent = voltageDisplay || "—";
      if (cache.fan) cache.fan.textContent = fanSpeedDisplay || "—";
      if (cache.wifiMode) cache.wifiMode.textContent = wifiMode || "—";
      if (cache.wifiSsid) cache.wifiSsid.textContent = wifiSSID || "—";
      if (cache.ip) cache.ip.textContent = ipAddress || "—";
      if (cache.bleToggle) {
        cache.bleToggle.disabled = controlsDisabled;
        cache.bleToggle.checked = Boolean(bleEnabled);
      }
      if (cache.openFirmware) cache.openFirmware.disabled = controlsDisabled;
      if (cache.calibrate) cache.calibrate.disabled = controlsDisabled;
      if (cache.trusted) cache.trusted.disabled = controlsDisabled;

      if (cache.calibrationSection) {
        const message = calibrationSuccess
          ? "Calibration request sent."
          : calibrationStatus || "";
        cache.calibrationSection.hidden = !message;
        if (cache.calibrationMessage) cache.calibrationMessage.textContent = message;
      }

      if (cache.licenseContent) {
        cache.licenseContent.textContent = licenseText || "";
      }

      if (cache.otaCurrentVersion) {
        cache.otaCurrentVersion.textContent = firmwareVersion ? `Current firmware: ${firmwareVersion}` : '';
      }

      if (cache.otaFileInfo) {
        if (otaFile) {
          cache.otaFileInfo.hidden = false;
          cache.otaFileInfo.textContent = `${otaFile.name} · ${(otaFile.size / (1024 * 1024)).toFixed(2)} MB`;
        } else {
          cache.otaFileInfo.hidden = true;
          cache.otaFileInfo.textContent = "";
        }
      }
      if (cache.otaUpload) cache.otaUpload.disabled = controlsDisabled || !otaFile || otaStatus === "uploading";
      if (cache.otaClear) cache.otaClear.disabled = controlsDisabled || otaStatus === "uploading";
      if (cache.otaFile) cache.otaFile.disabled = controlsDisabled || otaStatus === "uploading";

      if (cache.otaReleaseSelect) {
        const selectEl = cache.otaReleaseSelect;
        const previousValue = selectEl.value;
        selectEl.innerHTML = '';

        if (Array.isArray(firmwareReleaseOptions) && firmwareReleaseOptions.length) {
          firmwareReleaseOptions.forEach((group) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            group.options.forEach((option) => {
              const optionEl = document.createElement('option');
              optionEl.value = option.id;
              optionEl.textContent = option.title;
              optgroup.appendChild(optionEl);
            });
            selectEl.appendChild(optgroup);
          });
          const desiredValue = selectedFirmwareRelease || previousValue;
          if (desiredValue) {
            selectEl.value = desiredValue;
          }
        } else {
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = firmwareReleaseLoading ? 'Loading releases…' : 'No releases available';
          selectEl.appendChild(placeholder);
          selectEl.value = '';
        }

        selectEl.disabled =
          controlsDisabled ||
          firmwareReleaseLoading ||
          !(Array.isArray(firmwareReleaseOptions) && firmwareReleaseOptions.length);
      }

      if (cache.otaReleaseLoad) {
        cache.otaReleaseLoad.disabled =
          controlsDisabled ||
          firmwareReleaseLoading ||
          firmwareReleaseDownloading ||
          !selectedFirmwareRelease;
      }

      if (cache.otaReleaseRefresh) {
        cache.otaReleaseRefresh.disabled = controlsDisabled || firmwareReleaseLoading;
      }

      if (cache.otaReleaseStatus) {
        const message = firmwareReleaseLoading
          ? 'Fetching releases from GitHub…'
          : firmwareReleaseStatus;
        cache.otaReleaseStatus.textContent = message || '';
        cache.otaReleaseStatus.hidden = !message;
      }

      if (cache.otaReleaseError) {
        if (firmwareReleaseError) {
          cache.otaReleaseError.textContent = firmwareReleaseError;
          cache.otaReleaseError.hidden = false;
        } else {
          cache.otaReleaseError.textContent = '';
          cache.otaReleaseError.hidden = true;
        }
      }

      if (cache.otaStatus) {
        const showStatus = otaStatus && otaStatus !== "idle";
        cache.otaStatus.hidden = !showStatus;
        if (showStatus && cache.otaMessage) cache.otaMessage.textContent = otaMessage || "";
        if (cache.otaProgress) {
          if (otaStatus === "uploading") {
            cache.otaProgress.hidden = false;
            cache.otaProgress.value = otaProgress ?? 0;
          } else {
            cache.otaProgress.hidden = true;
            cache.otaProgress.value = 0;
          }
        }
      }
    },
  };
}
