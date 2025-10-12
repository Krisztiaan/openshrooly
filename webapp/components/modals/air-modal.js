import { h } from "../../vendor/preact.module.js";
import htm from "../../vendor/htm.module.js";

const html = htm.bind(h);

export function AirModal({
  viewOnlyNotice,
  controlsDisabled,
  airExchangePeriod,
  airExchangeDuration,
  fanTargetRpm,
  airExchangeHoldoff,
  airExchangeBoost,
  onChangeNumber,
}) {
  return html`
    ${viewOnlyNotice}
    <div className="input-group">
      <label for="airExchangePeriod">Cycle every (minutes)</label>
      <input
        id="airExchangePeriod"
        type="number"
        min="10"
        max="240"
        step="5"
        value=${airExchangePeriod}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("air_exchange__cycle_minutes", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="airExchangeDuration">Run duration (minutes)</label>
      <input
        id="airExchangeDuration"
        type="number"
        min="1"
        max="60"
        step="1"
        value=${airExchangeDuration}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("air_exchange__run_minutes", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="fanSpeed">Fan RPM target</label>
      <input
        id="fanSpeed"
        type="number"
        min="800"
        max="3000"
        step="50"
        value=${fanTargetRpm}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("air_exchange__target_rpm", event.target.value)}
      />
    </div>
    <div className="input-group">
      <label for="airHoldoff">Pause after humidifying (minutes)</label>
      <input
        id="airHoldoff"
        type="number"
        min="0"
        max="60"
        step="1"
        value=${airExchangeHoldoff}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("air_exchange__holdoff_minutes", event.target.value)}
      />
      <p className="field-hint">
        Prevents the fan from fighting humidity recovery right after a misting cycle.
      </p>
    </div>
    <div className="input-group">
      <label for="airBoost">Boost when humidity > target (%)</label>
      <input
        id="airBoost"
        type="number"
        min="0"
        max="10"
        step="0.5"
        value=${airExchangeBoost}
        disabled=${controlsDisabled}
        onInput=${(event) => onChangeNumber("air_exchange__boost_threshold", event.target.value)}
      />
    </div>
  `;
}
