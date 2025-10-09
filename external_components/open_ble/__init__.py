import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_MODEL
from esphome.components import number, sensor, switch, text_sensor

open_ble_ns = cg.esphome_ns.namespace("open_ble")
OpenBleGateway = open_ble_ns.class_("OpenBleGateway", cg.Component)

CONF_ENABLED = "enabled"
CONF_MANUFACTURER = "manufacturer"
CONF_SERIAL_NUMBER = "serial_number"
CONF_DEVICE_NAME = "device_name"
CONF_HARDWARE_VERSION = "hardware_version"
CONF_SOFTWARE_VERSION = "software_version"
CONF_TEMPERATURE_SENSOR = "temperature_sensor"
CONF_HUMIDITY_SENSOR = "humidity_sensor"
CONF_WATER_LEVEL_SENSOR = "water_level_sensor"
CONF_SUPPLY_VOLTAGE_SENSOR = "supply_voltage_sensor"
CONF_FAN_RPM_SENSOR = "fan_rpm_sensor"
CONF_HUMIDIFIER_SWITCH = "humidifier_switch"
CONF_DIGITAL_OUTPUTS = "digital_outputs"
CONF_ANALOG_OUTPUTS = "analog_outputs"
CONF_ANALOG_INPUTS = "analog_inputs"
CONF_PAIRING_STATUS_TEXT_SENSOR = "pairing_status_text_sensor"
CONF_PAIRED_DEVICES_TEXT_SENSOR = "paired_devices_text_sensor"
CONF_PAIRING_DISPLAY_SECONDS = "pairing_display_seconds"
CONF_MAX_DEVICES = "max_paired_devices"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(OpenBleGateway),
        cv.Optional(CONF_ENABLED, default=False): cv.boolean,
        cv.Optional(CONF_DEVICE_NAME): cv.string_strict,
        cv.Optional(CONF_MANUFACTURER, default="OpenShrooly"): cv.string_strict,
        cv.Optional(CONF_MODEL, default="OpenShrooly DevKit"): cv.string_strict,
        cv.Optional(CONF_SERIAL_NUMBER, default="DEVKIT"): cv.string_strict,
        cv.Optional(CONF_HARDWARE_VERSION, default="revA"): cv.string_strict,
        cv.Optional(CONF_SOFTWARE_VERSION, default="0.0"): cv.string_strict,
        cv.Optional(CONF_TEMPERATURE_SENSOR): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_HUMIDITY_SENSOR): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_WATER_LEVEL_SENSOR): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_SUPPLY_VOLTAGE_SENSOR): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_FAN_RPM_SENSOR): cv.use_id(sensor.Sensor),
        cv.Optional(CONF_HUMIDIFIER_SWITCH): cv.use_id(switch.Switch),
        cv.Optional(CONF_PAIRING_STATUS_TEXT_SENSOR): cv.use_id(text_sensor.TextSensor),
        cv.Optional(CONF_PAIRED_DEVICES_TEXT_SENSOR): cv.use_id(text_sensor.TextSensor),
        cv.Optional(CONF_PAIRING_DISPLAY_SECONDS, default="30s"): cv.positive_time_period_seconds,
        cv.Optional(CONF_MAX_DEVICES, default=4): cv.int_range(min=1, max=8),
        cv.Optional(CONF_DIGITAL_OUTPUTS, default=[]): cv.ensure_list(cv.use_id(switch.Switch)),
        cv.Optional(CONF_ANALOG_OUTPUTS, default=[]): cv.ensure_list(cv.use_id(number.Number)),
        cv.Optional(CONF_ANALOG_INPUTS, default=[]): cv.ensure_list(cv.use_id(sensor.Sensor)),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])

    await cg.register_component(var, config)

    cg.add(var.set_enabled(config[CONF_ENABLED]))

    if CONF_DEVICE_NAME in config:
        cg.add(var.set_device_name(config[CONF_DEVICE_NAME]))

    if CONF_MANUFACTURER in config:
        cg.add(var.set_manufacturer(config[CONF_MANUFACTURER]))

    if CONF_MODEL in config:
        cg.add(var.set_model(config[CONF_MODEL]))

    if CONF_SERIAL_NUMBER in config:
        cg.add(var.set_serial_number(config[CONF_SERIAL_NUMBER]))

    if CONF_HARDWARE_VERSION in config:
        cg.add(var.set_hardware_revision(config[CONF_HARDWARE_VERSION]))

    if CONF_SOFTWARE_VERSION in config:
        cg.add(var.set_software_revision(config[CONF_SOFTWARE_VERSION]))

    if CONF_PAIRING_STATUS_TEXT_SENSOR in config:
        ts = await cg.get_variable(config[CONF_PAIRING_STATUS_TEXT_SENSOR])
        cg.add(var.set_pairing_status_sensor(ts))

    if CONF_PAIRED_DEVICES_TEXT_SENSOR in config:
        ts = await cg.get_variable(config[CONF_PAIRED_DEVICES_TEXT_SENSOR])
        cg.add(var.set_paired_devices_sensor(ts))

    if CONF_PAIRING_DISPLAY_SECONDS in config:
        cg.add(var.set_pairing_display_duration(config[CONF_PAIRING_DISPLAY_SECONDS].seconds))

    if CONF_MAX_DEVICES in config:
        cg.add(var.set_max_devices(config[CONF_MAX_DEVICES]))

    if CONF_TEMPERATURE_SENSOR in config:
        sens = await cg.get_variable(config[CONF_TEMPERATURE_SENSOR])
        cg.add(var.set_temperature_sensor(sens))

    if CONF_HUMIDITY_SENSOR in config:
        sens = await cg.get_variable(config[CONF_HUMIDITY_SENSOR])
        cg.add(var.set_humidity_sensor(sens))

    if CONF_WATER_LEVEL_SENSOR in config:
        sens = await cg.get_variable(config[CONF_WATER_LEVEL_SENSOR])
        cg.add(var.set_water_level_sensor(sens))

    if CONF_SUPPLY_VOLTAGE_SENSOR in config:
        sens = await cg.get_variable(config[CONF_SUPPLY_VOLTAGE_SENSOR])
        cg.add(var.set_supply_voltage_sensor(sens))

    if CONF_FAN_RPM_SENSOR in config:
        sens = await cg.get_variable(config[CONF_FAN_RPM_SENSOR])
        cg.add(var.set_fan_rpm_sensor(sens))

    if CONF_HUMIDIFIER_SWITCH in config:
        sw = await cg.get_variable(config[CONF_HUMIDIFIER_SWITCH])
        cg.add(var.set_humidifier_switch(sw))

    for sw_conf in config[CONF_DIGITAL_OUTPUTS]:
        sw = await cg.get_variable(sw_conf)
        cg.add(var.add_digital_output(sw))

    for number_conf in config[CONF_ANALOG_OUTPUTS]:
        num = await cg.get_variable(number_conf)
        cg.add(var.add_analog_output(num))

    for sensor_conf in config[CONF_ANALOG_INPUTS]:
        sens = await cg.get_variable(sensor_conf)
        cg.add(var.add_analog_input_sensor(sens))
