import { h } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";

const html = htm.bind(h);

export function ToggleSwitch({
        checked = false,
        disabled = false,
        onChange,
        ariaLabel,
        name,
        id,
}) {
        const handleChange = (event) => {
                if (disabled) return;
                const next = event.currentTarget.checked;
                if (typeof onChange === "function") onChange(next, event);
        };

        return html`<label className="switch" data-disabled=${disabled ? "true" : "false"}>
    <input
      id=${id}
      name=${name}
      type="checkbox"
      checked=${checked}
      disabled=${disabled}
      aria-label=${ariaLabel}
      onChange=${handleChange}
    />
    <span className="slider"></span>
  </label>`;
}
