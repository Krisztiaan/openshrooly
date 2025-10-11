#!/usr/bin/env node
// Lightweight dev server for the no-build dashboard.
// Serves assets from ./webapp and mimics ESPHome JSON endpoints.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const url = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const WEBAPP_DIR = path.join(ROOT, 'webapp')
const PORT = Number(process.env.PORT || 4000)

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/** @type {{
 *   numbers: Record<string,{value:number, state:number, step?:number, unit_of_measurement?:string}>,
 *   switches: Record<string,{state:boolean}>,
 *   sensors: Record<string,{state:number,value?:number,unit_of_measurement?:string,last_changed?:string}>,
 *   binarySensors: Record<string,{state:boolean}>,
 *   textSensors: Record<string,{state:string}>,
 *   selects: Record<string,{state:string, options:string[]}>,
 * }}
 */
const state = {
  numbers: {
    target_humidity: { value: 68, state: 68, unit_of_measurement: '%', step: 0.5 },
    humidity__hysteresis: { value: 2, state: 2, unit_of_measurement: '%', step: 0.5 },
    humidifier__speed: { value: 75, state: 75, unit_of_measurement: '%', step: 1 },
    temperature__target: { value: 23, state: 23, unit_of_measurement: '°C', step: 0.5 },
    temperature__hysteresis: { value: 1.5, state: 1.5, unit_of_measurement: '°C', step: 0.1 },
    temperature__minimum: { value: 22, state: 22, unit_of_measurement: '°C', step: 0.5 },
    temperature__maximum: { value: 25, state: 25, unit_of_measurement: '°C', step: 0.5 },
    air_exchange__period__min_: { value: 45, state: 45, unit_of_measurement: 'min', step: 1 },
    air_exchange__run_duration__s_: { value: 420, state: 420, unit_of_measurement: 's', step: 10 },
    air_exchange__speed: { value: 60, state: 60, unit_of_measurement: '%', step: 1 },
    lights__sunrise_hour: { value: 8, state: 8, unit_of_measurement: 'h', step: 1 },
    lights__duration__hours_: { value: 12, state: 12, unit_of_measurement: 'h', step: 1 },
    white_led_intensity: { value: 80, state: 80, unit_of_measurement: '%', step: 5 },
  },
  switches: {
    humidifier: { state: true },
    air_exchange: { state: true },
    temperature_control_enabled: { state: true },
    ble_enabled: { state: false },
  },
  sensors: {
    temperature: { state: 23.2, value: 23.2, unit_of_measurement: '°C', last_changed: new Date().toISOString() },
    humidity: { state: 67.4, value: 67.4, unit_of_measurement: '%', last_changed: new Date().toISOString() },
    water_level_percent: { state: 82, value: 82, unit_of_measurement: '%', last_changed: new Date().toISOString() },
    system_voltage: { state: 5.1, value: 5.1, unit_of_measurement: 'V' },
    current_air_exchange_fan_speed: { state: 630, value: 630, unit_of_measurement: 'RPM' },
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
  },
}

const sseClients = new Set()

function sendSseUpdate(payload) {
  const message = `event: state\ndata: ${JSON.stringify(payload)}\n\n`
  sseClients.forEach((res) => {
    try {
      res.write(message)
    } catch (error) {
      sseClients.delete(res)
    }
  })
}

setInterval(() => {
  const now = Date.now()
  // Simulate small temp drift
  const nextTemp = 23.1 + Math.sin(now / 60000) * 0.8
  state.sensors.temperature.state = Number(nextTemp.toFixed(2))
  state.sensors.temperature.value = state.sensors.temperature.state
  sendSseUpdate({ id: 'sensor-temperature', state: state.sensors.temperature.state })
}, 15000)

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not found')
}

function handleJson(req, res) {
  const components = []

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
    components.push({ component: 'select', id, state: entity.state, attributes: { options: entity.options } })
  })

  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ components }))
}

function resolveEntity(collection, id) {
  const entity = collection[id]
  if (!entity) {
    return null
  }
  return entity
}

function sendEntity(res, entity) {
  if (!entity) {
    notFound(res)
    return
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(entity))
}

function updateNumber(id, value) {
  const entity = state.numbers[id]
  if (!entity) return false
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return false
  entity.value = parsed
  entity.state = parsed
  sendSseUpdate({ id: `number-${id}`, state: parsed })
  return true
}

function updateSwitch(id, turnOn) {
  const entity = state.switches[id]
  if (!entity) return false
  entity.state = Boolean(turnOn)
  sendSseUpdate({ id: `switch-${id}`, state: entity.state })
  return true
}

function updateSelect(id, option) {
  const entity = state.selects[id]
  if (!entity) return false
  if (!entity.options.includes(option)) return false
  entity.state = option
  sendSseUpdate({ id: `select-${id}`, state: option })
  return true
}

function handleApi(req, res) {
  const parsed = url.parse(req.url, true)
  const segments = parsed.pathname.split('/').filter(Boolean)

  if (parsed.pathname === '/json') {
    handleJson(req, res)
    return true
  }

  if (parsed.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('\n')
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return true
  }

  if (segments.length >= 2) {
    const [category, id] = segments
    switch (category) {
      case 'sensor':
        sendEntity(res, resolveEntity(state.sensors, id))
        return true
      case 'number':
        if (segments[2] === 'set' && req.method === 'POST') {
          const ok = updateNumber(id, parsed.query.value)
          res.writeHead(ok ? 200 : 400)
          res.end()
          return true
        }
        sendEntity(res, resolveEntity(state.numbers, id))
        return true
      case 'switch':
        if (segments[2] === 'turn_on' && req.method === 'POST') {
          const ok = updateSwitch(id, true)
          res.writeHead(ok ? 200 : 400)
          res.end()
          return true
        }
        if (segments[2] === 'turn_off' && req.method === 'POST') {
          const ok = updateSwitch(id, false)
          res.writeHead(ok ? 200 : 400)
          res.end()
          return true
        }
        sendEntity(res, resolveEntity(state.switches, id))
        return true
      case 'binary_sensor':
        sendEntity(res, resolveEntity(state.binarySensors, id))
        return true
      case 'text_sensor':
        sendEntity(res, resolveEntity(state.textSensors, id))
        return true
      case 'select':
        if (segments[2] === 'set' && req.method === 'POST') {
          const ok = updateSelect(id, parsed.query.option)
          res.writeHead(ok ? 200 : 400)
          res.end()
          return true
        }
        sendEntity(res, resolveEntity(state.selects, id))
        return true
      case 'button':
        if (segments[2] === 'press' && req.method === 'POST') {
          res.writeHead(200)
          res.end()
          return true
        }
        break
      default:
        break
    }
  }

  return false
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url)
  let pathname = decodeURIComponent(parsed.pathname)

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html'
  }

  const filePath = path.join(WEBAPP_DIR, pathname)
  if (!filePath.startsWith(WEBAPP_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      notFound(res)
      return
    }
    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': contentType })
    fs.createReadStream(filePath).pipe(res)
  })
}

const server = http.createServer((req, res) => {
  if (handleApi(req, res)) {
    return
  }
  serveStatic(req, res)
})

server.listen(PORT, () => {
  console.log(`Mock server running at http://localhost:${PORT}`)
  console.log('Serving ./webapp and mock ESPHome API endpoints')
})
