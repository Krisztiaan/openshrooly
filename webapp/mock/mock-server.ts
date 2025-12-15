import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PluginOption } from 'vite'

type NumberEntity = {
  value: number
  state: number
  unit_of_measurement?: string
  step?: number
}

type SwitchEntity = {
  state: boolean
}

type SensorEntity = {
  state: number
  value?: number
  unit_of_measurement?: string
  last_changed?: string
}

type BinarySensorEntity = {
  state: boolean
}

type TextSensorEntity = {
  state: string
}

type SelectEntity = {
  state: string
  options: string[]
}

type MockState = {
  numbers: Record<string, NumberEntity>
  switches: Record<string, SwitchEntity>
  sensors: Record<string, SensorEntity>
  binarySensors: Record<string, BinarySensorEntity>
  textSensors: Record<string, TextSensorEntity>
  selects: Record<string, SelectEntity>
}

const state: MockState = createInitialState()

const sseClients = new Set<ServerResponse>()
const heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>()

let ticker: NodeJS.Timeout | null = null
let flapper: NodeJS.Timeout | null = null

const HEARTBEAT_INTERVAL_MS = 15000

function createInitialState(): MockState {
  const now = new Date().toISOString()
  return {
    numbers: {
      target_humidity: { value: 68, state: 68, unit_of_measurement: '%', step: 0.5 },
      humidity__hysteresis: { value: 2, state: 2, unit_of_measurement: '%', step: 0.5 },
      humidifier__speed: { value: 75, state: 75, unit_of_measurement: '%', step: 1 },
      temperature__target: { value: 23, state: 23, unit_of_measurement: '°C', step: 0.5 },
      temperature__hysteresis: { value: 1.5, state: 1.5, unit_of_measurement: '°C', step: 0.1 },
      temperature__minimum: { value: 22, state: 22, unit_of_measurement: '°C', step: 0.5 },
      temperature__maximum: { value: 25, state: 25, unit_of_measurement: '°C', step: 0.5 },
      temperature__warning_minimum: { value: 18, state: 18, unit_of_measurement: '°C', step: 0.5 },
      temperature__warning_maximum: { value: 30, state: 30, unit_of_measurement: '°C', step: 0.5 },
      temperature__vent_holdoff_minutes: { value: 5, state: 5, unit_of_measurement: 'min', step: 1 },
      air_exchange__cycle_minutes: { value: 30, state: 30, unit_of_measurement: 'min', step: 1 },
      air_exchange__run_minutes: { value: 5, state: 5, unit_of_measurement: 'min', step: 1 },
      air_exchange__target_rpm: { value: 850, state: 850, unit_of_measurement: 'RPM', step: 50 },
      air_exchange__holdoff_minutes: { value: 10, state: 10, unit_of_measurement: 'min', step: 1 },
      air_exchange__boost_threshold: { value: 2, state: 2, unit_of_measurement: '%', step: 0.5 },
      air_exchange__period__min_: { value: 45, state: 45, unit_of_measurement: 'min', step: 1 },
      air_exchange__run_duration__s_: { value: 420, state: 420, unit_of_measurement: 's', step: 10 },
      air_exchange__speed: { value: 60, state: 60, unit_of_measurement: '%', step: 1 },
      lights__sunrise_hour: { value: 8, state: 8, unit_of_measurement: 'h', step: 1 },
      lights__duration__hours_: { value: 12, state: 12, unit_of_measurement: 'h', step: 1 },
      white_led_intensity: { value: 80, state: 80, unit_of_measurement: '%', step: 5 },
      red_led_intensity: { value: 0, state: 0, unit_of_measurement: '%', step: 5 },
      green_led_intensity: { value: 0, state: 0, unit_of_measurement: '%', step: 5 },
      blue_led_intensity: { value: 0, state: 0, unit_of_measurement: '%', step: 5 },
    },
    switches: {
      humidifier: { state: true },
      air_exchange: { state: true },
      temperature_control_enabled: { state: true },
      ble_enabled: { state: false },
    },
    sensors: {
      temperature: { state: 23.2, value: 23.2, unit_of_measurement: '°C', last_changed: now },
      current_temperature: { state: 23.2, value: 23.2, unit_of_measurement: '°C', last_changed: now },
      humidity: { state: 67.4, value: 67.4, unit_of_measurement: '%', last_changed: now },
      current_humidity: { state: 67.4, value: 67.4, unit_of_measurement: '%', last_changed: now },
      water_level_percent: { state: 82, value: 82, unit_of_measurement: '%', last_changed: now },
      water_level: { state: 5, value: 5, unit_of_measurement: 'L' },
      system_voltage: { state: 5.1, value: 5.1, unit_of_measurement: 'V' },
      current_air_exchange_fan_speed: { state: 630, value: 630, unit_of_measurement: 'RPM' },
      illuminance: { state: 325, value: 325, unit_of_measurement: 'lx' },
    },
    binarySensors: {
      humidifier_on: { state: true },
      air_exchange_on: { state: true },
      heat_requested: { state: false },
      water_calibrated: { state: true },
      'alert__humidity_control_failure': { state: false },
      'alert__i2c_communication_failure': { state: false },
      'alert__fan_start_failure': { state: false },
      'alert__temperature_too_low': { state: false },
      'alert__temperature_too_high': { state: false },
    },
    textSensors: {
      licenses: { state: 'OpenShrooly Firmware v0.9' },
      wifi_mode: { state: 'Station' },
      wifi_ssid: { state: 'MyceliumNet' },
      ip_address: { state: '192.168.1.42' },
      calibration_status: { state: 'Calibrated 3 days ago' },
      air_exchange_status: { state: 'Cycling fresh air' },
      lights_status: { state: 'Daylight scene active' },
      humidifier_fan_status: { state: 'Nominal' },
    },
    selects: {
      timezone_select: {
        state: 'America/Los_Angeles',
        options: [
          'America/Los_Angeles',
          'America/New_York',
          'Europe/London',
          'Europe/Berlin',
          'Asia/Tokyo',
        ],
      },
      lighting_mode: {
        state: 'daylight',
        options: ['daylight', 'evening', 'sleep'],
      },
    },
  }
}

