import { h } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";
import { SettingsRow } from "./settings-row.js";
import { ModalSheet } from "./modal-sheet.js";
import { ToggleSwitch } from "./toggle-switch.js";

const html = htm.bind(h);

export function DeviceSettingsSheet({
  open,
  onClose,
  controlsDisabled,
  viewOnlyNotice,
  timezoneShortLabel,
  timezoneGroups,
  timezone,
  onTimezoneChange,
  lastSnapshot,
  voltageDisplay,
  fanSpeedDisplay,
  wifiMode,
  wifiSSID,
  ipAddress,
  bleEnabled,
  onToggleBle,
  onOpenFirmware,
  onCalibrate,
  onManageTrusted,
  calibrationStatus,
  calibrationSuccess,
}) {
  const openTimezonePicker = (event) => {
    if (controlsDisabled) return;
    const selectEl = event.currentTarget.querySelector(
      "select.settings-select-native"
    );
    if (!selectEl) return;
    if (typeof selectEl.showPicker === "function") {
      selectEl.showPicker();
      return;
    }
    selectEl.focus({ preventScroll: true });
    const clickEvent = new MouseEvent("click", {
      view: window,
      bubbles: true,
      cancelable: true,
    });
    selectEl.dispatchEvent(clickEvent);
  };

  return html`
    <${ModalSheet} open=${open} title="Settings" onClose=${onClose}>
      ${controlsDisabled ? viewOnlyNotice : null}
      <section className="settings-group" aria-labelledby="settings-group-system">
        <header className="settings-group__header">
          <h2 id="settings-group-system" className="settings-group__title">
            System
          </h2>
          <p className="settings-group__detail">Core configuration</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:toolbox"
            title="Device"
            hint="Fixed hardware target"
            value="OpenShrooly"
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:globe-with-meridians"
            title="Timezone"
            hint="Align schedules to your locale"
            className="settings-row--select"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${openTimezonePicker}
          >
            <span className="settings-row-value">${timezoneShortLabel}</span>
            <select
              className="settings-select-native"
              value=${timezone}
              disabled=${controlsDisabled}
              aria-label="Select timezone"
              onChange=${(event) => onTimezoneChange(event.target.value)}
            >
              ${timezoneGroups.map(
                (group) => html`<optgroup label=${group.label}>
                  ${group.options.map(
                    (option) => html`<option value=${option.value}>
                      ${option.label}
                    </option>`
                  )}
                </optgroup>`
              )}
            </select>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:calendar"
            title="Last snapshot"
            value=${lastSnapshot}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:battery"
            title="Input voltage"
            value=${voltageDisplay}
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-group-network">
        <header className="settings-group__header">
          <h2 id="settings-group-network" className="settings-group__title">
            Network
          </h2>
          <p className="settings-group__detail">Connection details</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:antenna-bars"
            title="Wi‑Fi"
            hint=${wifiMode}
            value=${wifiSSID}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:desktop-computer"
            title="IP address"
            value=${ipAddress}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:leaf-fluttering-in-wind"
            title="Fan speed"
            value=${fanSpeedDisplay}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:globe-showing-europe-africa"
            title="Remote connection"
            hint="Bridge data via relay"
            value="Coming soon"
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-group-maintenance">
        <header className="settings-group__header">
          <h2 id="settings-group-maintenance" className="settings-group__title">
            Maintenance
          </h2>
          <p className="settings-group__detail">Keep things healthy</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:gear"
            title="Firmware update"
            hint="Upload ESPHome binary"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${onOpenFirmware}
          >
            <span className="settings-row-value action">Open</span>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:satellite-antenna"
            title="BLE service"
            hint="Expose sensors and controls over BLE"
          >
            <${ToggleSwitch}
              checked=${bleEnabled}
              disabled=${controlsDisabled}
              ariaLabel="Toggle BLE service"
              onChange=${(value) => onToggleBle(value)}
            />
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:test-tube"
            title="Calibrate reservoir"
            hint="Request a fresh dry-tank calibration"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${onCalibrate}
          >
            <span className="settings-row-value action">Start</span>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:handshake"
            title="Trusted BLE devices"
            hint="Pair or forget clients"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${onManageTrusted}
          >
            <span className="settings-row-value action">Manage</span>
          </${SettingsRow}>
        </div>
      </section>

      ${calibrationSuccess
        ? html`<div className="info-banner positive">
            Calibration request sent.
          </div>`
        : calibrationStatus
        ? html`<div className="info-banner calm">
            ${calibrationStatus}
          </div>`
        : null}
    </${ModalSheet}>
  `;
}
