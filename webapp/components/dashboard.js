import { h } from "../vendor/preact.module.js";
import { useState, useEffect, useRef } from "../vendor/hooks.module.js";
import htm from "../vendor/htm.module.js";
import { api } from "../lib/esphome-api.js";
import { loadPreferences, savePreferences, getSystemTimezone } from "../lib/preferences.js";
import { buildTimezoneGroups } from "../lib/timezones.js";
import { formatTime, formatSinceShort, rgbToHex, hexToRgb } from "../lib/format.js";
import { OverviewSection } from "./overview-section.js";
import {
  HumidityModal,
  TemperatureModal,
  AirModal,
  LightModal,
  WaterModal,
  AdvancedSettingsModal,
} from "./modals/index.js";
import { ToggleSwitch } from "./toggle-switch.js";
import { DeviceSettingsSheet } from "./device-settings-sheet.js";
import { getNumeric, getBoolean, getText } from "../lib/entities.js";

const html = htm.bind(h);

const ALERTS = [
  { id: "humidity_control_failure", msg: "Humidity control failure detected" },
  { id: "i2c_communication_failure", msg: "Sensor communication issue" },
  { id: "fan_start_failure", msg: "Air exchange fan failed to start" },
  { id: "temperature_too_low", msg: "Temperature is below the safe range" },
  { id: "temperature_too_high", msg: "Temperature is above the safe range" },
];

const SYSTEM_TIME_ZONE = getSystemTimezone();

const BASE_POLL_MS = 5000;
const MAX_POLL_MS = 15000;
const RECONNECT_INTERVAL_MS = 15000;

