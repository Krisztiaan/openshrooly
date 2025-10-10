import { h } from '../vendor/preact.module.js'
import { useState, useEffect, useRef, useMemo } from '../vendor/hooks.module.js'
import htm from '../vendor/htm.module.js'
import { api } from '../lib/esphome-api.js'
import { SensorCard } from './sensor-card.js'
import { StatusCard } from './status-card.js'

const html = htm.bind(h)

const ALERTS = [
  { id: 'humidity_control_failure', msg: 'Humidity control failure detected' },
  { id: 'i2c_communication_failure', msg: 'Sensor communication issue' },
  { id: 'fan_start_failure', msg: 'Air exchange fan failed to start' },
  { id: 'temperature_too_low', msg: 'Temperature is below the safe range' },
  { id: 'temperature_too_high', msg: 'Temperature is above the safe range' },
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

const CONNECTION_META = {
  connecting: { label: 'Connecting', tone: 'calm', detail: 'Looking for the OpenShrooly on your network…' },
  streaming: { label: 'Live', tone: 'positive', detail: 'Realtime updates are active.' },
  polling: { label: 'Snapshots', tone: 'warning', detail: 'Realtime channel unavailable — refreshing every 5 seconds.' },
  offline: { label: 'Offline', tone: 'critical', detail: 'Device unreachable. Join the same Wi‑Fi as the OpenShrooly to resume.' },
}

const REFRESH_INTERVAL_MS = 5000
const RECONNECT_INTERVAL_MS = 15000

const formatTime = (hour) => {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

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

export function Dashboard() {
  const [entities, setEntities] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [timezone, setTimezone] = useState('America/Denver')
  const [calibrationSuccess, setCalibrationSuccess] = useState(false)
  const [showLicense, setShowLicense] = useState(false)
  const [otaFile, setOtaFile] = useState(null)
  const [otaProgress, setOtaProgress] = useState(0)
  const [otaStatus, setOtaStatus] = useState('idle')
  const [otaMessage, setOtaMessage] = useState('')
  const [connection, setConnection] = useState({ status: 'connecting', detail: CONNECTION_META.connecting.detail })
  const [lastUpdate, setLastUpdate] = useState(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [banner, setBanner] = useState(null)

  const debounceTimers = useRef({})
  const eventSourceRef = useRef(null)
  const pollTimerRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const initialSnapshotTaken = useRef(false)

  const mergeEntities = (patch) => {
    setEntities((prev) => ({ ...prev, ...patch }))
  }

  const stopEventStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  const stopReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  const stopAllConnectivity = () => {
    stopEventStream()
    stopPolling()
    stopReconnect()
  }

  const refreshSnapshot = async ({ silent = false } = {}) => {
    try {
      const snapshot = await api.fetchSnapshot()
      mergeEntities(snapshot)
      const tz = snapshot['select-timezone_select']?.state
      if (tz) setTimezone(tz)
      setLastUpdate(new Date())
      if (!initialSnapshotTaken.current) {
        initialSnapshotTaken.current = true
        setLoading(false)
      }
      if (!silent) setBanner({ tone: 'positive', message: 'Dashboard updated just now.' })
      return true
    } catch (error) {
      console.error('Snapshot failed', error)
      if (!silent) {
        setBanner({ tone: 'critical', message: 'Could not refresh from the device. Check the connection and try again.' })
      }
      return false
    }
  }

  const scheduleReconnect = () => {
    stopReconnect()
    reconnectTimerRef.current = setTimeout(() => {
      if (!isOnline) return
      startEventStream({ retry: true })
    }, RECONNECT_INTERVAL_MS)
  }

  const startPolling = (detail = CONNECTION_META.polling.detail) => {
    stopEventStream()
    if (!pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        refreshSnapshot({ silent: true })
      }, REFRESH_INTERVAL_MS)
    }
    setConnection({ status: 'polling', detail })
    refreshSnapshot({ silent: true })
    scheduleReconnect()
  }

  const startEventStream = ({ retry = false } = {}) => {
    stopEventStream()
    if (!isOnline) return

    const detail = retry ? 'Re-establishing realtime connection…' : CONNECTION_META.connecting.detail
    setConnection({ status: 'connecting', detail })

    const eventSource = api.subscribeToEvents((event) => {
      if (!event.id) return
      mergeEntities({
        [event.id]: {
          value: event.value !== undefined ? event.value : event.state === 'ON',
          state: event.state,
        },
      })
      if (event.id === 'select-timezone_select' && event.state) {
        setTimezone(event.state)
      }
      setLastUpdate(new Date())
      setBanner(null)
    })

    if (!eventSource) {
      startPolling('Realtime channel unavailable. Falling back to snapshots.')
      return
    }

    eventSourceRef.current = eventSource
    eventSource.onopen = () => {
      stopPolling()
      stopReconnect()
      setConnection({ status: 'streaming', detail: CONNECTION_META.streaming.detail })
      if (!initialSnapshotTaken.current) {
        refreshSnapshot({ silent: true })
      }
    }
    eventSource.onerror = () => {
      console.warn('EventSource error — switching to snapshot mode')
      startPolling('Realtime channel interrupted. Using 5 s snapshots while retrying…')
    }
  }

  const handleOfflineChange = (online) => {
    setIsOnline(online)
    if (!online) {
      stopAllConnectivity()
      setConnection({ status: 'offline', detail: CONNECTION_META.offline.detail })
    }
  }

  useEffect(() => {
    const onOnline = () => handleOfflineChange(true)
    const onOffline = () => handleOfflineChange(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const ok = await refreshSnapshot({ silent: true })
      if (cancelled) return
      if (!ok) setConnection({ status: 'connecting', detail: 'Retrying snapshot…' })
      startEventStream()
    }
    bootstrap()
    return () => {
      cancelled = true
      stopAllConnectivity()
    }
  }, [])

  useEffect(() => {
    if (!isOnline) {
      setBanner({ tone: 'warning', message: 'You appear to be offline. The dashboard is running on cached data.' })
      return
    }

    setBanner(null)
    stopAllConnectivity()
    refreshSnapshot({ silent: true })
    startEventStream({ retry: true })
  }, [isOnline])

  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(null), 6000)
    return () => clearTimeout(timer)
  }, [banner])

  const handleNumberChange = (id, value) => {
    const numericValue = Number(value)
    if (Number.isNaN(numericValue)) return
    const key = `number-${id}`
    setEntities((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), value: numericValue, state: numericValue } }))
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key])
    debounceTimers.current[key] = setTimeout(async () => {
      await api.setNumber(id, numericValue)
    }, 250)
  }

  const handleButtonClick = async (buttonId) => {
    await api.pressButton(buttonId)
  }

  const handleSwitchChange = async (id, checked) => {
    const key = `switch-${id}`
    setEntities((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), state: checked ? 'ON' : 'OFF', value: checked },
    }))
    await api.setSwitch(id, checked)
  }

  const handleSelectChange = async (id, option) => {
    await api.setSelect(id, option)
    setEntities((prev) => ({ ...prev, [`select-${id}`]: { ...(prev[`select-${id}`] || {}), state: option } }))
  }

  const handleTimezoneChange = async (tz) => {
    setTimezone(tz)
    await handleSelectChange('timezone_select', tz)
  }

  const handleOtaUpload = async () => {
    if (!otaFile) {
      setOtaMessage('Please select a firmware file before uploading.')
      setOtaStatus('error')
      return
    }

    setOtaStatus('uploading')
    setOtaProgress(0)
    setOtaMessage('Uploading firmware…')

    try {
      const formData = new FormData()
      formData.append('file', otaFile)
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setOtaProgress((event.loaded / event.total) * 100)
        }
      })
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          setOtaStatus('success')
          setOtaMessage('Firmware uploaded. The device will reboot shortly.')
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
        setOtaMessage('Upload failed due to a network error.')
      })
      xhr.open('POST', '/update')
      xhr.send(formData)
    } catch (error) {
      setOtaStatus('error')
      setOtaMessage(`Upload failed: ${error}`)
    }
  }

  const manualRefresh = () => {
    refreshSnapshot({ silent: false })
  }

  const connectionMeta = CONNECTION_META[connection.status] || CONNECTION_META.connecting

  const getNumeric = (prefix, id, fallback = 0) => {
    const entity = entities[`${prefix}-${id}`]
    const raw = entity?.value ?? entity?.state
    const value = typeof raw === 'number' ? raw : parseFloat(raw)
    return Number.isFinite(value) ? value : fallback
  }

  const getBoolean = (prefix, id) => {
    const entity = entities[`${prefix}-${id}`]
    if (!entity) return false
    if (typeof entity.value === 'boolean') return entity.value
    if (typeof entity.state === 'boolean') return entity.state
    return entity.state === 'ON'
  }

  const getText = (id) => entities[`text_sensor-${id}`]?.state ?? ''

  const humidity = useMemo(() => getNumeric('sensor', 'humidity') || getNumeric('sensor', 'current_humidity'), [entities])
  const targetHumidity = useMemo(() => getNumeric('number', 'target_humidity', 70), [entities])
  const humidityHysteresis = useMemo(() => getNumeric('number', 'humidity__hysteresis', 2), [entities])
  const humidifierSpeed = useMemo(() => getNumeric('number', 'humidifier__speed', 80), [entities])

  const temperature = useMemo(() => getNumeric('sensor', 'temperature') || getNumeric('sensor', 'current_temperature'), [entities])
  const tempTarget = useMemo(() => getNumeric('number', 'temperature__target', 22), [entities])
  const tempHysteresis = useMemo(() => getNumeric('number', 'temperature__hysteresis', 1), [entities])
  const tempControlEnabled = useMemo(() => getBoolean('switch', 'temperature_control_enabled'), [entities])
  const tempMin = tempControlEnabled ? tempTarget - tempHysteresis : 0
  const tempMax = tempControlEnabled ? tempTarget + tempHysteresis : 0

  const waterLevel = useMemo(() => getNumeric('sensor', 'water_level_percent', getNumeric('sensor', 'water_level', 0)), [entities])
  const systemVoltage = useMemo(() => getNumeric('sensor', 'system_voltage', NaN), [entities])

  const lightsSunrise = useMemo(() => getNumeric('number', 'lights__sunrise_hour', 8), [entities])
  const lightsDuration = useMemo(() => getNumeric('number', 'lights__duration__hours_', 12), [entities])
  const lightsSunset = useMemo(() => (lightsSunrise + lightsDuration) % 24, [lightsSunrise, lightsDuration])
  const luxValue = useMemo(() => getNumeric('number', 'white_led_intensity', 0), [entities])
  const currentColor = useMemo(
    () =>
      rgbToHex(
        getNumeric('number', 'red_led_intensity', 0),
        getNumeric('number', 'green_led_intensity', 0),
        getNumeric('number', 'blue_led_intensity', 0),
      ),
    [entities]
  )
  const lightsOn = useMemo(() => {
    const now = new Date()
    const currentHour = now.getHours() + now.getMinutes() / 60
    if (lightsDuration <= 0) return false
    if (lightsSunrise < lightsSunset) {
      return currentHour >= lightsSunrise && currentHour < lightsSunset
    }
    return currentHour >= lightsSunrise || currentHour < lightsSunset
  }, [lightsSunrise, lightsSunset, lightsDuration])
  const tempWarningMin = useMemo(() => getNumeric('number', 'temperature__warning_minimum', 18), [entities])
  const tempWarningMax = useMemo(() => getNumeric('number', 'temperature__warning_maximum', 30), [entities])

  const humidifierOn = useMemo(() => getBoolean('switch', 'humidifier') || getBoolean('binary_sensor', 'humidifier_on'), [entities])
  const airExchangeOn = useMemo(
    () => getBoolean('switch', 'air_exchange') || getBoolean('binary_sensor', 'air_exchange_on'),
    [entities]
  )
  const heatRequested = useMemo(() => getBoolean('binary_sensor', 'heat_requested'), [entities])
  const bleEnabled = useMemo(() => getBoolean('switch', 'ble_enabled'), [entities])
  const timezoneLabel = useMemo(() => TIMEZONE_OPTIONS.find((tz) => tz.value === timezone)?.label ?? timezone, [timezone])
  const wifiMode = useMemo(() => getText('wifi_mode') || 'Unknown', [entities])
  const wifiSSID = useMemo(() => getText('wifi_ssid') || 'Unknown', [entities])
  const ipAddress = useMemo(() => getText('ip_address') || 'Unavailable', [entities])
  const calibrationStatus = useMemo(() => getText('calibration_status') || '', [entities])
  const licensesText = useMemo(() => getText('licenses') || 'License list not yet reported by the device.', [entities])
  const voltageDisplay = Number.isFinite(systemVoltage) ? `${systemVoltage.toFixed(2)} V` : '—'
  const lastUpdateDisplay = lastUpdate
    ? lastUpdate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'No data yet'

  const alerts = useMemo(
    () => ALERTS.filter((alert) => getBoolean('binary_sensor', `alert__${alert.id}`)),
    [entities]
  )

  if (loading) {
    return html`
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Connecting to OpenShrooly…</p>
      </div>
    `
  }

  const renderModal = () => {
    if (!modal) return null

    const closeModal = () => {
      setModal(null)
      setCalibrationSuccess(false)
    }

    const modalBase = (title, content) =>
      html`
        <div className="modal-overlay" onClick=${closeModal}>
          <div className="modal" onClick=${(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>${title}</h2>
              <button className="icon-button" aria-label="Close" onClick=${closeModal}>×</button>
            </header>
            <div className="modal-content">${content}</div>
          </div>
        </div>
      `

    switch (modal) {
      case 'humidity': {
        const presets = [
          { label: 'Precision · 70% ±1%', target: 70, hysteresis: 1 },
          { label: 'Balanced · 68% ±2%', target: 68, hysteresis: 2 },
          { label: 'Eco · 65% ±3%', target: 65, hysteresis: 3 },
        ]
        return modalBase(
          'Humidity Control',
          html`
            <div className="input-group">
              <label for="targetHumidity">Target humidity (%)</label>
              <input
                id="targetHumidity"
                type="number"
                min="60"
                max="95"
                step="0.5"
                value=${targetHumidity}
                onInput=${(event) => handleNumberChange('target_humidity', event.target.value)}
              />
            </div>
            <div className="input-group">
              <label for="humidityHysteresis">Hysteresis (± %)</label>
              <input
                id="humidityHysteresis"
                type="number"
                min="0"
                max="5"
                step="0.25"
                value=${humidityHysteresis}
                onInput=${(event) => handleNumberChange('humidity__hysteresis', event.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Presets</label>
              <div className="chip-row">
                ${presets.map(
                  (preset) => html`
                    <button
                      className="chip-button"
                      onClick=${() => {
                        handleNumberChange('target_humidity', preset.target)
                        handleNumberChange('humidity__hysteresis', preset.hysteresis)
                        closeModal()
                      }}
                    >
                      ${preset.label}
                    </button>
                  `,
                )}
              </div>
            </div>
            <div className="input-group">
              <label for="humidifierSpeed">Humidifier fan speed · ${humidifierSpeed.toFixed(0)}%</label>
              <input
                id="humidifierSpeed"
                type="range"
                min="40"
                max="100"
                step="5"
                value=${humidifierSpeed}
                onInput=${(event) => handleNumberChange('humidifier__speed', event.target.value)}
              />
              <p className="field-hint">Higher speeds add humidity faster but increase noise and water consumption.</p>
            </div>
          `,
        )
      }
      case 'temperature': {
        return modalBase(
          'Temperature Guard',
          html`
            <div className="toggle-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked=${tempControlEnabled}
                  onChange=${(event) => handleSwitchChange('temperature_control_enabled', event.target.checked)}
                />
                <span>Maintain ${tempTarget.toFixed(1)}°C ± ${tempHysteresis.toFixed(1)}°C</span>
              </label>
            </div>
            <div className="input-grid">
              <div className="input-group">
                <label for="tempTarget">Target (°C)</label>
                <input
                  id="tempTarget"
                  type="number"
                  min="15"
                  max="30"
                  step="0.5"
                  value=${tempTarget}
                  onInput=${(event) => handleNumberChange('temperature__target', event.target.value)}
                />
              </div>
              <div className="input-group">
                <label for="tempHysteresis">Hysteresis (°C)</label>
                <input
                  id="tempHysteresis"
                  type="number"
                  min="0"
                  max="3"
                  step="0.25"
                  value=${tempHysteresis}
                  onInput=${(event) => handleNumberChange('temperature__hysteresis', event.target.value)}
                />
              </div>
            </div>
            <div className="info-banner calm">
              <span>⚠️ Use warnings to surface comfort deviations without changing the guard.</span>
            </div>
            <div className="input-grid">
              <div className="input-group">
                <label for="tempWarnMin">Warning minimum (°C)</label>
                <input
                  id="tempWarnMin"
                  type="number"
                  min="5"
                  max="tempWarningMax"
                  step="0.5"
                  value=${tempWarningMin}
                  onInput=${(event) => handleNumberChange('temperature__warning_minimum', event.target.value)}
                />
              </div>
              <div className="input-group">
                <label for="tempWarnMax">Warning maximum (°C)</label>
                <input
                  id="tempWarnMax"
                  type="number"
                  min="tempWarningMin"
                  max="40"
                  step="0.5"
                  value=${tempWarningMax}
                  onInput=${(event) => handleNumberChange('temperature__warning_maximum', event.target.value)}
                />
              </div>
            </div>
          `,
        )
      }
      case 'air': {
        const period = getNumeric('number', 'air_exchange__period__min_', 60)
        const runDuration = getNumeric('number', 'air_exchange__run_duration__s_', 30)
        const speed = getNumeric('number', 'air_exchange__speed', 50)
        return modalBase(
          'Fresh Air Cycle',
          html`
            <div className="input-grid">
              <div className="input-group">
                <label for="airPeriod">Cycle period (minutes)</label>
                <input
                  id="airPeriod"
                  type="number"
                  min="5"
                  max="180"
                  step="5"
                  value=${period}
                  onInput=${(event) => handleNumberChange('air_exchange__period__min_', event.target.value)}
                />
              </div>
              <div className="input-group">
                <label for="airDuration">Run duration (seconds)</label>
                <input
                  id="airDuration"
                  type="number"
                  min="10"
                  max="600"
                  step="5"
                  value=${runDuration}
                  onInput=${(event) => handleNumberChange('air_exchange__run_duration__s_', event.target.value)}
                />
              </div>
            </div>
            <div className="input-group">
              <label for="airSpeed">Fan speed (%)</label>
              <input
                id="airSpeed"
                type="number"
                min="10"
                max="100"
                step="5"
                value=${speed}
                onInput=${(event) => handleNumberChange('air_exchange__speed', event.target.value)}
              />
            </div>
          `,
        )
      }
      case 'light': {
        return modalBase(
          'Lighting Plan',
          html`
            <div className="input-group">
              <label for="sunriseSelect">Sunrise</label>
              <select
                id="sunriseSelect"
                value=${lightsSunrise}
                onChange=${(event) => handleNumberChange('lights__sunrise_hour', event.target.value)}
              >
                ${Array.from({ length: 48 }, (_, index) => index * 0.5).map(
                  (value) => html`<option value=${value}>${formatTime(value)}</option>`,
                )}
              </select>
            </div>
            <div className="input-group">
              <label for="lightDuration">Duration (hours)</label>
              <input
                id="lightDuration"
                type="number"
                min="1"
                max="24"
                step="0.25"
                value=${lightsDuration}
                onInput=${(event) => handleNumberChange('lights__duration__hours_', event.target.value)}
              />
            </div>
            <div className="input-group">
              <label for="canopyLux">Canopy brightness (lux)</label>
              <input
                id="canopyLux"
                type="number"
                min="0"
                max="4000"
                step="10"
                value=${luxValue}
                onInput=${(event) => handleNumberChange('white_led_intensity', event.target.value)}
              />
            </div>
            <div className="input-group">
              <label for="accentColor">Accent color</label>
              <input
                id="accentColor"
                type="color"
                value=${currentColor}
                onInput=${(event) => {
                  const rgb = hexToRgb(event.target.value)
                  handleNumberChange('red_led_intensity', rgb.r)
                  handleNumberChange('green_led_intensity', rgb.g)
                  handleNumberChange('blue_led_intensity', rgb.b)
                }}
              />
            </div>
          `,
        )
      }
      case 'water': {
        const calibrated = getBoolean('binary_sensor', 'water_calibrated')
            return modalBase(
          'Water Reservoir Calibration',
          html`
            <p>Empty and dry the water reservoir, then start the calibration routine.</p>
            ${calibrationStatus
              ? html`<p className="field-note">Current status: ${calibrationStatus}</p>`
              : null}
            <button
              className="primary-button"
              onClick=${() => {
                handleButtonClick('calibrate_dry_tank')
                setTimeout(() => {
                  handleButtonClick('calibrate_dry_tank')
                  setCalibrationSuccess(true)
                  setTimeout(() => setCalibrationSuccess(false), 8000)
                }, 500)
              }}
            >
              Calibrate empty reservoir
            </button>
            ${calibrationSuccess
              ? html`<div className="success-banner">Calibration request sent.</div>`
              : calibrated
              ? html`<div className="info-banner positive">Sensor calibrated recently.</div>`
              : html`<div className="info-banner warning">Calibration recommended for accurate readings.</div>`}
          `,
        )
      }
      case 'settings': {
        return modalBase(
          'Device Settings & Maintenance',
          html`
            <section className="settings-section">
              <h3>System</h3>
              <div className="info-grid">
                <div className="info-row">
                  <span className="info-label">Input voltage</span>
                  <span className="info-value">${voltageDisplay}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Last snapshot</span>
                  <span className="info-value">${lastUpdateDisplay}</span>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h3>Network</h3>
              <div className="info-grid">
                <div className="info-row">
                  <span className="info-label">Mode</span>
                  <span className="info-value">${wifiMode}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">SSID</span>
                  <span className="info-value">${wifiSSID}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Device IP</span>
                  <span className="info-value">${ipAddress}</span>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h3>Time & locale</h3>
              <div className="input-group">
                <label for="timezoneSelect">Timezone</label>
                <select id="timezoneSelect" value=${timezone} onChange=${(event) => handleTimezoneChange(event.target.value)}>
                  ${TIMEZONE_OPTIONS.map((tz) => html`<option value=${tz.value}>${tz.label}</option>`)}
                </select>
              </div>
            </section>
            <section className="settings-section">
              <h3>Licenses</h3>
              <div className="input-group">
                <label>Open-source notices</label>
                <button className="chip-button" onClick=${() => setShowLicense((prev) => !prev)}>
                  ${showLicense ? 'Hide licenses' : 'Show licenses'}
                </button>
                ${showLicense ? html`<pre className="license-log">${licensesText}</pre>` : null}
              </div>
            </section>
            <section className="settings-section">
              <h3>Firmware update (OTA)</h3>
              <div className="input-group">
                <input
                  type="file"
                  accept=".bin"
                  disabled=${otaStatus === 'uploading'}
                  onChange=${(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      setOtaFile(file)
                      setOtaStatus('idle')
                      setOtaMessage('')
                    }
                  }}
                />
                ${otaFile
                  ? html`<p className="file-helper">${otaFile.name} · ${(otaFile.size / (1024 * 1024)).toFixed(2)} MB</p>`
                  : null}
                <div className="button-row">
                  <button
                    className="primary-button"
                    disabled=${!otaFile || otaStatus === 'uploading'}
                    onClick=${handleOtaUpload}
                  >
                    ${otaStatus === 'uploading' ? 'Uploading…' : 'Upload firmware'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled=${otaStatus === 'uploading'}
                    onClick=${() => {
                      setOtaFile(null)
                      setOtaStatus('idle')
                      setOtaProgress(0)
                      setOtaMessage('')
                    }}
                  >
                    Clear selection
                  </button>
                </div>
                ${otaStatus !== 'idle' ? html`<p className="status-text ${otaStatus}">${otaMessage}</p>` : null}
                ${otaStatus === 'uploading'
                  ? html`<div className="progress"><div style=${{ width: `${otaProgress}%` }}></div></div>`
                  : null}
              </div>
            </section>
          `,
        )
      }
      default:
        return null
    }
  }

  return html`
    <div className="app-shell">
      <header className="shell-header">
        <div className="header-brand">
          <h1>OpenShrooly</h1>
          <p>Live grow environment at a glance — ${connectionMeta.label} mode</p>
        </div>
        <div className="header-actions">
          <span className=${`connection-pill ${connectionMeta.tone}`}>
            <span className="pill-indicator"></span>${connectionMeta.label}
          </span>
          <button className="ghost-button" onClick=${manualRefresh}>Sync now</button>
          <select className="header-select" value=${timezone} onChange=${(event) => handleTimezoneChange(event.target.value)}>
            ${TIMEZONE_OPTIONS.map((tz) => html`<option value=${tz.value}>${tz.label}</option>`)}
          </select>
        </div>
      </header>

      <p className="connection-help">${connection.detail || connectionMeta.detail}</p>

      ${banner
        ? html`<div className=${`info-banner ${banner.tone}`}>${banner.message}</div>`
        : null}

      ${alerts.length
        ? html`<div className="alert-stack">
            ${alerts.map((alert) => html`<div className="alert-item">⚠️ ${alert.msg}</div>`)}
          </div>`
        : null}

      <main className="layout-grid">
        <section className="panel stretch">
          <header className="panel-header">
            <h2>Environment snapshot</h2>
            <span>Last update ${lastUpdate ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'} · ${timezoneLabel}</span>
          </header>
          <div className="metric-grid">
            <${SensorCard}
              icon="💧"
              title="Humidity"
              value=${humidity.toFixed(1)}
              unit="%"
              caption=${`Target ${targetHumidity.toFixed(1)}% · ±${humidityHysteresis.toFixed(2)}%`}
              tone=${Math.abs(humidity - targetHumidity) <= humidityHysteresis ? 'positive' : 'warning'}
              onClick=${() => setModal('humidity')}
            />
            <${SensorCard}
              icon="🌡️"
              title="Temperature"
              value=${temperature.toFixed(1)}
              unit="°C"
              caption=${tempControlEnabled ? `Comfort band ${tempMin.toFixed(1)}°–${tempMax.toFixed(1)}°` : 'Guard disabled'}
              tone=${tempControlEnabled ? (temperature >= tempMin && temperature <= tempMax ? 'positive' : 'warning') : 'calm'}
              onClick=${() => setModal('temperature')}
            />
            <${SensorCard}
              icon="🚰"
              title="Water level"
              value=${waterLevel.toFixed(0)}
              unit="%"
              caption=${calibrationSuccess ? 'Calibration requested' : 'Tap to calibrate'}
              tone=${waterLevel < 10 ? 'critical' : waterLevel < 25 ? 'warning' : 'calm'}
              onClick=${() => setModal('water')}
            />
            <${SensorCard}
              icon="💡"
              title="Lighting"
              value=${lightsOn ? 'ON' : 'OFF'}
              caption=${`Sunrise ${formatTime(lightsSunrise)} · Sunset ${formatTime(lightsSunset)} · ${luxValue} lux`}
              tone=${lightsOn ? 'positive' : 'calm'}
              onClick=${() => setModal('light')}
            />
          </div>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>Automation status</h2>
            <span>Tap a tile to manage</span>
          </header>
          <div className="status-grid">
            <${StatusCard}
              icon="🌀"
              title="Humidifier"
              status=${humidifierOn ? 'on' : 'off'}
              detail=${humidifierOn ? 'Maintaining humidity band' : 'Standby'}
              onClick=${() => handleSwitchChange('humidifier', !humidifierOn)}
            />
            <${StatusCard}
              icon="🌬️"
              title="Air exchange"
              status=${airExchangeOn ? 'on' : 'off'}
              detail=${airExchangeOn ? 'Cycling fresh air' : 'Idle'}
              onClick=${() => setModal('air')}
            />
            <${StatusCard}
              icon="🔥"
              title="Heat assist"
              status=${heatRequested ? 'on' : 'off'}
              detail=${tempControlEnabled ? 'Guard is active' : 'Guard disabled'}
              onClick=${() => setModal('temperature')}
            />
            <${StatusCard}
              icon="📡"
              title="BLE service"
              status=${bleEnabled ? 'on' : 'off'}
              detail=${bleEnabled ? 'Paired devices can read sensors' : 'Broadcast disabled by default'}
              onClick=${() => handleSwitchChange('ble_enabled', !bleEnabled)}
            />
          </div>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>Quick controls</h2>
            <span>Immediate actions</span>
          </header>
          <div className="control-grid">
            <label className="control-toggle">
              <input type="checkbox" checked=${humidifierOn} onChange=${(event) => handleSwitchChange('humidifier', event.target.checked)} />
              <span>Humidifier</span>
            </label>
            <label className="control-toggle">
              <input type="checkbox" checked=${airExchangeOn} onChange=${(event) => handleSwitchChange('air_exchange', event.target.checked)} />
              <span>Air exchange</span>
            </label>
            <label className="control-toggle">
              <input type="checkbox" checked=${bleEnabled} onChange=${(event) => handleSwitchChange('ble_enabled', event.target.checked)} />
              <span>BLE service</span>
            </label>
            <button className="secondary-button" onClick=${() => setModal('settings')}>Open settings & OTA</button>
          </div>
        </section>
      </main>

      ${renderModal()}
    </div>
  `
}
