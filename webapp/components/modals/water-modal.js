import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";

const html = htm.bind(h);

export function WaterModal({
  viewOnlyNotice,
  controlsDisabled,
  calibrationStatus,
  calibrationSuccess,
  calibrated,
  onStartCalibration,
}) {
  return html`
    ${viewOnlyNotice}
    <p>
      Empty and dry the water reservoir, then start the calibration routine.
    </p>
    ${calibrationStatus
      ? html`<p className="field-note">Current status: ${calibrationStatus}</p>`
      : null}
    <button
      className="primary-button"
      disabled=${controlsDisabled}
      onClick=${onStartCalibration}
    >
      Calibrate empty reservoir
    </button>
    ${calibrationSuccess
      ? html`<div className="success-banner">Calibration request sent.</div>`
      : calibrated
      ? html`<div className="info-banner positive">
          Sensor calibrated recently.
        </div>`
      : html`<div className="info-banner warning">
          Calibration recommended for accurate readings.
        </div>`}
  `;
}
