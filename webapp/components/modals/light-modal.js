import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";
import { formatTime } from "../../lib/format.js";

const html = htm.bind(h);

export function LightModal({
  viewOnlyNotice,
  controlsDisabled,
  lightsMode,
  lightsSunrise,
  lightsDuration,
  luxValue,
  currentColor,
  onSelectMode,
  onChangeNumber,
  onChangeColor,
}) {
  const modes = [
    { label: "Daylight", value: "daylight" },
    { label: "Evening glow", value: "evening" },
    { label: "Sleep", value: "sleep" },
  ];

  return html`
    ${viewOnlyNotice}
    <div className="input-group">
      <label>Lighting mode</label>
      <div className="chip-row">
        ${modes.map(
          (option) => html`
            <button
              className=${`chip-button ${lightsMode === option.value ? "active" : ""}`}
              disabled=${controlsDisabled}
              onClick=${() => onSelectMode(option.value)}
            >
              ${option.label}
            </button>`
        )}
      </div>
    </div>
    <div className="input-group">
      <label for="sunriseSelect">Sunrise</label>
      <select
        id="sunriseSelect"
        value=${lightsSunrise}
        disabled=${controlsDisabled}
        onChange=${(event) => onChangeNumber("lights__sunrise_hour", event.target.value)}
      >
        ${Array.from({ length: 48 }, (_, index) => index * 0.5).map(
          (value) => html`<option value=${value}>${formatTime(value)}</option>`
        )}
      </select>
    </div>
    <div className="input-group">
      <label for="lightDuration">Duration (hours)</label>
      <input
        id="lightDuration"
        type="number"
        min="1"
        max="24"
        step="0.25"
        value=${lightsDuration}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("lights__duration__hours_", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="canopyLux">Canopy brightness (lux)</label>
      <input
        id="canopyLux"
        type="number"
        min="0"
        max="4000"
        step="10"
        value=${luxValue}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("white_led_intensity", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="accentColor">Accent color</label>
      <input
        id="accentColor"
        type="color"
        value=${currentColor}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeColor(event.target.value)}
      />
    </div>
  `;
}
