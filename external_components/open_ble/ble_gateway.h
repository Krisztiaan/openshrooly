#pragma once

#include "esphome/core/component.h"
#include "esphome/components/number/number.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/switch/switch.h"
#include "esphome/components/text_sensor/text_sensor.h"

#include <NimBLEDevice.h>
#include <NimBLESecurity.h>

#include <string>
#include <vector>

namespace open_ble {

class ServerCallbacks;
class SecurityCallbacks;
class DigitalIoCallbacks;
class AnalogOutputCallbacks;

class OpenBleGateway : public esphome::Component {
 public:
  OpenBleGateway();

  void set_enabled(bool enabled);
  void set_device_name(const std::string &name);
  void set_manufacturer(const std::string &manufacturer);
  void set_model(const std::string &model);
  void set_serial_number(const std::string &serial);
  void set_hardware_revision(const std::string &rev);
  void set_software_revision(const std::string &rev);
  void set_pairing_status_sensor(esphome::text_sensor::TextSensor *sensor);
  void set_paired_devices_sensor(esphome::text_sensor::TextSensor *sensor);
  void set_pairing_display_duration(uint32_t seconds);
  void set_max_devices(size_t max_devices);

  void set_temperature_sensor(esphome::sensor::Sensor *sensor);
  void set_humidity_sensor(esphome::sensor::Sensor *sensor);
  void set_water_level_sensor(esphome::sensor::Sensor *sensor);
  void set_supply_voltage_sensor(esphome::sensor::Sensor *sensor);
  void set_fan_rpm_sensor(esphome::sensor::Sensor *sensor);

  void add_digital_output(esphome::switch_::Switch *sw);
  void add_analog_output(esphome::number::Number *number);
  void add_analog_input_sensor(esphome::sensor::Sensor *sensor);
  void set_humidifier_switch(esphome::switch_::Switch *sw);

  void setup() override;
  void dump_config() override;
  float get_setup_priority() const override;

  void clear_trusted_devices();

  void handle_connect(const std::string &address);
  void handle_disconnect();
  void handle_authentication_complete(const ble_gap_conn_desc *desc, bool success);
  void handle_digital_write(uint8_t mask);
  void handle_analog_write(size_t index, float value);

  uint32_t current_passkey() const { return current_passkey_; }

 private:
  friend class ServerCallbacks;
  friend class SecurityCallbacks;
  friend class DigitalIoCallbacks;
  friend class AnalogOutputCallbacks;

  struct DigitalBinding {
    esphome::switch_::Switch *sw{nullptr};
    uint8_t bit{0};
  };

  struct AnalogOutputBinding {
    esphome::number::Number *number{nullptr};
    NimBLECharacteristic *characteristic{nullptr};
  };

  struct AnalogInputBinding {
    esphome::sensor::Sensor *sensor{nullptr};
    NimBLECharacteristic *characteristic{nullptr};
  };

  void setup_security_();
  void setup_device_info_service_();
  void setup_environment_service_();
  void setup_automation_service_();

  void publish_temperature_(float celsius);
  void publish_humidity_(float humidity_percent);
  void publish_water_level_(float level_percent);
  void publish_supply_voltage_(float voltage);
  void publish_analog_output_(size_t index, float value);
  void publish_analog_input_(size_t index, float value);
  void sync_digital_characteristic_();

  void start_pairing_session_(const std::string &address);
  void finish_pairing_session_();
  void handle_pairing_failure_();
  void update_pairing_status_(const std::string &message);
  void schedule_pairing_status_clear_();
  void publish_trusted_devices_();
  void add_trusted_device_(const std::string &address);
  bool is_device_trusted_(const std::string &address) const;
  uint32_t generate_passkey_() const;

  bool enabled_{false};
  bool ble_started_{false};
  bool pairing_active_{false};
  uint32_t pairing_display_ms_{30000};
  uint32_t current_passkey_{0};
  size_t max_devices_{4};

  std::string device_name_{"OpenShrooly"};
  std::string manufacturer_name_{"OpenShrooly"};
  std::string model_number_{"OpenShrooly"};
  std::string serial_number_{"0000"};
  std::string hardware_revision_{"1.0"};
  std::string software_revision_{"0.0"};

  esphome::sensor::Sensor *temperature_sensor_{nullptr};
  esphome::sensor::Sensor *humidity_sensor_{nullptr};
  esphome::sensor::Sensor *water_level_sensor_{nullptr};
  esphome::sensor::Sensor *supply_voltage_sensor_{nullptr};

  std::vector<DigitalBinding> digital_outputs_;
  std::vector<AnalogOutputBinding> analog_outputs_;
  std::vector<AnalogInputBinding> analog_inputs_;
  std::vector<std::string> trusted_devices_;

  esphome::text_sensor::TextSensor *pairing_status_sensor_{nullptr};
  esphome::text_sensor::TextSensor *paired_devices_sensor_{nullptr};

  NimBLEServer *server_{nullptr};
  NimBLEService *environment_service_{nullptr};
  NimBLEService *automation_service_{nullptr};

  NimBLECharacteristic *temperature_characteristic_{nullptr};
  NimBLECharacteristic *humidity_characteristic_{nullptr};
  NimBLECharacteristic *water_level_characteristic_{nullptr};
  NimBLECharacteristic *supply_voltage_characteristic_{nullptr};
  NimBLECharacteristic *digital_characteristic_{nullptr};
};

}  // namespace open_ble