function jitter(value: number, variance: number, digits = 2) {
  const delta = (Math.random() * 2 - 1) * variance
  return Number((value + delta).toFixed(digits))
}

function randomToggle(probability: number) {
  return Math.random() < probability
}

function updateDynamicState() {
  const now = new Date().toISOString()
  state.sensors.temperature.state = jitter(state.sensors.temperature.state ?? 23, 0.6, 2)
  state.sensors.temperature.value = state.sensors.temperature.state
  state.sensors.temperature.last_changed = now

  state.sensors.current_temperature.state = state.sensors.temperature.state
  state.sensors.current_temperature.value = state.sensors.temperature.value
  state.sensors.current_temperature.last_changed = now

  state.sensors.humidity.state = jitter(state.sensors.humidity.state ?? 65, 1.5, 1)
  state.sensors.humidity.value = state.sensors.humidity.state
  state.sensors.humidity.last_changed = now

  state.sensors.current_humidity.state = state.sensors.humidity.state
  state.sensors.current_humidity.value = state.sensors.humidity.value
  state.sensors.current_humidity.last_changed = now

  state.sensors.water_level_percent.state = Math.max(
    40,
    Math.min(95, jitter(state.sensors.water_level_percent.state ?? 80, 5, 0)),
  )
  state.sensors.water_level_percent.value = state.sensors.water_level_percent.state
  state.sensors.water_level_percent.last_changed = now

  state.sensors.current_air_exchange_fan_speed.state = Math.max(
    400,
    Math.min(1200, jitter(state.sensors.current_air_exchange_fan_speed.state ?? 650, 80, 0)),
  )
  state.sensors.current_air_exchange_fan_speed.value =
    state.sensors.current_air_exchange_fan_speed.state

  state.sensors.illuminance.state = Math.max(
    200,
    Math.min(800, jitter(state.sensors.illuminance.state ?? 500, 60, 0)),
  )
  state.sensors.illuminance.value = state.sensors.illuminance.state

  state.sensors.system_voltage.state = jitter(state.sensors.system_voltage.state ?? 5.1, 0.05, 2)
  state.sensors.system_voltage.value = state.sensors.system_voltage.state

  if (randomToggle(0.1)) {
    state.switches.humidifier.state = !state.switches.humidifier.state
    sendSseUpdate({ id: 'switch-humidifier', state: state.switches.humidifier.state })
  }
  if (randomToggle(0.05)) {
    state.switches.air_exchange.state = !state.switches.air_exchange.state
    sendSseUpdate({ id: 'switch-air_exchange', state: state.switches.air_exchange.state })
  }

  const humidityDetail =
    state.switches.humidifier.state && state.sensors.humidity.state > state.numbers.target_humidity.state
      ? 'Humidifying'
      : 'Stable humidity'
  state.textSensors.humidifier_fan_status.state = `${humidityDetail} · ${state.numbers.humidifier__speed.state.toFixed(
    0,
  )}%`

  state.textSensors.air_exchange_status.state = state.switches.air_exchange.state
    ? `Cycling · ${state.numbers.air_exchange__cycle_minutes.state.toFixed(0)} min`
    : 'Idle cycle'

  const lightMode = state.selects.lighting_mode?.state ?? 'daylight'
  state.textSensors.lights_status.state =
    lightMode === 'daylight' ? 'Daylight scene active' : lightMode === 'evening' ? 'Evening ambience' : 'Sleep mode'

  sendSseUpdate({ id: 'text_sensor-air_exchange_status', state: state.textSensors.air_exchange_status.state })
  sendSseUpdate({ id: 'text_sensor-humidifier_fan_status', state: state.textSensors.humidifier_fan_status.state })
  sendSseUpdate({ id: 'text_sensor-lights_status', state: state.textSensors.lights_status.state })

  const newAlerts = randomToggle(0.08)
  Object.keys(state.binarySensors).forEach((key) => {
    if (key.startsWith('alert__')) {
      const active = newAlerts ? randomToggle(0.3) : false
      if (state.binarySensors[key].state !== active) {
        state.binarySensors[key].state = active
        sendSseUpdate({ id: `binary_sensor-${key}`, state: active })
      }
    }
  })

  sendSseUpdate({ id: 'sensor-temperature', state: state.sensors.temperature.state })
  sendSseUpdate({ id: 'sensor-humidity', state: state.sensors.humidity.state })
  sendSseUpdate({ id: 'sensor-current_temperature', state: state.sensors.current_temperature.state })
  sendSseUpdate({ id: 'sensor-current_humidity', state: state.sensors.current_humidity.state })
  sendSseUpdate({
    id: 'sensor-current_air_exchange_fan_speed',
    state: state.sensors.current_air_exchange_fan_speed.state,
  })
  sendSseUpdate({ id: 'sensor-illuminance', state: state.sensors.illuminance.state })
  sendSseUpdate({ id: 'sensor-water_level_percent', state: state.sensors.water_level_percent.state })
  sendSseUpdate({ id: 'sensor-system_voltage', state: state.sensors.system_voltage.state })
}

