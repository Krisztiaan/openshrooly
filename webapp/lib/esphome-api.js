const DEFAULT_NUMBER_IDS = [
  'target_humidity',
  'humidity__hysteresis',
  'humidifier__speed',
  'temperature__target',
  'temperature__hysteresis',
  'temperature__minimum',
  'temperature__maximum',
  'air_exchange__period__min_',
  'air_exchange__run_duration__s_',
  'air_exchange__speed',
  'lights__sunrise_hour',
  'lights__duration__hours_',
  'white_led_intensity',
  'red_led_intensity',
  'green_led_intensity',
  'blue_led_intensity',
]

const DEFAULT_SWITCH_IDS = ['humidifier', 'air_exchange', 'temperature_control_enabled', 'ble_enabled']
const DEFAULT_BINARY_SENSOR_IDS = [
  'humidifier_on',
  'air_exchange_on',
  'heat_requested',
  'water_calibrated',
  'alert__humidity_control_failure',
  'alert__i2c_communication_failure',
  'alert__fan_start_failure',
  'alert__temperature_too_low',
  'alert__temperature_too_high',
]
const DEFAULT_TEXT_SENSOR_IDS = ['licenses']

class ESPHomeAPI {
  constructor(baseUrl = null) {
    this.baseUrl = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  }

  async _get(path) {
    try {
      const response = await fetch(`${this.baseUrl}${path}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`GET ${path} failed`, error)
      return null
    }
  }

  async _post(path) {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST' })
      return response.ok
    } catch (error) {
      console.error(`POST ${path} failed`, error)
      return false
    }
  }

  getSensor(id) {
    return this._get(`/sensor/${id}`)
  }

  getSwitch(id) {
    return this._get(`/switch/${id}`)
  }

  async getSwitchStates(ids = DEFAULT_SWITCH_IDS) {
    const results = await Promise.all(ids.map((id) => this.getSwitch(id)))
    const switches = {}
    results.forEach((result, index) => {
      if (result) switches[`switch-${ids[index]}`] = result
    })
    return switches
  }

  getNumber(id) {
    return this._get(`/number/${id}`)
  }

  setNumber(id, value) {
    return this._post(`/number/${id}/set?value=${encodeURIComponent(value)}`)
  }

  setSwitch(id, state) {
    const action = state ? 'turn_on' : 'turn_off'
    return this._post(`/switch/${id}/${action}`)
  }

  getAllSensors() {
    return Promise.all([
      this.getSensor('temperature'),
      this.getSensor('humidity'),
      this.getSensor('water_level_percent'),
    ]).then(([temperature, humidity, waterLevel]) => ({
      temperature: temperature || undefined,
      humidity: humidity || undefined,
      water_level: waterLevel || undefined,
    }))
  }

  async getAllNumbers(ids = DEFAULT_NUMBER_IDS) {
    const results = await Promise.all(ids.map((id) => this.getNumber(id)))
    const numbers = {}
    results.forEach((result, index) => {
      if (result) numbers[`number-${ids[index]}`] = result
    })
    return numbers
  }

  pressButton(id) {
    return this._post(`/button/${id}/press`)
  }

  getSelect(id) {
    return this._get(`/select/${id}`)
  }

  setSelect(id, value) {
    return this._post(`/select/${id}/set?option=${encodeURIComponent(value)}`)
  }

  getBinarySensor(id) {
    return this._get(`/binary_sensor/${id}`)
  }

  async getBinarySensors(ids = DEFAULT_BINARY_SENSOR_IDS) {
    const results = await Promise.all(ids.map((id) => this.getBinarySensor(id)))
    const sensors = {}
    results.forEach((result, index) => {
      if (result) sensors[`binary_sensor-${ids[index]}`] = result
    })
    return sensors
  }

  getTextSensor(id) {
    return this._get(`/text_sensor/${id}`)
  }

  async getTextSensors(ids = DEFAULT_TEXT_SENSOR_IDS) {
    const results = await Promise.all(ids.map((id) => this.getTextSensor(id)))
    const sensors = {}
    results.forEach((result, index) => {
      if (result) sensors[`text_sensor-${ids[index]}`] = result
    })
    return sensors
  }

  async fetchSnapshot({
    numberIds = DEFAULT_NUMBER_IDS,
    switchIds = DEFAULT_SWITCH_IDS,
    sensorIds = ['temperature', 'current_temperature', 'humidity', 'current_humidity', 'water_level_percent', 'water_level'],
    binarySensorIds = DEFAULT_BINARY_SENSOR_IDS,
    textSensorIds = DEFAULT_TEXT_SENSOR_IDS,
    selectIds = ['timezone_select'],
  } = {}) {
    const [numbers, switches, sensors, binarySensors, textSensors, selects] = await Promise.all([
      this.getAllNumbers(numberIds),
      this.getSwitchStates(switchIds),
      Promise.all(sensorIds.map((id) => this.getSensor(id))).then((values) => {
        const out = {}
        values.forEach((value, idx) => {
          if (value) out[`sensor-${sensorIds[idx]}`] = value
        })
        return out
      }),
      this.getBinarySensors(binarySensorIds),
      this.getTextSensors(textSensorIds),
      Promise.all(selectIds.map((id) => this.getSelect(id))).then((values) => {
        const out = {}
        values.forEach((value, idx) => {
          if (value) out[`select-${selectIds[idx]}`] = value
        })
        return out
      }),
    ])

    return {
      ...numbers,
      ...switches,
      ...sensors,
      ...binarySensors,
      ...textSensors,
      ...selects,
    }
  }

  subscribeToEvents(onEvent) {
    try {
      const eventSource = new EventSource(`${this.baseUrl}/events`)
      eventSource.addEventListener('state', (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.id) onEvent(data)
        } catch (error) {
          console.error('Event parse failed', error)
        }
      })
      return eventSource
    } catch (error) {
      console.error('EventSource setup failed', error)
      return null
    }
  }
}

export const api = new ESPHomeAPI()
export { ESPHomeAPI }
