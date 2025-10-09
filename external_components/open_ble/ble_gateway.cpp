#include "ble_gateway.h"

#include "esphome/core/log.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <sstream>

#include "esp_gap_ble_api.h"
#include "esp_system.h"

namespace open_ble {

static const char *const TAG = "open_ble.gateway";

namespace {
constexpr size_t kMaxDigitalOutputsBits = 8;
}

class ServerCallbacks : public NimBLEServerCallbacks {
 public:
  explicit ServerCallbacks(OpenBleGateway *parent) : parent_(parent) {}

  void onConnect(NimBLEServer *server) override;
  void onConnect(NimBLEServer *server, ble_gap_conn_desc *desc) override;
  void onDisconnect(NimBLEServer *server) override;

 private:
  OpenBleGateway *parent_;
};

class SecurityCallbacks : public NimBLESecurityCallbacks {
 public:
  explicit SecurityCallbacks(OpenBleGateway *parent) : parent_(parent) {}

  uint32_t onPassKeyRequest() override;
  void onPassKeyNotify(uint32_t pass_key) override;
  bool onSecurityRequest() override;
  void onAuthenticationComplete(ble_gap_conn_desc *desc) override;
  bool onConfirmPIN(uint32_t pass_key) override;

 private:
  OpenBleGateway *parent_;
};

class DigitalIoCallbacks : public NimBLECharacteristicCallbacks {
 public:
  explicit DigitalIoCallbacks(OpenBleGateway *parent) : parent_(parent) {}

  void onWrite(NimBLECharacteristic *characteristic) override;

 private:
  OpenBleGateway *parent_;
};

class AnalogOutputCallbacks : public NimBLECharacteristicCallbacks {
 public:
  AnalogOutputCallbacks(OpenBleGateway *parent, size_t index) : parent_(parent), index_(index) {}

  void onWrite(NimBLECharacteristic *characteristic) override;

