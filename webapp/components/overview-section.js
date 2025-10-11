import { h } from "../vendor/preact.module.js";
import htm from "../vendor/htm.module.js";
import { formatSinceShort } from "../lib/format.js";

const html = htm.bind(h);

export function OverviewSection({
  sensors,
  controls,
  offline,
  controlsDisabled,
  lastUpdate,
  quote,
}) {
  const noResponseText = () => {
    const since = formatSinceShort(lastUpdate);
    return since ? `No Response ${since}` : "No Response";
  };

  return html`
    <section className="section" aria-labelledby="section-overview">
      <div className="section-header">
        <div>
          <h2 id="section-overview">Environment</h2>
        </div>
      </div>
      <div className="sensor-strip">
        ${sensors.map((sensor) => {
          const hasValue = !offline && sensor.value !== null;
          const detail = hasValue ? sensor.detail : null;
          const displayValue = hasValue ? sensor.value : noResponseText();
          const tone = hasValue ? "sensor-active" : "sensor-inactive";
          return html`<button
            type="button"
            className=${`sensor-item ${tone}`}
            onClick=${sensor.action}
            disabled=${controlsDisabled && !hasValue}
          >
            <span className="sensor-icon">
              <iconify-icon icon=${sensor.icon} width="18" height="18"></iconify-icon>
            </span>
            <span className="sensor-copy">
              <span className="sensor-label">${sensor.label}</span>
              <span className="sensor-value" data-state=${hasValue ? "available" : "unavailable"}>
                ${displayValue}
              </span>
              ${detail ? html`<span className="sensor-detail">${detail}</span>` : null}
            </span>
          </button>`;
        })}
      </div>

      <div className="control-strip">
        ${controls.map((control) => {
          const hasEntity = control.isAvailable;
          const hasRecentData = hasEntity && Boolean(lastUpdate);
          const noResponse = offline || !hasRecentData;
          const active = control.isActive && !noResponse;
          const dimmed = !control.isActive || noResponse;
          const classes = ["control-pill"];
          if (active) classes.push("active");
          if (dimmed) classes.push("dimmed");
          return html`<button
            type="button"
            className=${classes.join(" ")}
            onClick=${control.action}
            data-state=${control.isActive ? "on" : "off"}
          >
            <span className="pill-icon">
              <iconify-icon icon=${control.icon} width="20" height="20"></iconify-icon>
            </span>
            <span className="pill-copy">
              <span className="pill-label">${control.label}</span>
              <span className="pill-detail">
                ${noResponse ? noResponseText() : control.detail}
              </span>
            </span>
          </button>`;
        })}
      </div>

      ${quote
        ? html`<div className="quote-footer" role="note">
            <p className="quote-footer__text">“${quote.text}”</p>
            ${quote.author
              ? html`<p className="quote-footer__author">— ${quote.author}</p>`
              : null}
          </div>`
        : null}
    </section>
  `;
}
