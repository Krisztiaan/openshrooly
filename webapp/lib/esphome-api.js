const DEFAULT_NUMBER_IDS = [
  'target_humidity',
  'humidifier__speed',
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
      eventSource.onerror = (error) => console.error('EventSource error', error)
      return eventSource
    } catch (error) {
      console.error('EventSource setup failed', error)
      return null
    }
  }
}

export const api = new ESPHomeAPI()
export { ESPHomeAPI }