export function Dashboard() {
  const [entities, setEntities] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [prefs, setPrefs] = useState(() => loadPreferences());
  const [timezone, setTimezone] = useState(
    () => prefs.timezone || SYSTEM_TIME_ZONE || "America/Denver"
  );
  const [calibrationSuccess, setCalibrationSuccess] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [otaFile, setOtaFile] = useState(null);
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaStatus, setOtaStatus] = useState("idle");
  const [otaMessage, setOtaMessage] = useState("");
  const [connection, setConnection] = useState({
    status: "connecting",
    detail: CONNECTION_META.connecting.detail,
  });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [banner, setBanner] = useState(null);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);

  const debounceTimers = useRef({});
  const eventSourceRef = useRef(null);
  const pollTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const initialSnapshotTaken = useRef(false);
  const retryDelayRef = useRef(BASE_POLL_MS);

  const mergeEntities = (patch) => {
    setEntities((prev) => ({ ...prev, ...patch }));
  };

  const stopEventStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const stopReconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const stopAllConnectivity = () => {
    stopEventStream();
    stopPolling();
    stopReconnect();
  };

  const blockControlsIfUnavailable = (message) => {
    if (!isOnline || connection.status === "offline") {
      setBanner({
        tone: "warning",
        message:
          message ||
          "Controls are disabled while the device is offline. Viewing cached data only.",
      });
      return true;
    }
    return false;
  };

  useEffect(() => {
    setPrefs((previous) => {
      if (previous.timezone === timezone) return previous;
      const updated = { ...previous, timezone };
      savePreferences(updated);
      return updated;
    });
  }, [timezone]);

  const refreshSnapshot = async ({ silent = false } = {}) => {
    try {
      const snapshot = await api.fetchSnapshot();
      mergeEntities(snapshot);
      const tz = snapshot["select-timezone_select"]?.state;
      if (tz) setTimezone(tz);
      setLastUpdate(new Date());
      if (!initialSnapshotTaken.current) {
        initialSnapshotTaken.current = true;
        setLoading(false);
      }
      setConnection((prev) => {
        if (prev.status === "offline") {
          return { status: "polling", detail: CONNECTION_META.polling.detail };
        }
        return prev;
      });
      if (!silent)
        setBanner({ tone: "positive", message: "Dashboard updated just now." });
      return true;
    } catch (error) {
      console.error("Snapshot failed", error);
      setConnection({ status: "offline", detail: "" });
      if (!initialSnapshotTaken.current) {
        initialSnapshotTaken.current = true;
        setLoading(false);
      }
      if (!silent) {
        setBanner({
          tone: "critical",
          message:
            "Could not reach the device. Controls are disabled until the connection returns.",
        });
      }
      return false;
    }
  };

  const scheduleReconnect = () => {
    stopReconnect();
    reconnectTimerRef.current = setTimeout(() => {
      if (!isOnline) return;
      startEventStream({ retry: true });
    }, RECONNECT_INTERVAL_MS);
  };

  const startPolling = (detail = CONNECTION_META.polling.detail) => {
    stopEventStream();
    stopPolling();
    retryDelayRef.current = BASE_POLL_MS;
    setConnection({ status: "polling", detail });

    const poll = async () => {
      const ok = await refreshSnapshot({ silent: true });
      retryDelayRef.current = ok
        ? BASE_POLL_MS
        : Math.min(MAX_POLL_MS, retryDelayRef.current * 2);
      pollTimerRef.current = setTimeout(poll, retryDelayRef.current);
    };

    poll();
    scheduleReconnect();
  };

  const startEventStream = ({ retry = false } = {}) => {
    stopEventStream();
    if (!isOnline) return;

    const detail = retry
      ? "Re-establishing realtime connection…"
      : CONNECTION_META.connecting.detail;
    setConnection({ status: "connecting", detail });

    const eventSource = api.subscribeToEvents((event) => {
      if (!event.id) return;
      mergeEntities({
        [event.id]: {
          value: event.value !== undefined ? event.value : event.state === "ON",
          state: event.state,
        },
      });
      if (event.id === "select-timezone_select" && event.state) {
        setTimezone(event.state);
      }
      setLastUpdate(new Date());
      setBanner(null);
    });

    if (!eventSource) {
      startPolling("Realtime channel unavailable. Falling back to snapshots.");
      return;
    }

    eventSourceRef.current = eventSource;
    eventSource.onopen = () => {
      stopPolling();
      stopReconnect();
      setConnection({
        status: "streaming",
        detail: CONNECTION_META.streaming.detail,
      });
      if (!initialSnapshotTaken.current) {
        refreshSnapshot({ silent: true });
      }
    };
    eventSource.onerror = () => {
      console.warn("EventSource error — switching to snapshot mode");
      startPolling(
        "Realtime channel interrupted. Using 5 s snapshots while retrying…"
      );
    };
  };

  const handleOfflineChange = (online) => {
    setIsOnline(online);
    if (!online) {
      stopAllConnectivity();
      setConnection({
        status: "offline",
        detail: CONNECTION_META.offline.detail,
      });
    }
  };

  useEffect(() => {
    const onOnline = () => handleOfflineChange(true);
    const onOffline = () => handleOfflineChange(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const ok = await refreshSnapshot({ silent: true });
      if (cancelled) return;
      if (!ok)
        setConnection({ status: "connecting", detail: "Retrying snapshot…" });
      startEventStream();
    };
    bootstrap();
    return () => {
      cancelled = true;
      stopAllConnectivity();
    };
  }, []);

  useEffect(() => {
    if (!isOnline) {
      setBanner({
        tone: "warning",
        message:
          "You appear to be offline. The dashboard is running on cached data.",
      });
      return;
    }

    setBanner(null);
    stopAllConnectivity();
    refreshSnapshot({ silent: true });
    startEventStream({ retry: true });
  }, [isOnline]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  const handleNumberChange = (id, value) => {
    if (blockControlsIfUnavailable()) return;
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) return;
    const key = `number-${id}`;
    setEntities((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), value: numericValue, state: numericValue },
    }));
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      const ok = await api.setNumber(id, numericValue);
      if (!ok) {
        setBanner({
          tone: "critical",
          message: `Failed to update ${id.replace(
            /_/g,
            " "
          )}. Please try again.`,
        });
      }
    }, 250);
  };

  const handleButtonClick = async (buttonId) => {
    if (blockControlsIfUnavailable()) return;
    const ok = await api.pressButton(buttonId);
    if (!ok) {
      setBanner({
        tone: "critical",
        message: `Failed to run action ${buttonId.replace(/_/g, " ")}.`,
      });
    }
  };

  const handleSwitchChange = async (id, checked) => {
    if (blockControlsIfUnavailable()) return;
    const key = `switch-${id}`;
    setEntities((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        state: checked ? "ON" : "OFF",
        value: checked,
      },
    }));
    const ok = await api.setSwitch(id, checked);
    if (!ok) {
      setBanner({
        tone: "critical",
        message: `Failed to update ${id.replace(/_/g, " ")}.`,
      });
    }
  };

  const handleSelectChange = async (id, option) => {
    if (blockControlsIfUnavailable()) return;
    const ok = await api.setSelect(id, option);
    if (ok) {
      setEntities((prev) => ({
        ...prev,
        [`select-${id}`]: { ...(prev[`select-${id}`] || {}), state: option },
      }));
    } else {
      setBanner({
        tone: "critical",
        message: `Failed to update ${id.replace(/_/g, " ")}.`,
      });
    }
  };

  const handleTimezoneChange = async (tz) => {
    setTimezone(tz);
    if (blockControlsIfUnavailable()) return;
    await handleSelectChange("timezone_select", tz);
  };

  const handleOtaUpload = async () => {
    if (blockControlsIfUnavailable("Cannot upload firmware while offline."))
      return;
    if (!otaFile) {
      setOtaMessage("Please select a firmware file before uploading.");
      setOtaStatus("error");
      return;
    }

    setOtaStatus("uploading");
    setOtaProgress(0);
    setOtaMessage("Uploading firmware…");

    try {
      const formData = new FormData();
      formData.append("file", otaFile);
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          setOtaProgress((event.loaded / event.total) * 100);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status === 200) {
          setOtaStatus("success");
          setOtaMessage("Firmware uploaded. The device will reboot shortly.");
          setOtaProgress(100);
          setTimeout(() => {
            setOtaStatus("idle");
            setOtaFile(null);
            setOtaProgress(0);
            setOtaMessage("");
          }, 5000);
        } else {
          setOtaStatus("error");
          setOtaMessage(`Upload failed: ${xhr.statusText}`);
        }
      });
      xhr.addEventListener("error", () => {
        setOtaStatus("error");
        setOtaMessage("Upload failed due to a network error.");
      });
      xhr.open("POST", "/update");
      xhr.send(formData);
    } catch (error) {
      setOtaStatus("error");
      setOtaMessage(`Upload failed: ${error}`);
    }
  };

  const humidity =
    getNumeric(entities, "sensor", "humidity") ||
    getNumeric(entities, "sensor", "current_humidity");
  const targetHumidity = getNumeric(entities, "number", "target_humidity", 70);
  const humidityHysteresis = getNumeric(entities, "number", "humidity__hysteresis", 2);
  const humidifierSpeed = getNumeric(entities, "number", "humidifier__speed", 80);

  const temperature =
    getNumeric(entities, "sensor", "temperature") ||
    getNumeric(entities, "sensor", "current_temperature");
  const tempTarget = getNumeric(entities, "number", "temperature__target", 22);
  const tempHysteresis = getNumeric(entities, "number", "temperature__hysteresis", 1);
  const tempControlEnabled = getBoolean(
    "switch",
    "temperature_control_enabled"
  );
  const tempMin = tempControlEnabled ? tempTarget - tempHysteresis : 0;
  const tempMax = tempControlEnabled ? tempTarget + tempHysteresis : 0;

  const waterLevel = (() => {
    const primary = getNumeric(entities, "sensor", "water_level_percent");
    if (Number.isFinite(primary)) return primary;
    const fallbackValue = getNumeric(entities, "sensor", "water_level");
    return Number.isFinite(fallbackValue) ? fallbackValue : NaN;
  })();
  const systemVoltage = getNumeric(entities, "sensor", "system_voltage", NaN);
  const fanRpm = getNumeric(entities, "sensor", "current_air_exchange_fan_speed", NaN);

  const lightsSunrise = getNumeric(entities, "number", "lights__sunrise_hour", 8);
  const lightsDuration = getNumeric(entities, "number", "lights__duration__hours_", 12);
  const lightsSunset = (lightsSunrise + lightsDuration) % 24;
  const luxValue = getNumeric(entities, "number", "white_led_intensity", NaN);
  const currentColor = rgbToHex(
    getNumeric(entities, "number", "red_led_intensity", 0),
    getNumeric(entities, "number", "green_led_intensity", 0),
    getNumeric(entities, "number", "blue_led_intensity", 0)
  );
  const lightsOn = (() => {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    if (lightsDuration <= 0) return false;
    if (lightsSunrise < lightsSunset) {
      return currentHour >= lightsSunrise && currentHour < lightsSunset;
    }
    return currentHour >= lightsSunrise || currentHour < lightsSunset;
  })();
  const tempWarningMin = getNumeric(
    "number",
    "temperature__warning_minimum",
    18
  );
  const tempWarningMax = getNumeric(
    "number",
    "temperature__warning_maximum",
    30
  );

  const humidifierOn =
    getBoolean(entities, "switch", "humidifier") ||
    getBoolean(entities, "binary_sensor", "humidifier_on");
  const airExchangeOn =
    getBoolean(entities, "switch", "air_exchange") ||
    getBoolean(entities, "binary_sensor", "air_exchange_on");
  const heatRequested = getBoolean(entities, "binary_sensor", "heat_requested");
  const bleEnabled = getBoolean(entities, "switch", "ble_enabled");
  const timezoneGroups = buildTimezoneGroups(timezone);
  const timezoneShortLabel = (() => {
    const flat = timezoneGroups.flatMap((group) => group.options);
    const match = flat.find((option) => option.value === timezone);
    return match ? match.shortLabel : timezone;
  })();
  const wifiMode = getText(entities, "wifi_mode") || "Unknown";
  const wifiSSID = getText(entities, "wifi_ssid") || "Unknown";
  const ipAddress = getText(entities, "ip_address") || "Unavailable";
  const calibrationStatus = getText(entities, "calibration_status") || "";
  const airExchangeStatusText = getText(entities, "air_exchange_status") || "";
  const ventGuardMinutes = getNumeric(
    "number",
    "temperature__vent_holdoff_minutes",
    5
  );
  const airExchangePeriod = getNumeric(
    "number",
    "air_exchange__cycle_minutes",
    30
  );
  const airExchangeDuration = getNumeric(
    "number",
    "air_exchange__run_minutes",
    5
  );
  const fanTargetRpm = getNumeric(entities, "number", "air_exchange__target_rpm", 1500);
  const airExchangeHoldoff = getNumeric(
    "number",
    "air_exchange__holdoff_minutes",
    10
  );
  const airExchangeBoost = getNumeric(
    "number",
    "air_exchange__boost_threshold",
    2
  );
  const lightsMode = entities["select-lighting_mode"]?.state || "daylight";
  const humidifierStatusText = getText(entities, "humidifier_fan_status") || "";
  const licensesText =
    getText(entities, "licenses") || "License list not yet reported by the device.";
  const voltageDisplay = Number.isFinite(systemVoltage)
    ? `${systemVoltage.toFixed(2)} V`
    : "--";
  const lastUpdateDisplay = lastUpdate
    ? lastUpdate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "No data yet";
  const lastUpdateShort = lastUpdate
    ? lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
  const controlsDisabled = !isOnline || connection.status === "offline";
  const viewOnlyNotice = controlsDisabled
    ? html`<div className="info-banner warning">
        Device offline — controls stay read-only until connectivity returns.
      </div>`
    : null;

  const alerts = ALERTS.filter((alert) =>
    getBoolean(entities, "binary_sensor", `alert__${alert.id}`)
  );

  const toastMessages = [];
  alerts.forEach((alert) => {
    toastMessages.push({
      id: `alert-${alert.id}`,
      tone: "critical",
      message: `⚠️ ${alert.msg}`,
    });
  });
  if (banner) {
    toastMessages.push({
      id: "banner",
      tone: banner.tone,
      message: banner.message,
    });
  }

  const sensorCards = [
    {
      id: "temperature",
      icon: "fluent-emoji-flat:thermometer",
      label: "Temperature",
      value: Number.isFinite(temperature)
        ? `${temperature.toFixed(1)}°C`
        : null,
      detail: tempControlEnabled
        ? `Comfort ${tempMin.toFixed(1)}°–${tempMax.toFixed(1)}°`
        : "Guard disabled",
      action: () => setModal("temperature"),
    },
    {
      id: "humidity",
      icon: "fluent-emoji-flat:water-wave",
      label: "Humidity",
      value: Number.isFinite(humidity) ? `${humidity.toFixed(1)}%` : null,
      detail: `Target ${targetHumidity.toFixed(1)}% · ±${humidityHysteresis.toFixed(1)}%`,
      action: () => setModal("humidity"),
    },
    {
      id: "ambient-light",
      icon: "fluent-emoji-flat:glowing-star",
      label: "Ambient light",
      value: Number.isFinite(luxValue) ? `${luxValue.toFixed(0)} lux` : null,
      detail: `Sunrise ${formatTime(lightsSunrise)} · Sunset ${formatTime(lightsSunset)}`,
      action: () => setModal("light"),
    },
    {
      id: "reservoir",
      icon: "fluent-emoji-flat:droplet",
      label: "Reservoir",
      value: Number.isFinite(waterLevel) ? `${waterLevel.toFixed(0)}%` : null,
      detail: calibrationStatus || "Tap to calibrate",
      action: () => setModal("water"),
    },
  ];

  const controlCards = [
    {
      id: "humidifier",
      icon: "fluent-emoji-flat:shower",
      label: "Humidifier",
      isActive: Boolean(humidifierOn),
      isAvailable:
        Boolean(entities["switch-humidifier"]) ||
        Boolean(entities["binary_sensor-humidifier_on"]),
      detail:
        humidifierStatusText ||
        (humidifierOn ? "Maintaining humidity band" : "Standby"),
      action: () => setModal("humidity"),
    },
    {
      id: "air-exchange",
      icon: "fluent-emoji-flat:wind-face",
      label: "Air exchange",
      isActive: Boolean(airExchangeOn),
      isAvailable:
        Boolean(entities["switch-air_exchange"]) ||
        Boolean(entities["binary_sensor-air_exchange_on"]),
      detail:
        airExchangeStatusText ||
        (airExchangeOn
          ? `Cycle ${airExchangeDuration.toFixed(0)} min / ${airExchangePeriod.toFixed(0)} min`
          : "Idle"),
      action: () => setModal("air"),
    },
    {
      id: "heat-guard",
      icon: "fluent-emoji-flat:fire",
      label: "Heat assist",
      isActive: Boolean(heatRequested || tempControlEnabled),
      isAvailable:
        Boolean(entities["switch-temperature_control_enabled"]) ||
        Boolean(entities["binary_sensor-heat_requested"]),
      detail: tempControlEnabled
        ? `Guard ${tempMin.toFixed(1)}°–${tempMax.toFixed(1)}°`
        : "Guard disabled",
      action: () => setModal("temperature"),
    },
    {
      id: "lighting",
      icon: "fluent-emoji-flat:glowing-star",
      label: "Lighting",
      isActive: Boolean(lightsOn),
      isAvailable:
        Boolean(entities["select-lighting_mode"]) ||
        Boolean(entities["number-white_led_intensity"]),
      detail: `${lightsMode === "daylight" ? "Daylight" : "Custom"} scene`,
      action: () => setModal("light"),
    },
  ];

  const [footerQuote, setFooterQuote] = useState(null);

  const fanSpeedDisplay = Number.isFinite(fanRpm)
    ? `${fanRpm.toFixed(0)} RPM`
    : "—";
  const reservoirCalibrated = getBoolean(entities, "binary_sensor", "water_calibrated");

  const handleLightColorChange = (hex) => {
    const rgb = hexToRgb(hex);
    handleNumberChange("red_led_intensity", rgb.r);
    handleNumberChange("green_led_intensity", rgb.g);
    handleNumberChange("blue_led_intensity", rgb.b);
  };

  const toggleLicenseView = () => setShowLicense((prev) => !prev);

  const selectFirmwareFile = (file) => {
    setOtaFile(file);
    setOtaStatus("idle");
    setOtaMessage("");
  };

  const resetFirmwareQueue = () => {
    setOtaFile(null);
    setOtaStatus("idle");
    setOtaProgress(0);
    setOtaMessage("");
  };

  const handleWaterCalibration = () => {
    if (blockControlsIfUnavailable("Cannot calibrate while offline.")) return;
    handleButtonClick("calibrate_dry_tank");
    setTimeout(() => {
      handleButtonClick("calibrate_dry_tank");
      setCalibrationSuccess(true);
      setTimeout(() => setCalibrationSuccess(false), 8000);
    }, 500);
  };

  useEffect(() => {
    let isMounted = true;
    fetch("./quotes.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((quotes) => {
        if (!isMounted || !Array.isArray(quotes) || quotes.length === 0) return;
        const randomIndex = Math.floor(Math.random() * quotes.length);
        const quote = quotes[randomIndex];
        if (quote && quote.text) {
          setFooterQuote({
            text: quote.text,
            author: quote.author || null,
          });
        }
      })
      .catch(() => {
        /* ignore quote failures */
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const isLive = connection.status === "streaming";
  const statusPillTone = isLive ? "connected" : "broken";
  const statusPillLabel = isLive ? "Live" : "Offline";

  useEffect(() => {
    if (typeof window === "undefined" || !window.monoco) return;
    const { addCorners, draw } = window.monoco;
    const applyCorners = (selector, options) => {
      document.querySelectorAll(selector).forEach((element) => {
        addCorners(element, options);
      });
    };

    applyCorners(".sensor-item", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 0.5,
    });
    applyCorners(".control-pill", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 0.6,
    });
    applyCorners(".chip-button", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 0.6,
    });
    applyCorners(".connection-status", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 14,
    });
    applyCorners(".header-menu", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 18,
    });
    applyCorners(".tile", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 20,
    });
    applyCorners(".toast", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 18,
    });
    applyCorners(".sheet-modal__close", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 16,
    });
    applyCorners(".settings-card", {
      clip: true,
      smoothing: 0.7,
      borderRadius: 20,
    });
    draw?.();
  }, [
    toastMessages.length,
    statusPillLabel,
    humidity,
    temperature,
    waterLevel,
    lightsOn,
    humidifierOn,
    airExchangeOn,
    bleEnabled,
  ]);

  if (loading) {
    return html`
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Connecting to OpenShrooly…</p>
      </div>
    `;
  }

  const handleOpenFirmwareSettings = () => {
    if (blockControlsIfUnavailable("Cannot manage firmware while offline."))
      return;
    setModal("settings");
  };

  const handleCalibrateFromSettings = () => {
    if (blockControlsIfUnavailable()) return;
    setModal("water");
  };

  const handleManageTrustedDevices = () => {
    setModal("settings");
  };

  const handleToggleBle = (value) => {
    handleSwitchChange("ble_enabled", value);
  };

  const renderModal = () => {
    if (!modal) return null;

    const closeModal = () => {
      setCalibrationSuccess(false);
      setModal(null);
    };

    const modalViews = {
      humidity: {
        title: "Humidity Control",
        body: () =>
          html`<${HumidityModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            targetHumidity=${targetHumidity}
            humidityHysteresis=${humidityHysteresis}
            humidifierSpeed=${humidifierSpeed}
            onChangeNumber=${handleNumberChange}
            onApplyPreset=${(preset) => {
              handleNumberChange("target_humidity", preset.target);
              handleNumberChange("humidity__hysteresis", preset.hysteresis);
              closeModal();
            }}
          />`,
      },
      temperature: {
        title: "Temperature Guard",
        body: () =>
          html`<${TemperatureModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            tempControlEnabled=${tempControlEnabled}
            tempTarget=${tempTarget}
            tempHysteresis=${tempHysteresis}
            tempWarningMin=${tempWarningMin}
            tempWarningMax=${tempWarningMax}
            ventHoldMinutes=${ventGuardMinutes}
            onToggleControl=${(value) =>
              handleSwitchChange("temperature_control_enabled", value)}
            onChangeNumber=${handleNumberChange}
          />`,
      },
      air: {
        title: "Air Exchange Routine",
        body: () =>
          html`<${AirModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            airExchangePeriod=${airExchangePeriod}
            airExchangeDuration=${airExchangeDuration}
            fanTargetRpm=${fanTargetRpm}
            airExchangeHoldoff=${airExchangeHoldoff}
            airExchangeBoost=${airExchangeBoost}
            onChangeNumber=${handleNumberChange}
          />`,
      },
      light: {
        title: "Lighting Schedule",
        body: () =>
          html`<${LightModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            lightsMode=${lightsMode}
            lightsSunrise=${lightsSunrise}
            lightsDuration=${lightsDuration}
            luxValue=${luxValue}
            currentColor=${currentColor}
            onSelectMode=${(value) => handleSelectChange("lighting_mode", value)}
            onChangeNumber=${handleNumberChange}
            onChangeColor=${handleLightColorChange}
          />`,
      },
      water: {
        title: "Water Reservoir Calibration",
        body: () =>
          html`<${WaterModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            calibrationStatus=${calibrationStatus}
            calibrationSuccess=${calibrationSuccess}
            calibrated=${reservoirCalibrated}
            onStartCalibration=${handleWaterCalibration}
          />`,
      },
      settings: {
        title: "Device Settings & Maintenance",
        body: () =>
          html`<${AdvancedSettingsModal}
            viewOnlyNotice=${viewOnlyNotice}
            controlsDisabled=${controlsDisabled}
            voltageDisplay=${voltageDisplay}
            lastSnapshot=${lastUpdateDisplay}
            fanSpeedDisplay=${fanSpeedDisplay}
            wifiMode=${wifiMode}
            wifiSSID=${wifiSSID}
            ipAddress=${ipAddress}
            licensesText=${licensesText}
            showLicense=${showLicense}
            onToggleLicense=${toggleLicenseView}
            otaFile=${otaFile}
            otaStatus=${otaStatus}
            otaMessage=${otaMessage}
            otaProgress=${otaProgress}
            onSelectFirmware=${selectFirmwareFile}
            onUploadFirmware=${handleOtaUpload}
            onResetFirmwareQueue=${resetFirmwareQueue}
          />`,
      },
    };
    const entry = modalViews[modal];
    if (!entry) return null;

    return html`
    <${ModalSheet}
      open=${true}
      title=${entry.title}
      onClose=${closeModal}
    >
      ${entry.body()}
    </${ModalSheet}>
  `;
  };

  return html`
    <div className="app-shell">
      <header className="app-header">
        <div className="title-row">
          <div className="title-lockup">
            <h1>OpenShrooly</h1>
            <span className=${`connection-status ${statusPillTone}`}>
              <span className="connection-status__icon">
                <iconify-icon
                  icon=${isLive
                    ? "fluent-emoji-flat:green-circle"
                    : "fluent-emoji-flat:broken-chain"}
                  width="28"
                  height="28"
                ></iconify-icon>
              </span>
            </span>
          </div>
          <div className="header-menu">
            <button
              type="button"
              className="header-menu__button"
              aria-label="Help & docs"
            >
              <iconify-icon
                icon="system-uicons:info-circle"
                width="20"
                height="20"
              ></iconify-icon>
            </button>
            <button
              type="button"
              className="header-menu__button"
              aria-label="Open settings"
              onClick=${() => setSettingsSheetOpen(true)}
            >
              <iconify-icon
                icon="system-uicons:menu-horizontal"
                width="22"
                height="22"
              ></iconify-icon>
            </button>
          </div>
        </div>
      </header>

      <div className="screen-body">
        <${OverviewSection}
          sensors=${sensorCards}
          controls=${controlCards}
          offline=${connection.status === "offline"}
          controlsDisabled=${controlsDisabled}
          lastUpdate=${lastUpdate}
          quote=${footerQuote}
        />
      </div>

      ${toastMessages.length
        ? html`<div className="toast-stack" aria-live="polite">
            ${toastMessages.map(
              (toast) =>
                html`<div className=${`toast ${toast.tone}`} role="status">
                  <span>${toast.message}</span>
                </div>`
            )}
          </div>`
        : null}
      <${DeviceSettingsSheet}
        open=${settingsSheetOpen}
        onClose=${() => setSettingsSheetOpen(false)}
        controlsDisabled=${controlsDisabled}
        viewOnlyNotice=${viewOnlyNotice}
        timezoneShortLabel=${timezoneShortLabel}
        timezoneGroups=${timezoneGroups}
        timezone=${timezone}
        onTimezoneChange=${handleTimezoneChange}
        lastSnapshot=${lastUpdateDisplay}
        voltageDisplay=${voltageDisplay}
        fanSpeedDisplay=${fanSpeedDisplay}
        wifiMode=${wifiMode}
        wifiSSID=${wifiSSID}
        ipAddress=${ipAddress}
        bleEnabled=${bleEnabled}
        onToggleBle=${handleToggleBle}
        onOpenFirmware=${handleOpenFirmwareSettings}
        onCalibrate=${handleCalibrateFromSettings}
        onManageTrusted=${handleManageTrustedDevices}
        calibrationStatus=${calibrationStatus}
        calibrationSuccess=${calibrationSuccess}
      />
      ${renderModal()}
    </div>
  `;
}
