import { h } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";

const html = htm.bind(h);

const noop = () => {};

export function SettingsRow({
  icon,
  title,
  hint = "",
  value,
  children,
  interactive = false,
  disabled = false,
  className = "",
  onPress = noop,
  role = "button",
}) {
  const classes = ["settings-row"];
  if (interactive) classes.push("interactive");
  if (disabled) classes.push("disabled");
  if (className) classes.push(className);

  const handleClick = (event) => {
    if (disabled) return;
    onPress?.(event);
  };

  const handleKeyDown = (event) => {
    if (!interactive || disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onPress?.(event);
    }
  };

  const interactiveProps = interactive
    ? {
        role,
        tabIndex: disabled ? -1 : 0,
        "aria-disabled": disabled ? "true" : "false",
        onKeyDown: handleKeyDown,
      }
    : {};

  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : children !== undefined && children !== null;

  const rightContent = hasChildren
    ? children
    : value !== undefined && value !== null
      ? html`<span className="settings-row-value">${value}</span>`
      : null;

  return html`
    <div
      className=${classes.join(" ")}
      onClick=${handleClick}
      ...${interactiveProps}
    >
      <div className="settings-row-info">
        ${icon
          ? html`<iconify-icon
              icon=${icon}
              width="18"
              height="18"
            ></iconify-icon>`
          : null}
        <div className="settings-row-text">
          <span className="settings-row-label">${title}</span>
          ${hint
            ? html`<span className="settings-row-caption">${hint}</span>`
            : null}
        </div>
      </div>
      <div className="settings-row-right">${rightContent}</div>
    </div>
  `;
}
