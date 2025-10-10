import { h } from '../vendor/preact.module.js'
import htm from '../vendor/htm.module.js'

const html = htm.bind(h)

export function StatusCard({ icon, title, status, detail, onClick }) {
  return html`
    <div className="card" onClick=${onClick}>
      <div className="card-header">
        <div className="card-icon">${icon}</div>
        <div className="card-title">${title}</div>
      </div>
      <div style=${{ marginTop: '16px' }}>
        <span className=${`status-badge status-${status}`}>
          ${status.toUpperCase()}
        </span>
      </div>
      ${detail ? html`<div className="card-label" style=${{ marginTop: '12px' }}>${detail}</div>` : null}
    </div>
  `
}
