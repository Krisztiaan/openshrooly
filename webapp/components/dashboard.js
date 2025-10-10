import { h } from '../vendor/preact.module.js'
import { useState, useEffect, useRef } from '../vendor/hooks.module.js'
import htm from '../vendor/htm.module.js'
import { api } from '../lib/esphome-api.js'
import { SensorCard } from './sensor-card.js'
import { StatusCard } from './status-card.js'

const html = htm.bind(h)

const ALERTS = [
  { id: 'humidity_control_failure', msg: 'Humidity control failure' },
  { id: 'i2c_communication_failure', msg: 'Sensor communication error' },
  { id: 'fan_start_failure', msg: 'Fan failed to start' },
  { id: 'temperature_too_low', msg: 'Temperature too low' },
  { id: 'temperature_too_high', msg: 'Temperature too high' },
]

const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific Time' },
  { value: 'America/Denver', label: 'Mountain Time' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Chicago', label: 'Central Time' },
  { value: 'America/New_York', label: 'Eastern Time' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
]

const timeOptions = Array.from({ length: 48 }, (_, i) => i * 0.5)

const rgbToHex = (r, g, b) => {
  const toHex = (n) => {
    const hex = Math.round((n / 100) * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: Math.round((parseInt(result[1], 16) / 255) * 100),
        g: Math.round((parseInt(result[2], 16) / 255) * 100),
        b: Math.round((parseInt(result[3], 16) / 255) * 100),
      }
    : { r: 0, g: 0, b: 0 }
}

const formatTime = (hour) => {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export function Dashboard() {
  const [entities, setEntities] = useState({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [modal, setModal] = useState({ type: null })
  const [timezone, setTimezone] = useState('America/Denver')
  const [calibrationSuccess, setCalibrationSuccess] = useState(false)
  const [showLicense, setShowLicense] = useState(false)
  const [otaFile, setOtaFile] = useState(null)
  const [otaProgress, setOtaProgress] = useState(0)
  const [otaStatus, setOtaStatus] = useState('idle')
  const [otaMessage, setOtaMessage] = useState('')

  const debounceTimers = useRef({})

  useEffect(() => {
    const fetchData = async () => {
      try {
        const numbers = await api.getAllNumbers()
        setEntities((prev) => ({ ...prev, ...numbers }))
      } catch (_) {
        // ignore, event stream will hydrate
      }

      try {
        const tz = await api.getSelect('timezone_select')
        if (tz?.state) setTimezone(tz.state)
      } catch (_) {
        // ignore
      }

      setLoading(false)
    }

    fetchData()

    const eventSource = api.subscribeToEvents((event) => {
      if (!event.id) return
      setEntities((prev) => ({
        ...prev,
        [event.id]: {
          value: event.value !== undefined ? event.value : event.state === 'ON',
          state: event.state,
        },
      }))
      setLastUpdate(new Date())
      if (event.id === 'select-timezone_select') setTimezone(event.state)
    })

    return () => {
      if (eventSource) eventSource.close()
      Object.values(debounceTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const handleNumberChange = (id, value) => {
    const numericValue = Number(value)
    if (Number.isNaN(numericValue)) return
    setEntities((prev) => ({ ...prev, [id]: { ...prev[id], value: numericValue } }))
    if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id])
    debounceTimers.current[id] = setTimeout(async () => {
      const numberId = id.replace('number-', '')
      await api.setNumber(numberId, numericValue)
    }, 250)
  }

  const handleButtonClick = async (buttonId) => {
    await api.pressButton(buttonId)
  }

  const handleSwitchChange = async (id, checked) => {
    setEntities((prev) => ({
      ...prev,
      [id]: { ...prev[id], state: checked ? 'ON' : 'OFF', value: checked },
    }))
    const switchId = id.replace('switch-', '')
    await api.setSwitch(switchId, checked)
  }

  const handleSelectChange = async (selectId, value) => {
    await api.setSelect(selectId, value)
  }

  const handleTimezoneChange = async (tz) => {
    setTimezone(tz)
    await handleSelectChange('timezone_select', tz)
  }

  const handleOtaUpload = async () => {
    if (!otaFile) {
      setOtaMessage('Please select a firmware file')
      setOtaStatus('error')
      return
    }

    setOtaStatus('uploading')
    setOtaProgress(0)
    setOtaMessage('Uploading firmware...')

    try {
      const formData = new FormData()
      formData.append('file', otaFile)

      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setOtaProgress((e.loaded / e.total) * 100)
      })
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          setOtaStatus('success')
          setOtaMessage('Firmware uploaded successfully! Device will restart...')
          setOtaProgress(100)
          setTimeout(() => {
            setOtaStatus('idle')
            setOtaFile(null)
            setOtaProgress(0)
            setOtaMessage('')
          }, 5000)
        } else {
          setOtaStatus('error')
          setOtaMessage(`Upload failed: ${xhr.statusText}`)
        }
      })
      xhr.addEventListener('error', () => {
        setOtaStatus('error')
        setOtaMessage('Upload failed: Network error')
      })
      xhr.open('POST', '/update')
      xhr.send(formData)
    } catch (error) {
      setOtaStatus('error')
      setOtaMessage(`Upload failed: ${error}`)
    }
  }

  const handleColorChange = (hex) => {
    const rgb = hexToRgb(hex)
    handleNumberChange('number-red_led_intensity', rgb.r)
    handleNumberChange('number-green_led_intensity', rgb.g)
    handleNumberChange('number-blue_led_intensity', rgb.b)
  }

  const getSensor = (id) => entities[`sensor-${id}`]?.value
  const getNumber = (id) => entities[`number-${id}`]?.value
  const getSwitchState = (id) => entities[`switch-${id}`]?.state === 'ON' || entities[`switch-${id}`]?.value === true

  if (loading) {
    return html`<div className="loading-screen"><div className="spinner"></div><div>Connecting to OpenShrooly...</div></div>`
  }

  const alerts = ALERTS.filter((a) => entities[`binary_sensor-alert__${a.id}`]?.value === true)

  const temp = Number(getSensor('temperature') ?? getSensor('current_temperature') ?? 0)
  const humidity = Number(getSensor('humidity') ?? getSensor('current_humidity') ?? 0)
  const waterLevel = Number(getSensor('water_level_percent') ?? getSensor('water_level') ?? 0)
  const targetHumidity = Number(getNumber('target_humidity') ?? 70)
  const humidityHysteresis = Number(getNumber('humidity__hysteresis') ?? 2)

  const tempControlEnabled = getSwitchState('temperature_control_enabled')
  const tempTarget = Number(getNumber('temperature__target') ?? 22)
  const tempHysteresis = Number(getNumber('temperature__hysteresis') ?? 1)
  const tempMin = tempControlEnabled ? tempTarget - tempHysteresis : 0
  const tempMax = tempControlEnabled ? tempTarget + tempHysteresis : 0

  const humidifierOn = getSwitchState('humidifier') || entities['binary_sensor-humidifier_on']?.value === true
  const airExchangeOn = getSwitchState('air_exchange') || entities['binary_sensor-air_exchange_on']?.value === true
  const heatRequested = entities['binary_sensor-heat_requested']?.value === true

  const lightsSunrise = Number(getNumber('lights__sunrise_hour') ?? 8)
  const lightsDuration = Number(getNumber('lights__duration__hours_') ?? 12)
  const lightsSunset = (lightsSunrise + lightsDuration) % 24
  const lightsOn = (() => {
    const now = new Date()
    const currentHour = now.getHours() + now.getMinutes() / 60
    return lightsSunrise < lightsSunset
      ? currentHour >= lightsSunrise && currentHour < lightsSunset
      : currentHour >= lightsSunrise || currentHour < lightsSunset
  })()
  const luxValue = Number(getNumber('white_led_intensity') ?? 0)
  const currentColor = rgbToHex(
    Number(getNumber('red_led_intensity') ?? 0),
    Number(getNumber('green_led_intensity') ?? 0),
    Number(getNumber('blue_led_intensity') ?? 0),
  )

  const renderModal = () => {
    switch (modal.type) {
      case 'humidity': {
        const presets = [
          { label: 'Precision (70% ±1%)', target: 70, hysteresis: 1 },
          { label: 'Balanced (68% ±2%)', target: 68, hysteresis: 2 },
          { label: 'Eco (65% ±3%)', target: 65, hysteresis: 3 },
        ]
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>💧 Humidity Control</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Target Humidity (%)</label>
                  <input
                    type="number"
                    min="60"
                    max="95"
                    step="0.5"
                    className="control-select"
                    value=${targetHumidity}
                    onInput=${(e) => handleNumberChange('number-target_humidity', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Hysteresis (±%)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.25"
                    className="control-select"
                    value=${humidityHysteresis}
                    onInput=${(e) => handleNumberChange('number-humidity__hysteresis', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Quick Presets</label>
                  <div className="preset-row">
                    ${presets.map((preset) => html`
                      <button
                        className="preset-chip"
                        onClick=${() => {
                          handleNumberChange('number-target_humidity', preset.target)
                          handleNumberChange('number-humidity__hysteresis', preset.hysteresis)
                          setModal({ type: null })
                        }}
                      >
                        ${preset.label}
                      </button>
                    `)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `
      }
      case 'temperature': {
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>🌡️ Temperature Guard</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Guard Enabled</label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked=${tempControlEnabled}
                      onChange=${(e) => handleSwitchChange('switch-temperature_control_enabled', e.target.checked)}
                    />
                    <span>Maintain ${tempTarget.toFixed(1)}°C ± ${tempHysteresis.toFixed(1)}°C</span>
                  </label>
                </div>
                <div className="control-group">
                  <label>Set Target (°C)</label>
                  <input
                    type="number"
                    min="15"
                    max="30"
                    step="0.5"
                    className="control-select"
                    value=${tempTarget}
                    onInput=${(e) => handleNumberChange('number-temperature__target', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Hysteresis (°C)</label>
                  <input
                    type="number"
                    min="0"
                    max="3"
                    step="0.25"
                    className="control-select"
                    value=${tempHysteresis}
                    onInput=${(e) => handleNumberChange('number-temperature__hysteresis', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        `
      }
      case 'air': {
        const period = Number(getNumber('air_exchange__period__min_') ?? 60)
        const runDuration = Number(getNumber('air_exchange__run_duration__s_') ?? 30)
        const speed = Number(getNumber('air_exchange__speed') ?? 50)
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>🌬️ Fresh Air Cycle</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Cycle Period (minutes)</label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    step="5"
                    className="control-select"
                    value=${period}
                    onInput=${(e) => handleNumberChange('number-air_exchange__period__min_', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Run Duration (seconds)</label>
                  <input
                    type="number"
                    min="10"
                    max="600"
                    step="5"
                    className="control-select"
                    value=${runDuration}
                    onInput=${(e) => handleNumberChange('number-air_exchange__run_duration__s_', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Fan Speed (%)</label>
                  <input
                    type="number"
                    min="10"
                    max="100"
                    step="5"
                    className="control-select"
                    value=${speed}
                    onInput=${(e) => handleNumberChange('number-air_exchange__speed', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        `
      }
      case 'light': {
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>💡 Lighting Plan</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Sunrise</label>
                  <select
                    className="control-select"
                    value=${lightsSunrise}
                    onChange=${(e) => handleNumberChange('number-lights__sunrise_hour', e.target.value)}
                  >
                    ${timeOptions.map((value) => html`<option value=${value}>${formatTime(value)}</option>`) }
                  </select>
                </div>
                <div className="control-group">
                  <label>Duration (hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="0.25"
                    className="control-select"
                    value=${lightsDuration}
                    onInput=${(e) => handleNumberChange('number-lights__duration__hours_', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Canopy Brightness (lux)</label>
                  <input
                    type="number"
                    min="0"
                    max="4000"
                    step="10"
                    className="control-select"
                    value=${luxValue}
                    onInput=${(e) => handleNumberChange('number-white_led_intensity', e.target.value)}
                  />
                </div>
                <div className="control-group">
                  <label>Accent Color</label>
                  <input
                    type="color"
                    className="control-select"
                    value=${currentColor}
                    onInput=${(e) => handleColorChange(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        `
      }
      case 'water': {
        const calibrated = entities['binary_sensor-water_calibrated']?.value === true
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>🚰 Water Reservoir</h2>
              <div className="modal-content">
                <p>The water level sensor ${calibrated ? 'is calibrated.' : 'needs calibration for best accuracy.'}</p>
                <button
                  className="modal-confirm"
                  onClick=${() => {
                    handleButtonClick('calibrate_dry_tank')
                    setTimeout(() => {
                      handleButtonClick('calibrate_dry_tank')
                      setCalibrationSuccess(true)
                      setTimeout(() => setCalibrationSuccess(false), 8000)
                    }, 500)
                  }}
                >
                  Calibrate Empty Reservoir
                </button>
                ${calibrationSuccess
                  ? html`<div className="calibrate-success">Calibration request sent.</div>`
                  : null}
              </div>
            </div>
          </div>
        `
      }
      case 'settings': {
        return html`
          <div className="modal-overlay" onClick=${() => setModal({ type: null })}>
            <div className="modal" onClick=${(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick=${() => setModal({ type: null })}>×</button>
              <h2>⚙️ Device Settings</h2>
              <div className="modal-content">
                <div className="control-group">
                  <label>Timezone</label>
                  <select
                    className="control-select"
                    value=${timezone}
                    onChange=${(e) => handleTimezoneChange(e.target.value)}
                  >
                    ${TIMEZONE_OPTIONS.map((tz) => html`<option value=${tz.value}>${tz.label}</option>`)}
                  </select>
                </div>
                <div className="control-group">
                  <label>Legal & Licenses</label>
                  <button className="modal-secondary" onClick=${() => setShowLicense((prev) => !prev)}>
                    ${showLicense ? 'Hide' : 'Show'} open-source licenses
                  </button>
                  ${showLicense
                    ? html`<pre className="license-text">${entities['text_sensor-licenses']?.value ?? 'Licenses pending from device.'}</pre>`
                    : null}
                </div>
                <div className="control-group">
                  <label>Firmware Update</label>
                  <input
                    type="file"
                    accept=".bin"
                    disabled=${otaStatus === 'uploading'}
                    onChange=${(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setOtaFile(file)
                        setOtaStatus('idle')
                        setOtaMessage('')
                      }
                    }}
                  />
                  ${otaFile
                    ? html`<div className="ota-file">Selected: ${otaFile.name} (${(otaFile.size / 1024 / 1024).toFixed(2)} MB)</div>`
                    : null}
                  <button
                    className="modal-confirm"
                    disabled=${!otaFile || otaStatus === 'uploading'}
                    onClick=${handleOtaUpload}
                  >
                    ${otaStatus === 'uploading' ? 'Uploading...' : 'Upload Firmware'}
                  </button>
                  ${otaStatus !== 'idle'
                    ? html`<div className="ota-status">${otaMessage}</div>`
                    : null}
                  ${otaStatus === 'uploading'
                    ? html`<div className="ota-progress"><div style=${{ width: `${otaProgress}%` }}></div></div>`
                    : null}
                </div>
              </div>
            </div>
          </div>
        `
      }
      default:
        return null
    }
  }

  return html`
    <div className="dashboard">
      <header className="header-bar">
        <div>
          <h1>OpenShrooly Dashboard</h1>
          <div className="header-time">
            Last update ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${timezone}
          </div>
        </div>
        <div className="header-right">
          <select className="timezone-select" value=${timezone} onChange=${(e) => handleTimezoneChange(e.target.value)}>
            ${TIMEZONE_OPTIONS.map((tz) => html`<option value=${tz.value}>${tz.label}</option>`)}
          </select>
          <button className="charts-button" onClick=${() => setModal({ type: 'settings' })}>Settings</button>
        </div>
      </header>

      ${alerts.length
        ? html`<div className="alerts-banner">${alerts.map((alert) => html`<div className="alert-item">⚠️ ${alert.msg}</div>`)}</div>`
        : null}

      <section className="main-grid">
        <${SensorCard}
          icon="💧"
          title="Humidity"
          value=${humidity.toFixed(1)}
          unit="%"
          label=${`Target ${targetHumidity.toFixed(1)}% ± ${humidityHysteresis.toFixed(2)}%`}
          onClick=${() => setModal({ type: 'humidity' })}
        />
        <${SensorCard}
          icon="🌡️"
          title="Temperature"
          value=${temp.toFixed(1)}
          unit="°C"
          label=${tempControlEnabled ? `Range ${tempMin.toFixed(1)}° – ${tempMax.toFixed(1)}°` : 'Guard disabled'}
          onClick=${() => setModal({ type: 'temperature' })}
        />
        <${SensorCard}
          icon="🚰"
          title="Water Level"
          value=${waterLevel.toFixed(0)}
          unit="%"
          label=${calibrationSuccess ? 'Calibration requested' : 'Tap to calibrate'}
          onClick=${() => setModal({ type: 'water' })}
        />
        <${SensorCard}
          icon="💡"
          title="Lighting"
          value=${lightsOn ? 'ON' : 'OFF'}
          label=${`Sunrise ${formatTime(lightsSunrise)} • Sunset ${formatTime(lightsSunset)}`}
          onClick=${() => setModal({ type: 'light' })}
        />
        <${SensorCard}
          icon="🌬️"
          title="Air Exchange"
          value=${airExchangeOn ? 'Active' : 'Idle'}
          label=${`Tap to tune cycle`}
          onClick=${() => setModal({ type: 'air' })}
        />
        <${SensorCard}
          icon="⚙️"
          title="Controls"
          value="Adjust"
          label="Open settings & OTA"
          onClick=${() => setModal({ type: 'settings' })}
        />
      </section>

      <section className="secondary-grid">
        <${StatusCard}
          icon="🌀"
          title="Humidifier"
          status=${humidifierOn ? 'on' : 'off'}
          detail=${humidifierOn ? 'Maintaining target humidity' : 'Standby'}
          onClick=${() => handleSwitchChange('switch-humidifier', !humidifierOn)}
        />
        <${StatusCard}
          icon="🌬️"
          title="Air Exchange"
          status=${airExchangeOn ? 'on' : 'off'}
          detail=${airExchangeOn ? 'Cycling fresh air' : 'Idle'}
          onClick=${() => handleSwitchChange('switch-air_exchange', !airExchangeOn)}
        />
        <${StatusCard}
          icon="🔥"
          title="Heater"
          status=${heatRequested ? 'on' : 'off'}
          detail=${tempControlEnabled ? 'Temperature guard active' : 'Guard disabled'}
          onClick=${() => setModal({ type: 'temperature' })}
        />
        <${StatusCard}
          icon="💡"
          title="Lights"
          status=${lightsOn ? 'on' : 'off'}
          detail=${`${luxValue} lux target`}
          onClick=${() => setModal({ type: 'light' })}
        />
      </section>

      <section className="actions-panel">
        <div className="action-row">
          <label>
            <input
              type="checkbox"
              checked=${humidifierOn}
              onChange=${(e) => handleSwitchChange('switch-humidifier', e.target.checked)}
            />
            Humidifier
          </label>
          <label>
            <input
              type="checkbox"
              checked=${airExchangeOn}
              onChange=${(e) => handleSwitchChange('switch-air_exchange', e.target.checked)}
            />
            Air exchange
          </label>
          <label>
            <input
              type="checkbox"
              checked=${getSwitchState('ble_enabled')}
              onChange=${(e) => handleSwitchChange('switch-ble_enabled', e.target.checked)}
            />
            BLE service
          </label>
        </div>
      </section>

      ${renderModal()}
    </div>
  `
}