function ensureTicker() {
  if (!ticker) {
    ticker = setInterval(() => {
      const now = Date.now()
      const nextTemp = 23.1 + Math.sin(now / 60000) * 0.8
      const rounded = Number(nextTemp.toFixed(2))
      state.sensors.temperature.state = rounded
      state.sensors.temperature.value = rounded
      state.sensors.temperature.last_changed = new Date().toISOString()
      sendSseUpdate({ id: 'sensor-temperature', state: rounded })
    }, 15000)
  }
  if (!flapper) {
    flapper = setInterval(() => {
      updateDynamicState()
    }, 6000)
  }
}

function writeSse(res: ServerResponse, event: string, payload: Record<string, unknown>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function cleanupSseClient(res: ServerResponse) {
  const heartbeat = heartbeatTimers.get(res)
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeatTimers.delete(res)
  }
  sseClients.delete(res)
  if (!res.writableEnded) {
    try {
      res.end()
    } catch {
      // ignore shutdown errors
    }
  }
}

function sendSseUpdate(payload: Record<string, unknown>) {
  if (!payload || typeof payload.id !== 'string') return
  const normalized: Record<string, unknown> = { ...payload }
  if (normalized.value === undefined) {
    normalized.value = normalized.state
  }

  sseClients.forEach((res) => {
    try {
      writeSse(res, 'state', normalized)
    } catch (error) {
      cleanupSseClient(res)
    }
  })
}