 private:
  OpenBleGateway *parent_;
  size_t index_;
};

OpenBleGateway::OpenBleGateway() = default;

void OpenBleGateway::set_enabled(bool enabled) { enabled_ = enabled; }
void OpenBleGateway::set_device_name(const std::string &name) { device_name_ = name; }
void OpenBleGateway::set_manufacturer(const std::string &manufacturer) { manufacturer_name_ = manufacturer; }
void OpenBleGateway::set_model(const std::string &model) { model_number_ = model; }
void OpenBleGateway::set_serial_number(const std::string &serial) { serial_number_ = serial; }
void OpenBleGateway::set_hardware_revision(const std::string &rev) { hardware_revision_ = rev; }
void OpenBleGateway::set_software_revision(const std::string &rev) { software_revision_ = rev; }
void OpenBleGateway::set_pairing_status_sensor(esphome::text_sensor::TextSensor *sensor) { pairing_status_sensor_ = sensor; }
void OpenBleGateway::set_paired_devices_sensor(esphome::text_sensor::TextSensor *sensor) { paired_devices_sensor_ = sensor; }
void OpenBleGateway::set_pairing_display_duration(uint32_t seconds) { pairing_display_ms_ = seconds * 1000UL; }

void OpenBleGateway::set_max_devices(size_t max_devices) {
  if (max_devices == 0) {
    max_devices = 1;
  }
  max_devices_ = max_devices;
  if (trusted_devices_.size() > max_devices_) {
    trusted_devices_.erase(trusted_devices_.begin(), trusted_devices_.begin() + (trusted_devices_.size() - max_devices_));
    publish_trusted_devices_();
  }
}

void OpenBleGateway::set_temperature_sensor(esphome::sensor::Sensor *sensor) {
  temperature_sensor_ = sensor;
  if (sensor != nullptr) {
    sensor->add_on_state_callback([this](float value) { this->publish_temperature_(value); });
  }
}

void OpenBleGateway::set_humidity_sensor(esphome::sensor::Sensor *sensor) {
  humidity_sensor_ = sensor;
  if (sensor != nullptr) {
    sensor->add_on_state_callback([this](float value) { this->publish_humidity_(value); });
  }
}

void OpenBleGateway::set_water_level_sensor(esphome::sensor::Sensor *sensor) {
  water_level_sensor_ = sensor;
  if (sensor != nullptr) {
    sensor->add_on_state_callback([this](float value) { this->publish_water_level_(value); });
  }
}

void OpenBleGateway::set_supply_voltage_sensor(esphome::sensor::Sensor *sensor) {
  supply_voltage_sensor_ = sensor;
  if (sensor != nullptr) {
    sensor->add_on_state_callback([this](float value) { this->publish_supply_voltage_(value); });
  }
}

void OpenBleGateway::set_fan_rpm_sensor(esphome::sensor::Sensor *sensor) { this->add_analog_input_sensor(sensor); }

void OpenBleGateway::add_digital_output(esphome::switch_::Switch *sw) {
  if (sw == nullptr) {
    return;
  }
  for (auto &binding : digital_outputs_) {
    if (binding.sw == sw) {
      return;
    }
  }
  digital_outputs_.push_back({sw, 0});
}

void OpenBleGateway::add_analog_output(esphome::number::Number *number) {
  if (number == nullptr) {
    return;
  }
  for (auto &binding : analog_outputs_) {
    if (binding.number == number) {
      return;
    }
  }
  analog_outputs_.push_back({number, nullptr});
}

void OpenBleGateway::add_analog_input_sensor(esphome::sensor::Sensor *sensor) {
  if (sensor == nullptr) {
    return;
  }
  for (auto &binding : analog_inputs_) {
    if (binding.sensor == sensor) {
      return;
    }
  }
  analog_inputs_.push_back({sensor, nullptr});
}

void OpenBleGateway::set_humidifier_switch(esphome::switch_::Switch *sw) { this->add_digital_output(sw); }

float OpenBleGateway::get_setup_priority() const { return esphome::setup_priority::BLUETOOTH; }

void OpenBleGateway::setup() {
  if (ble_started_) {
    return;
  }

  if (!enabled_) {
    ESP_LOGI(TAG, "BLE gateway disabled");
    update_pairing_status_("BLE disabled");
    publish_trusted_devices_();
    return;
  }

  NimBLEDevice::init(device_name_);
  NimBLEDevice::setDeviceName(device_name_.c_str());

  setup_security_();

  server_ = NimBLEDevice::createServer();
  server_->setCallbacks(new ServerCallbacks(this));

  setup_device_info_service_();
  setup_environment_service_();
  setup_automation_service_();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(environment_service_->getUUID());
  if (automation_service_ != nullptr) {
    advertising->addServiceUUID(automation_service_->getUUID());
  }
  advertising->setScanResponse(true);
  advertising->start();

  ble_started_ = true;
  ESP_LOGI(TAG, "BLE advertising started");
  update_pairing_status_("BLE advertising");
  publish_trusted_devices_();

  if (temperature_sensor_ != nullptr && temperature_sensor_->has_state()) {
    publish_temperature_(temperature_sensor_->state);
  }
  if (humidity_sensor_ != nullptr && humidity_sensor_->has_state()) {
    publish_humidity_(humidity_sensor_->state);
  }
  if (water_level_sensor_ != nullptr && water_level_sensor_->has_state()) {
    publish_water_level_(water_level_sensor_->state);
  }
  if (supply_voltage_sensor_ != nullptr && supply_voltage_sensor_->has_state()) {
    publish_supply_voltage_(supply_voltage_sensor_->state);
  }
  for (size_t i = 0; i < analog_inputs_.size(); ++i) {
    auto *sensor = analog_inputs_[i].sensor;
    if (sensor != nullptr && sensor->has_state()) {
      publish_analog_input_(i, sensor->state);
    }
  }
  for (size_t i = 0; i < analog_outputs_.size(); ++i) {
    auto *number = analog_outputs_[i].number;
    if (number != nullptr && number->has_state()) {
      publish_analog_output_(i, number->state);
    }
  }
  sync_digital_characteristic_();
}

void OpenBleGateway::dump_config() {
  ESP_LOGCONFIG(TAG, "Open BLE Gateway:");
  ESP_LOGCONFIG(TAG, "  Enabled: %s", enabled_ ? "yes" : "no");
  ESP_LOGCONFIG(TAG, "  Device name: %s", device_name_.c_str());
  ESP_LOGCONFIG(TAG, "  Manufacturer: %s", manufacturer_name_.c_str());
  ESP_LOGCONFIG(TAG, "  Model: %s", model_number_.c_str());
  ESP_LOGCONFIG(TAG, "  Max paired devices: %u", static_cast<unsigned>(max_devices_));
}

void OpenBleGateway::clear_trusted_devices() {
  trusted_devices_.clear();
  publish_trusted_devices_();
  NimBLEDevice::deleteAllBonds();
  update_pairing_status_("Cleared paired devices");
  schedule_pairing_status_clear_();
}

void OpenBleGateway::handle_connect(const std::string &address) {
  ESP_LOGI(TAG, "BLE connection from %s", address.c_str());
  start_pairing_session_(address);
}

void OpenBleGateway::handle_disconnect() {
  ESP_LOGI(TAG, "BLE client disconnected");
  finish_pairing_session_();
  update_pairing_status_("BLE disconnected");
  schedule_pairing_status_clear_();
  if (ble_started_) {
    NimBLEDevice::startAdvertising();
  }
}

void OpenBleGateway::handle_authentication_complete(const ble_gap_conn_desc *desc, bool success) {
  if (!success || desc == nullptr) {
    ESP_LOGW(TAG, "BLE authentication failed");
    handle_pairing_failure_();
    return;
  }

  std::string address = NimBLEAddress(desc->peer_id_addr).toString();
  ESP_LOGI(TAG, "Authenticated BLE device %s", address.c_str());
  add_trusted_device_(address);
  finish_pairing_session_();
  update_pairing_status_("Paired " + address);
  schedule_pairing_status_clear_();
}

void OpenBleGateway::handle_digital_write(uint8_t mask) {
  for (auto &binding : digital_outputs_) {
    if (binding.sw == nullptr || binding.bit == 0) {
      continue;
    }
    bool requested = (mask & binding.bit) != 0;
    if (requested) {
      binding.sw->turn_on();
    } else {
      binding.sw->turn_off();
    }
  }
  sync_digital_characteristic_();
}

void OpenBleGateway::handle_analog_write(size_t index, float value) {
  if (index >= analog_outputs_.size()) {
    return;
  }
  auto &binding = analog_outputs_[index];
  if (binding.number == nullptr) {
    return;
  }

  auto call = binding.number->make_call();
  call.set_value(value);
  call.perform();
  publish_analog_output_(index, value);
}

void OpenBleGateway::setup_security_() {
  NimBLEDevice::setSecurityAuth(true, true, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
  NimBLEDevice::setSecurityPasskey(0);
  NimBLEDevice::setSecurityCallbacks(new SecurityCallbacks(this));
  NimBLEDevice::setSecurityInitKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  NimBLEDevice::setSecurityRespKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
}

void OpenBleGateway::setup_device_info_service_() {
  NimBLEService *service = server_->createService(BLEUUID((uint16_t)0x180A));
  service->createCharacteristic(BLEUUID((uint16_t)0x2A29), NIMBLE_PROPERTY::READ)->setValue(manufacturer_name_);
  service->createCharacteristic(BLEUUID((uint16_t)0x2A24), NIMBLE_PROPERTY::READ)->setValue(model_number_);
  service->createCharacteristic(BLEUUID((uint16_t)0x2A25), NIMBLE_PROPERTY::READ)->setValue(serial_number_);
  service->createCharacteristic(BLEUUID((uint16_t)0x2A27), NIMBLE_PROPERTY::READ)->setValue(hardware_revision_);
  service->createCharacteristic(BLEUUID((uint16_t)0x2A28), NIMBLE_PROPERTY::READ)->setValue(software_revision_);
  service->start();
}

void OpenBleGateway::setup_environment_service_() {
  environment_service_ = server_->createService(BLEUUID((uint16_t)0x181A));

  temperature_characteristic_ = environment_service_->createCharacteristic(
      BLEUUID((uint16_t)0x2A6E), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY);
  humidity_characteristic_ = environment_service_->createCharacteristic(
      BLEUUID((uint16_t)0x2A6F), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY);
  water_level_characteristic_ = environment_service_->createCharacteristic(
      BLEUUID((uint16_t)0x2A30), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY);
  supply_voltage_characteristic_ = environment_service_->createCharacteristic(
      BLEUUID((uint16_t)0x2B18), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY);

  environment_service_->start();
}

void OpenBleGateway::setup_automation_service_() {
  bool needs_service = !digital_outputs_.empty() || !analog_outputs_.empty() || !analog_inputs_.empty();
  if (!needs_service) {
    automation_service_ = nullptr;
    return;
  }

  automation_service_ = server_->createService(BLEUUID((uint16_t)0x1815));

  if (!digital_outputs_.empty()) {
    if (digital_outputs_.size() > kMaxDigitalOutputsBits) {
      ESP_LOGW(TAG, "Exposing only first %zu digital outputs via BLE", kMaxDigitalOutputsBits);
      digital_outputs_.resize(kMaxDigitalOutputsBits);
    }
    digital_characteristic_ = automation_service_->createCharacteristic(
        BLEUUID((uint16_t)0x2A56), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::NOTIFY);
    digital_characteristic_->setCallbacks(new DigitalIoCallbacks(this));

    for (size_t i = 0; i < digital_outputs_.size(); ++i) {
      auto &binding = digital_outputs_[i];
      binding.bit = 1u << i;
      if (binding.sw != nullptr) {
        binding.sw->add_on_state_callback([this](bool) { this->sync_digital_characteristic_(); });
      }
    }
    sync_digital_characteristic_();
  }

  for (size_t i = 0; i < analog_outputs_.size(); ++i) {
    auto &binding = analog_outputs_[i];
    NimBLECharacteristic *characteristic = automation_service_->createCharacteristic(
        BLEUUID((uint16_t)0x2A59), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::NOTIFY);
    characteristic->setCallbacks(new AnalogOutputCallbacks(this, i));

    if (binding.number != nullptr) {
      auto *user_desc = characteristic->createDescriptor(BLEUUID((uint16_t)0x2901));
      if (user_desc != nullptr) {
        user_desc->setValue(binding.number->get_name());
      }
    }

    auto *format = characteristic->createDescriptor(BLEUUID((uint16_t)0x2904));
    if (format != nullptr) {
      std::array<uint8_t, 7> descriptor = {0x14, 0x00, 0x00, 0x27, 0x01, 0x00, 0x00};
      format->setValue(descriptor.data(), descriptor.size());
    }

    binding.characteristic = characteristic;
    if (binding.number != nullptr) {
      binding.number->add_on_state_callback([this, index = i](float value) { this->publish_analog_output_(index, value); });
    }
  }

  for (size_t i = 0; i < analog_inputs_.size(); ++i) {
    auto &binding = analog_inputs_[i];
    NimBLECharacteristic *characteristic = automation_service_->createCharacteristic(
        BLEUUID((uint16_t)0x2A58), NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY);

    if (binding.sensor != nullptr) {
      auto *user_desc = characteristic->createDescriptor(BLEUUID((uint16_t)0x2901));
      if (user_desc != nullptr) {
        user_desc->setValue(binding.sensor->get_name());
      }
      binding.sensor->add_on_state_callback([this, index = i](float value) { this->publish_analog_input_(index, value); });
    }

    auto *format = characteristic->createDescriptor(BLEUUID((uint16_t)0x2904));
    if (format != nullptr) {
      std::array<uint8_t, 7> descriptor = {0x14, 0x00, 0x00, 0x27, 0x01, 0x00, 0x00};
      format->setValue(descriptor.data(), descriptor.size());
    }

    binding.characteristic = characteristic;
  }

  automation_service_->start();
}

void OpenBleGateway::publish_temperature_(float celsius) {
  if (temperature_characteristic_ == nullptr) {
    return;
  }
  int16_t encoded = static_cast<int16_t>(std::round(celsius * 100.0f));
  uint8_t buffer[2] = {static_cast<uint8_t>(encoded & 0xFF), static_cast<uint8_t>((encoded >> 8) & 0xFF)};
  temperature_characteristic_->setValue(buffer, sizeof(buffer));
  if (ble_started_) {
    temperature_characteristic_->notify();
  }
}

void OpenBleGateway::publish_humidity_(float humidity_percent) {
  if (humidity_characteristic_ == nullptr) {
    return;
  }
  float constrained = esphome::clamp(humidity_percent, 0.0f, 100.0f);
  uint16_t encoded = static_cast<uint16_t>(std::round(constrained * 100.0f));
  uint8_t buffer[2] = {static_cast<uint8_t>(encoded & 0xFF), static_cast<uint8_t>((encoded >> 8) & 0xFF)};
  humidity_characteristic_->setValue(buffer, sizeof(buffer));
  if (ble_started_) {
    humidity_characteristic_->notify();
  }
}

void OpenBleGateway::publish_water_level_(float level_percent) {
  if (water_level_characteristic_ == nullptr) {
    return;
  }
  float constrained = esphome::clamp(level_percent, 0.0f, 200.0f);
  uint16_t encoded = static_cast<uint16_t>(std::round(constrained * 100.0f));
  uint8_t buffer[2] = {static_cast<uint8_t>(encoded & 0xFF), static_cast<uint8_t>((encoded >> 8) & 0xFF)};
  water_level_characteristic_->setValue(buffer, sizeof(buffer));
  if (ble_started_) {
    water_level_characteristic_->notify();
  }
}

void OpenBleGateway::publish_supply_voltage_(float voltage) {
  if (supply_voltage_characteristic_ == nullptr) {
    return;
  }
  uint16_t encoded = static_cast<uint16_t>(std::round(voltage * 1000.0f));
  uint8_t buffer[2] = {static_cast<uint8_t>(encoded & 0xFF), static_cast<uint8_t>((encoded >> 8) & 0xFF)};
  supply_voltage_characteristic_->setValue(buffer, sizeof(buffer));
  if (ble_started_) {
    supply_voltage_characteristic_->notify();
  }
}

void OpenBleGateway::publish_analog_output_(size_t index, float value) {
  if (index >= analog_outputs_.size()) {
    return;
  }
  auto &binding = analog_outputs_[index];
  if (binding.characteristic == nullptr) {
    return;
  }
  float encoded = value;
  binding.characteristic->setValue(reinterpret_cast<uint8_t *>(&encoded), sizeof(encoded));
  if (ble_started_) {
    binding.characteristic->notify();
  }
}

void OpenBleGateway::publish_analog_input_(size_t index, float value) {
  if (index >= analog_inputs_.size()) {
    return;
  }
  auto &binding = analog_inputs_[index];
  if (binding.characteristic == nullptr) {
    return;
  }
  float encoded = value;
  binding.characteristic->setValue(reinterpret_cast<uint8_t *>(&encoded), sizeof(encoded));
  if (ble_started_) {
    binding.characteristic->notify();
  }
}

void OpenBleGateway::sync_digital_characteristic_() {
  if (digital_characteristic_ == nullptr) {
    return;
  }
  uint8_t mask = 0;
  for (const auto &binding : digital_outputs_) {
    if (binding.sw != nullptr && binding.bit != 0 && binding.sw->state) {
      mask |= binding.bit;
    }
  }
  digital_characteristic_->setValue(&mask, sizeof(mask));
  if (ble_started_) {
    digital_characteristic_->notify();
  }
}

void OpenBleGateway::start_pairing_session_(const std::string &address) {
  if (is_device_trusted_(address)) {
    update_pairing_status_("BLE device connected: " + address);
    schedule_pairing_status_clear_();
    pairing_active_ = false;
    current_passkey_ = 0;
    return;
  }

  pairing_active_ = true;
  current_passkey_ = generate_passkey_();
  NimBLEDevice::setSecurityPasskey(current_passkey_);

  char buffer[32];
  snprintf(buffer, sizeof(buffer), "BLE PIN: %06u", static_cast<unsigned>(current_passkey_));
  update_pairing_status_(buffer);
  schedule_pairing_status_clear_();
}

void OpenBleGateway::finish_pairing_session_() {
  pairing_active_ = false;
  current_passkey_ = 0;
}

void OpenBleGateway::handle_pairing_failure_() {
  finish_pairing_session_();
  update_pairing_status_("BLE pairing failed");
  schedule_pairing_status_clear_();
}

void OpenBleGateway::update_pairing_status_(const std::string &message) {
  if (pairing_status_sensor_ != nullptr) {
    pairing_status_sensor_->publish_state(message);
  }
}

void OpenBleGateway::schedule_pairing_status_clear_() {
  this->set_timeout("ble_pair_status", pairing_display_ms_, [this]() {
    if (pairing_active_) {
      return;
    }
    if (pairing_status_sensor_ != nullptr) {
      pairing_status_sensor_->publish_state("");
    }
  });
}

void OpenBleGateway::publish_trusted_devices_() {
  if (paired_devices_sensor_ == nullptr) {
    return;
  }

  if (trusted_devices_.empty()) {
    paired_devices_sensor_->publish_state("(none)");
    return;
  }

  std::ostringstream oss;
  for (size_t i = 0; i < trusted_devices_.size(); ++i) {
    if (i != 0) {
      oss << "\n";
    }
    oss << trusted_devices_[i];
  }
  paired_devices_sensor_->publish_state(oss.str());
}

void OpenBleGateway::add_trusted_device_(const std::string &address) {
  auto it = std::find(trusted_devices_.begin(), trusted_devices_.end(), address);
  if (it != trusted_devices_.end()) {
    trusted_devices_.erase(it);
  }
  trusted_devices_.push_back(address);
  if (trusted_devices_.size() > max_devices_) {
    trusted_devices_.erase(trusted_devices_.begin());
  }
  publish_trusted_devices_();
}

bool OpenBleGateway::is_device_trusted_(const std::string &address) const {
  return std::find(trusted_devices_.begin(), trusted_devices_.end(), address) != trusted_devices_.end();
}

uint32_t OpenBleGateway::generate_passkey_() const { return static_cast<uint32_t>(esp_random() % 1000000U); }

void ServerCallbacks::onConnect(NimBLEServer *server) {
  size_t connected = server->getConnectedCount();
  if (connected > 0) {
    NimBLEConnInfo info = server->getPeerInfo(connected - 1);
    parent_->handle_connect(info.getAddress().toString());
  } else {
    parent_->handle_connect("(unknown)");
  }
}

void ServerCallbacks::onConnect(NimBLEServer *server, ble_gap_conn_desc *desc) {
  if (desc != nullptr) {
    const ble_addr_t &addr = desc->peer_id_addr;
    parent_->handle_connect(NimBLEAddress(addr).toString());
  } else {
    onConnect(server);
  }
}

void ServerCallbacks::onDisconnect(NimBLEServer *server) {
  parent_->handle_disconnect();
  NimBLEDevice::startAdvertising();
}

uint32_t SecurityCallbacks::onPassKeyRequest() { return parent_->current_passkey(); }

void SecurityCallbacks::onPassKeyNotify(uint32_t pass_key) {
  ESP_LOGI(TAG, "Peer displayed passkey %06u", static_cast<unsigned>(pass_key));
}

bool SecurityCallbacks::onSecurityRequest() { return true; }

void SecurityCallbacks::onAuthenticationComplete(ble_gap_conn_desc *desc) {
  bool success = desc != nullptr && desc->sec_state.encrypted && desc->sec_state.bonded;
  parent_->handle_authentication_complete(desc, success);
}

bool SecurityCallbacks::onConfirmPIN(uint32_t pass_key) { return pass_key == parent_->current_passkey(); }

void DigitalIoCallbacks::onWrite(NimBLECharacteristic *characteristic) {
  auto value = characteristic->getValue();
  uint8_t mask = value.length() == 0 ? 0 : value.data()[0];
  parent_->handle_digital_write(mask);
}

void AnalogOutputCallbacks::onWrite(NimBLECharacteristic *characteristic) {
  auto value = characteristic->getValue();
  if (value.size() < sizeof(float)) {
    return;
  }
  float decoded = 0.0f;
  std::memcpy(&decoded, value.data(), sizeof(float));
  parent_->handle_analog_write(index_, decoded);
}

}  // namespace open_ble
