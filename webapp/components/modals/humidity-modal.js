import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";

const html = htm.bind(h);

export function HumidityModal({
  viewOnlyNotice,
  controlsDisabled,
  targetHumidity,
  humidityHysteresis,
  humidifierSpeed,
  onChangeNumber,
  onApplyPreset,
}) {
  const presets = [
    { label: "Precision · 70% ±1%", target: 70, hysteresis: 1 },
    { label: "Balanced · 68% ±2%", target: 68, hysteresis: 2 },
    { label: "Eco · 65% ±3%", target: 65, hysteresis: 3 },
  ];

  return html`
    ${viewOnlyNotice}
    <div className="input-group">
      <label for="targetHumidity">Target humidity (%)</label>
      <input
        id="targetHumidity"
        type="number"
        min="60"
        max="95"
        step="0.5"
        value=${targetHumidity}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("target_humidity", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="humidityHysteresis">Hysteresis (± %)</label>
      <input
        id="humidityHysteresis"
        type="number"
        min="0"
        max="5"
        step="0.25"
        value=${humidityHysteresis}
        disabled=${controlsDisabled}
        onInput=${(event) =>
          onChangeNumber("humidity__hysteresis", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label>Presets</label>
      <div className="chip-row">
        ${presets.map(
          (preset) => html`
            <button
              className="chip-button"
              disabled=${controlsDisabled}
              onClick=${() => onApplyPreset(preset)}
            >
              ${preset.label}
            </button>
          `
        )}
      </div>
    </div>
    <div className="input-group">
      <label for="humidifierSpeed">
        Humidifier fan speed · ${humidifierSpeed.toFixed(0)}%
      </label>
      <input
        id="humidifierSpeed"
        type="range"
        min="40"
        max="100"
        step="5"
        value=${humidifierSpeed}
        disabled=${controlsDisabled}
        onInput=${(event) =>
          onChangeNumber("humidifier__speed", event.target.value)}
      />
      <p className="field-hint">
        Higher speeds add humidity faster but increase noise and water consumption.
      </p>
    </div>
  `;
}
