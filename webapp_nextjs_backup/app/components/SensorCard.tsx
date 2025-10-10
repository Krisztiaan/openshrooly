'use client'

interface SensorCardProps {
  icon: string
  title: string
  value: string | number
  unit?: string
  label?: string
}

export default function SensorCard({ icon, title, value, unit, label }: SensorCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon">{icon}</div>
        <div className="card-title">{title}</div>
      </div>
      <div className="card-value">
        {value}{unit && <span style={{ fontSize: '0.6em', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {label && <div className="card-label">{label}</div>}
    </div>
  )
}
