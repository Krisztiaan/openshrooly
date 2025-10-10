import { h } from '../vendor/preact.module.js'
import htm from '../vendor/htm.module.js'

const html = htm.bind(h)

const toneToClass = {
  positive: 'tone-positive',
  warning: 'tone-warning',
  critical: 'tone-critical',
  calm: 'tone-calm',
}

export function SensorCard({ icon, title, value, unit, caption, tone = 'calm', onClick }) {
  const classes = ['tile', 'metric-tile', toneToClass[tone] || 'tone-calm']
  const roleProps = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick(event)
          }
        },
      }
    : {}

  return html`
    <article className=${classes.join(' ')} ...${roleProps}>
      <div className="tile-top">
        <span className="tile-icon">${icon}</span>
        <span className="tile-title">${title}</span>
      </div>
      <div className="tile-value">
        <span className="value">${value}</span>
        ${unit ? html`<span className="unit">${unit}</span>` : null}
      </div>
      ${caption ? html`<p className="tile-caption">${caption}</p>` : null}
    </article>
  `
}