function resolveEntity<T>(collection: Record<string, T>, id: string | undefined): T | null {
  if (!id) return null
  const entity = collection[id]
  if (!entity) return null
  return entity
}

function sendJson(res: ServerResponse, body: unknown, status = 200) {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function sendStatus(res: ServerResponse, status = 200) {
  if (res.writableEnded) return
  res.statusCode = status
  res.end()
}

function pushSnapshotToClient(res: ServerResponse) {
  const emit = (payload: Record<string, unknown>) => {
    if (!sseClients.has(res) || res.writableEnded) return
    try {
      writeSse(res, 'state', payload)
    } catch (error) {
      cleanupSseClient(res)
    }
  }

  Object.entries(state.numbers).forEach(([id, entity]) => {
    emit({ id: `number-${id}`, state: entity.state, value: entity.value, attributes: entity })
  })
  Object.entries(state.switches).forEach(([id, entity]) => {
    emit({ id: `switch-${id}`, state: entity.state, value: entity.state })
  })
  Object.entries(state.sensors).forEach(([id, entity]) => {
    emit({ id: `sensor-${id}`, state: entity.state, value: entity.value ?? entity.state, attributes: entity })
  })
  Object.entries(state.binarySensors).forEach(([id, entity]) => {
    emit({ id: `binary_sensor-${id}`, state: entity.state, value: entity.state })
  })
  Object.entries(state.textSensors).forEach(([id, entity]) => {
    emit({ id: `text_sensor-${id}`, state: entity.state, value: entity.state })
  })
  Object.entries(state.selects).forEach(([id, entity]) => {
    emit({ id: `select-${id}`, state: entity.state, value: entity.state, attributes: { options: entity.options } })
  })
}

function handleJsonSnapshot(res: ServerResponse) {
  const components: Array<Record<string, unknown>> = []

  Object.entries(state.numbers).forEach(([id, entity]) => {
    components.push({ component: 'number', id, state: entity.state, attributes: entity })
  })
  Object.entries(state.switches).forEach(([id, entity]) => {
    components.push({ component: 'switch', id, state: entity.state })
  })
  Object.entries(state.sensors).forEach(([id, entity]) => {
    components.push({ component: 'sensor', id, state: entity.state, attributes: entity })
  })
  Object.entries(state.binarySensors).forEach(([id, entity]) => {
    components.push({ component: 'binary_sensor', id, state: entity.state })
  })
  Object.entries(state.textSensors).forEach(([id, entity]) => {
    components.push({ component: 'text_sensor', id, state: entity.state })
  })
  Object.entries(state.selects).forEach(([id, entity]) => {
    components.push({
      component: 'select',
      id,
      state: entity.state,
      attributes: { options: entity.options },
    })
  })

  sendJson(res, { components })
}

function updateNumber(id: string | undefined, value: string | null): boolean {
  if (!id || value == null) return false
  const entity = state.numbers[id]
  if (!entity) return false
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return false
  entity.value = parsed
  entity.state = parsed
  sendSseUpdate({ id: `number-${id}`, state: parsed })
  return true
}

function updateSwitch(id: string | undefined, on: boolean): boolean {
  if (!id) return false
  const entity = state.switches[id]
  if (!entity) return false
  entity.state = on
  sendSseUpdate({ id: `switch-${id}`, state: on })
  return true
}

function updateSelect(id: string | undefined, option: string | null): boolean {
  if (!id || option == null) return false
  const entity = state.selects[id]
  if (!entity) return false
  if (!entity.options.includes(option)) return false
  entity.state = option
  sendSseUpdate({ id: `select-${id}`, state: option })
  return true
}

function handleSse(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  if (typeof (res as any).flushHeaders === 'function') {
    ;(res as any).flushHeaders()
  }
  res.write('retry: 5000\n\n')

  sseClients.add(res)

  const heartbeat = setInterval(() => {
    if (!sseClients.has(res) || res.writableEnded) {
      cleanupSseClient(res)
      return
    }
    try {
      writeSse(res, 'ping', { ts: Date.now() })
    } catch (error) {
      cleanupSseClient(res)
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeatTimers.set(res, heartbeat)

  pushSnapshotToClient(res)

  const teardown = () => cleanupSseClient(res)
  req.on('close', teardown)
  req.on('error', teardown)
  res.on('close', teardown)
  res.on('error', teardown)
}

function handleApiRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url) return false
  const requestUrl = new URL(req.url, 'http://localhost')
  const pathname = requestUrl.pathname
  const segments = pathname.split('/').filter(Boolean)

  if (pathname === '/json') {
    handleJsonSnapshot(res)
    return true
  }

  if (pathname === '/events') {
    handleSse(req, res)
    return true
  }

  if (segments.length === 0) {
    return false
  }

  const [category, id, action] = segments

  switch (category) {
    case 'sensor': {
      const entity = resolveEntity(state.sensors, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'number': {
      if (action === 'set' && req.method === 'POST') {
        const ok = updateNumber(id, requestUrl.searchParams.get('value'))
        sendStatus(res, ok ? 200 : 400)
        return true
      }
      const entity = resolveEntity(state.numbers, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'switch': {
      if (action === 'turn_on' && req.method === 'POST') {
        const ok = updateSwitch(id, true)
        sendStatus(res, ok ? 200 : 400)
        return true
      }
      if (action === 'turn_off' && req.method === 'POST') {
        const ok = updateSwitch(id, false)
        sendStatus(res, ok ? 200 : 400)
        return true
      }
      const entity = resolveEntity(state.switches, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'binary_sensor': {
      const entity = resolveEntity(state.binarySensors, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'text_sensor': {
      const entity = resolveEntity(state.textSensors, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'select': {
      if (action === 'set' && req.method === 'POST') {
        const ok = updateSelect(id, requestUrl.searchParams.get('option'))
        sendStatus(res, ok ? 200 : 400)
        return true
      }
      const entity = resolveEntity(state.selects, id)
      if (!entity) {
        sendStatus(res, 404)
      } else {
        sendJson(res, entity)
      }
      return true
    }
    case 'button': {
      if (action === 'press' && req.method === 'POST') {
        sendStatus(res, 200)
        return true
      }
      return true
    }
    default:
      return false
  }
}

export function mockApiPlugin(): PluginOption {
  ensureTicker()
  updateDynamicState()

  return {
    name: 'mock-esphome-api',
    configureServer(server) {
      const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (handleApiRequest(req, res)) {
          return
        }
        next()
      }

      const stack = (server.middlewares as any).stack
      if (Array.isArray(stack)) {
        stack.unshift({ route: '', handle: handler })
      } else {
        server.middlewares.use(handler as any)
      }

      server.httpServer?.once('close', () => {
        if (ticker) {
          clearInterval(ticker)
          ticker = null
        }
        if (flapper) {
          clearInterval(flapper)
          flapper = null
        }
        heartbeatTimers.forEach((timer) => clearInterval(timer))
        heartbeatTimers.clear()
        Array.from(sseClients).forEach((client) => {
          cleanupSseClient(client)
        })
      })
    },
  }
}
