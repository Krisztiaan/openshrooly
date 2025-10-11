import { h } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";

const html = htm.bind(h);

export function StatusCard({ icon, title, status, detail, onClick }) {
  const isOn = status === "on";
  const classes = ["tile", "status-tile", isOn ? "tone-positive" : "tone-calm"];
  const roleProps = onClick
    ? {
        role: "button",
        tabIndex: 0,
        "aria-pressed": isOn,
        "aria-label": `${title} ${isOn ? "enabled" : "disabled"}. Tap to ${isOn ? "adjust" : "enable"}.`,
        onClick,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick(event);
          }
        },
      }
    : {};

  return html`
    <article className=${classes.join(" ")} ...${roleProps}>
      <div className="tile-top">
        <span className="tile-icon">
          <iconify-icon icon=${icon} width="20" height="20"></iconify-icon>
        </span>
        <span className="tile-title">${title}</span>
      </div>
      <div className="status-row">
        <span className=${`status-badge ${isOn ? "on" : "off"}`}
          >${isOn ? "ON" : "OFF"}</span
        >
        <span className="status-detail">${detail}</span>
      </div>
    </article>
  `;
}
