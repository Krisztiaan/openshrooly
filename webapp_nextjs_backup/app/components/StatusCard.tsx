'use client'

interface StatusCardProps {
  icon: string
  title: string
  status: 'on' | 'off'
  detail?: string
}

export default function StatusCard({ icon, title, status, detail }: StatusCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon">{icon}</div>
        <div className="card-title">{title}</div>
      </div>
      <div style={{ marginTop: '16px' }}>
        <span className={`status-badge status-${status}`}>
          {status.toUpperCase()}
        </span>
      </div>
      {detail && (
        <div className="card-label" style={{ marginTop: '12px' }}>
          {detail}
        </div>
      )}
    </div>
  )
}
