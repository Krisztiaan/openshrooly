import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";
import { ToggleSwitch } from "../toggle-switch.js";

const html = htm.bind(h);

export function TemperatureModal({
  viewOnlyNotice,
  controlsDisabled,
  tempControlEnabled,
  tempTarget,
  tempHysteresis,
  tempWarningMin,
  tempWarningMax,
  ventHoldMinutes,
  onToggleControl,
  onChangeNumber,
}) {
  return html`
    ${viewOnlyNotice}
    <div className="toggle-row">
      <${ToggleSwitch}
        checked=${tempControlEnabled}
        disabled=${controlsDisabled}
        ariaLabel="Toggle temperature guard"
        onChange=${onToggleControl}
      />
      <span className="toggle-row-copy">
        Maintain ${tempTarget.toFixed(1)}°C ± ${tempHysteresis.toFixed(1)}°C
      </span>
    </div>
    <div className="input-grid">
      <div className="input-group">
        <label for="tempTarget">Target (°C)</label>
        <input
          id="tempTarget"
          type="number"
          min="10"
          max="35"
          step="0.5"
          value=${tempTarget}
          disabled=${controlsDisabled}
          onInput=${(event) =>
            onChangeNumber("temperature__target", event.target.value)}
        />
      </div>
      <div className="input-group">
        <label for="tempHysteresis">Hysteresis (°C)</label>
        <input
          id="tempHysteresis"
          type="number"
          min="0.5"
          max="5"
          step="0.5"
          value=${tempHysteresis}
          disabled=${controlsDisabled}
          onInput=${(event) =>
            onChangeNumber("temperature__hysteresis", event.target.value)}
        />
      </div>
      <div className="input-group">
        <label for="tempWarningMin">Warning minimum (°C)</label>
        <input
          id="tempWarningMin"
          type="number"
          min="5"
          max="25"
          step="0.5"
          value=${tempWarningMin}
          disabled=${controlsDisabled}
          onInput=${(event) =>
            onChangeNumber("temperature__warning_minimum", event.target.value)}
        />
      </div>
      <div className="input-group">
        <label for="tempWarningMax">Warning maximum (°C)</label>
        <input
          id="tempWarningMax"
          type="number"
          min="15"
          max="40"
          step="0.5"
          value=${tempWarningMax}
          disabled=${controlsDisabled}
          onInput=${(event) =>
            onChangeNumber("temperature__warning_maximum", event.target.value)}
        />
      </div>
    </div>
    <div className="input-group">
      <label for="tempVentHold">Fan hold-off (minutes)</label>
      <input
        id="tempVentHold"
        type="number"
        min="1"
        max="15"
        step="1"
        value=${ventHoldMinutes}
        disabled=${controlsDisabled}
        onInput=${(event) =>
          onChangeNumber("temperature__vent_holdoff_minutes", event.target.value)}
      />
      <p className="field-hint">
        Prevents cold drafts from affecting readings immediately after venting.
      </p>
    </div>
  `;
}
