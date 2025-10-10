import { h } from '../vendor/preact.module.js'
import htm from '../vendor/htm.module.js'

const html = htm.bind(h)

export function SensorCard({ icon, title, value, unit, label, onClick }) {
  return html`
    <div className="card" onClick=${onClick}>
      <div className="card-header">
        <div className="card-icon">${icon}</div>
        <div className="card-title">${title}</div>
      </div>
      <div className="card-value">
        ${value}
        ${unit ? html`<span style=${{ fontSize: '0.6em', marginLeft: '4px' }}>${unit}</span>` : null}
      </div>
      ${label ? html`<div className="card-label">${label}</div>` : null}
    </div>
  `
}
