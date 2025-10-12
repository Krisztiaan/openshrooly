import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";

const html = htm.bind(h);

export function AdvancedSettingsModal({
  viewOnlyNotice,
  controlsDisabled,
  voltageDisplay,
  lastSnapshot,
  fanSpeedDisplay,
  wifiMode,
  wifiSSID,
  ipAddress,
  licensesText,
  showLicense,
  onToggleLicense,
  otaFile,
  otaStatus,
  otaMessage,
  otaProgress,
  onSelectFirmware,
  onUploadFirmware,
  onResetFirmwareQueue,
}) {
  return html`
    ${viewOnlyNotice}
    <section className="settings-section">
      <h3>System</h3>
      <div className="info-grid">
        <div className="info-row">
          <span className="info-label">Input voltage</span>
          <span className="info-value">${voltageDisplay}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Last snapshot</span>
          <span className="info-value">${lastSnapshot}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Fan RPM</span>
          <span className="info-value">${fanSpeedDisplay}</span>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <h3>Network</h3>
      <div className="info-grid">
        <div className="info-row">
          <span className="info-label">Mode</span>
          <span className="info-value">${wifiMode}</span>
        </div>
        <div className="info-row">
          <span className="info-label">SSID</span>
          <span className="info-value">${wifiSSID}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Device IP</span>
          <span className="info-value">${ipAddress}</span>
        </div>
      </div>
    </section>
    <section className="settings-section">
      <h3>Licenses</h3>
      <div className="input-group">
        <label>Open-source notices</label>
        <button className="chip-button" onClick=${onToggleLicense}>
          ${showLicense ? "Hide licenses" : "Show licenses"}
        </button>
        ${showLicense
          ? html`<pre className="license-log">${licensesText}</pre>`
          : null}
      </div>
    </section>
    <section className="settings-section">
      <h3>Firmware update (OTA)</h3>
      <div className="input-group">
        <input
          type="file"
          accept=".bin"
          disabled=${controlsDisabled || otaStatus === "uploading"}
          onChange=${(event) => {
            const file = event.target.files?.[0];
            if (file) onSelectFirmware(file);
          }}
        />
        ${otaFile
          ? html`<p className="file-helper">
              ${otaFile.name} · ${(otaFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>`
          : null}
        <div className="button-row">
          <button
            className="primary-button"
            disabled=${controlsDisabled || !otaFile || otaStatus === "uploading"}
            onClick=${onUploadFirmware}
          >
            ${otaStatus === "uploading" ? "Uploading…" : "Upload firmware"}
          </button>
          <button
            className="secondary-button"
            disabled=${controlsDisabled || otaStatus === "uploading"}
            onClick=${onResetFirmwareQueue}
          >
            Clear selection
          </button>
        </div>
        ${otaStatus !== "idle"
          ? html`<div className=${`ota-status ota-${otaStatus}`}>
              ${otaMessage}
              ${otaStatus === "uploading"
                ? html`<progress max="100" value=${otaProgress}></progress>`
                : null}
            </div>`
          : null}
      </div>
    </section>
  `;
}
