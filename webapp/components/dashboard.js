import { h } from "../vendor/preact.module.js";
import { useState, useEffect, useRef } from "../vendor/hooks.module.js";
import htm from "../vendor/htm.module.js";
import { api } from "../lib/esphome-api.js";
import { loadPreferences, savePreferences, getSystemTimezone } from "../lib/preferences.js";
import { buildTimezoneGroups } from "../lib/timezones.js";
import { formatTime, formatSinceShort, rgbToHex, hexToRgb } from "../lib/format.js";
import { SettingsRow } from "./settings-row.js";
import { ModalSheet } from "./modal-sheet.js";
import { ToggleSwitch } from "./toggle-switch.js";
import { OverviewSection } from "./overview-section.js";
import { getNumeric, getBoolean, getText } from "../lib/entities.js";

const html = htm.bind(h);

const ALERTS = [
  { id: "humidity_control_failure", msg: "Humidity control failure detected" },
  { id: "i2c_communication_failure", msg: "Sensor communication issue" },
  { id: "fan_start_failure", msg: "Air exchange fan failed to start" },
  { id: "temperature_too_low", msg: "Temperature is below the safe range" },
  { id: "temperature_too_high", msg: "Temperature is above the safe range" },
];

const FALLBACK_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Lima",
  "America/Caracas",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kiev",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Tehran",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Honolulu",
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

  const renderModal = () => {
    if (!modal) return null;

    const closeModal = () => {
      setCalibrationSuccess(false);
      setModal(null);
    };

    const modalViews = {
      humidity: {
        title: "Humidity Control",
        body: () => {
          const presets = [
            { label: "Precision · 70% ±1%", target: 70, hysteresis: 1 },
            { label: "Balanced · 68% ±2%", target: 68, hysteresis: 2 },
            { label: "Eco · 65% ±3%", target: 65, hysteresis: 3 },
          ];
          return html`
            ${viewOnlyNotice}
            <div className="input-group">
              <label for="targetHumidity">Target humidity (%)</label>
              <input
                id="targetHumidity"
                type="number"
                min="60"
                max="95"
                step="0.5"
                value=${targetHumidity}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange("target_humidity", event.target.value)}
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
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange(
                    "humidity__hysteresis",
                    event.target.value
                  )}
              />
            </div>
            <div className="input-group">
              <label>Presets</label>
              <div className="chip-row">
                ${presets.map(
                  (preset) => html`
                    <button
                      className="chip-button"
                      disabled=${controlsDisabled}
                      onClick=${() => {
                        handleNumberChange("target_humidity", preset.target);
                        handleNumberChange(
                          "humidity__hysteresis",
                          preset.hysteresis
                        );
                        closeModal();
                      }}
                    >
                      ${preset.label}
                    </button>
                  `
                )}
              </div>
            </div>
            <div className="input-group">
              <label for="humidifierSpeed"
                >Humidifier fan speed · ${humidifierSpeed.toFixed(0)}%</label
              >
              <input
                id="humidifierSpeed"
                type="range"
                min="40"
                max="100"
                step="5"
                value=${humidifierSpeed}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange("humidifier__speed", event.target.value)}
              />
              <p className="field-hint">
                Higher speeds add humidity faster but increase noise and water
                consumption.
              </p>
            </div>
          `;
        },
      },
      temperature: {
        title: "Temperature Guard",
        body: () => html`
          ${viewOnlyNotice}
          <div className="toggle-row">
            <${ToggleSwitch}
              checked=${tempControlEnabled}
              disabled=${controlsDisabled}
              ariaLabel="Toggle temperature guard"
              onChange=${(value) =>
                handleSwitchChange("temperature_control_enabled", value)}
            />
            <span className="toggle-row-copy">
              Maintain ${tempTarget.toFixed(1)}°C ±
              ${tempHysteresis.toFixed(1)}°C
            </span>
          </div>
          <div className="input-grid">
            <div className="input-group">
              <label for="tempTarget">Target (°C)</label>
              <input
                id="tempTarget"
                type="number"
                min="10"
                max="35"
                step="0.5"
                value=${tempTarget}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange("temperature__target", event.target.value)}
              />
            </div>
            <div className="input-group">
              <label for="tempHysteresis">Hysteresis (°C)</label>
              <input
                id="tempHysteresis"
                type="number"
                min="0.5"
                max="5"
                step="0.5"
                value=${tempHysteresis}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange(
                    "temperature__hysteresis",
                    event.target.value
                  )}
              />
            </div>
            <div className="input-group">
              <label for="tempWarningMin">Warning minimum (°C)</label>
              <input
                id="tempWarningMin"
                type="number"
                min="5"
                max="25"
                step="0.5"
                value=${tempWarningMin}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange(
                    "temperature__warning_minimum",
                    event.target.value
                  )}
              />
            </div>
            <div className="input-group">
              <label for="tempWarningMax">Warning maximum (°C)</label>
              <input
                id="tempWarningMax"
                type="number"
                min="15"
                max="40"
                step="0.5"
                value=${tempWarningMax}
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange(
                    "temperature__warning_maximum",
                    event.target.value
                  )}
              />
            </div>
          </div>
          <div className="input-group">
            <label for="tempVentHold">Fan hold-off (minutes)</label>
            <input
              id="tempVentHold"
              type="number"
              min="1"
              max="15"
              step="1"
              value=${ventGuardMinutes}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "temperature__vent_holdoff_minutes",
                  event.target.value
                )}
            />
            <p className="field-hint">
              Prevents cold drafts from affecting readings immediately after
              venting.
            </p>
          </div>
        `,
      },
      air: {
        title: "Air Exchange Routine",
        body: () => html`
          ${viewOnlyNotice}
          <div className="input-group">
            <label for="airExchangePeriod">Cycle every (minutes)</label>
            <input
              id="airExchangePeriod"
              type="number"
              min="10"
              max="240"
              step="5"
              value=${airExchangePeriod}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "air_exchange__cycle_minutes",
                  event.target.value
                )}
            />
          </div>
          <div className="input-group">
            <label for="airExchangeDuration">Run duration (minutes)</label>
            <input
              id="airExchangeDuration"
              type="number"
              min="1"
              max="60"
              step="1"
              value=${airExchangeDuration}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "air_exchange__run_minutes",
                  event.target.value
                )}
            />
          </div>
          <div className="input-group">
            <label for="fanSpeed">Fan RPM target</label>
            <input
              id="fanSpeed"
              type="number"
              min="800"
              max="3000"
              step="50"
              value=${fanTargetRpm}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "air_exchange__target_rpm",
                  event.target.value
                )}
            />
          </div>
          <div className="input-group">
            <label for="airHoldoff">Pause after humidifying (minutes)</label>
            <input
              id="airHoldoff"
              type="number"
              min="0"
              max="60"
              step="1"
              value=${airExchangeHoldoff}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "air_exchange__holdoff_minutes",
                  event.target.value
                )}
            />
            <p className="field-hint">
              Prevents the fan from fighting humidity recovery right after a
              misting cycle.
            </p>
          </div>
          <div className="input-group">
            <label for="airBoost">Boost when humidity > target (%)</label>
            <input
              id="airBoost"
              type="number"
              min="0"
              max="10"
              step="0.5"
              value=${airExchangeBoost}
              disabled=${controlsDisabled}
              onInput=${(event) =>
                handleNumberChange(
                  "air_exchange__boost_threshold",
                  event.target.value
                )}
            />
          </div>
        `,
      },
      light: {
        title: "Lighting Schedule",
        body: () => {
          return html`
            ${viewOnlyNotice}
            <div className="input-group">
              <label>Lighting mode</label>
              <div className="chip-row">
                ${[
                  { label: "Daylight", value: "daylight" },
                  { label: "Evening glow", value: "evening" },
                  { label: "Sleep", value: "sleep" },
                ].map(
                  (option) => html`
                    <button
                      className=${`chip-button ${
                        lightsMode === option.value ? "active" : ""
                      }`}
                      disabled=${controlsDisabled}
                      onClick=${() =>
                        handleSelectChange("lighting_mode", option.value)}
                    >
                      ${option.label}
                    </button>
                  `
                )}
              </div>
            </div>
            <div className="input-group">
              <label for="sunriseSelect">Sunrise</label>
              <select
                id="sunriseSelect"
                value=${lightsSunrise}
                disabled=${controlsDisabled}
                onChange=${(event) =>
                  handleNumberChange(
                    "lights__sunrise_hour",
                    event.target.value
                  )}
              >
                ${Array.from({ length: 48 }, (_, index) => index * 0.5).map(
                  (value) =>
                    html`<option value=${value}>${formatTime(value)}</option>`
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
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange(
                    "lights__duration__hours_",
                    event.target.value
                  )}
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
                disabled=${controlsDisabled}
                onInput=${(event) =>
                  handleNumberChange("white_led_intensity", event.target.value)}
              />
            </div>
            <div className="input-group">
              <label for="accentColor">Accent color</label>
              <input
                id="accentColor"
                type="color"
                value=${currentColor}
                disabled=${controlsDisabled}
                onInput=${(event) => {
                  const rgb = hexToRgb(event.target.value);
                  handleNumberChange("red_led_intensity", rgb.r);
                  handleNumberChange("green_led_intensity", rgb.g);
                  handleNumberChange("blue_led_intensity", rgb.b);
                }}
              />
            </div>
          `;
        },
      },
      water: {
        title: "Water Reservoir Calibration",
        body: () => {
          const calibrated = getBoolean(entities, "binary_sensor", "water_calibrated");
          return html`
            ${viewOnlyNotice}
            <p>
              Empty and dry the water reservoir, then start the calibration
              routine.
            </p>
            ${calibrationStatus
              ? html`<p className="field-note">
                  Current status: ${calibrationStatus}
                </p>`
              : null}
            <button
              className="primary-button"
              disabled=${controlsDisabled}
              onClick=${() => {
                handleButtonClick("calibrate_dry_tank");
                setTimeout(() => {
                  handleButtonClick("calibrate_dry_tank");
                  setCalibrationSuccess(true);
                  setTimeout(() => setCalibrationSuccess(false), 8000);
                }, 500);
              }}
            >
              Calibrate empty reservoir
            </button>
            ${calibrationSuccess
              ? html`<div className="success-banner">
                  Calibration request sent.
                </div>`
              : calibrated
              ? html`<div className="info-banner positive">
                  Sensor calibrated recently.
                </div>`
              : html`<div className="info-banner warning">
                  Calibration recommended for accurate readings.
                </div>`}
          `;
        },
      },
      settings: {
        title: "Device Settings & Maintenance",
        body: () => html`
          ${viewOnlyNotice}
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
              <div className="info-row">
                <span className="info-label">Fan RPM</span>
                <span className="info-value">
                  ${Number.isFinite(fanRpm) ? `${fanRpm.toFixed(0)}` : "--"}
                </span>
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
            <h3>Licenses</h3>
            <div className="input-group">
              <label>Open-source notices</label>
              <button
                className="chip-button"
                onClick=${() => setShowLicense((prev) => !prev)}
              >
                ${showLicense ? "Hide licenses" : "Show licenses"}
              </button>
              ${showLicense
                ? html`<pre className="license-log">${licensesText}</pre>`
                : null}
            </div>
          </section>
          <section className="settings-section">
            <h3>Firmware update (OTA)</h3>
            <div className="input-group">
              <input
                type="file"
                accept=".bin"
                disabled=${controlsDisabled || otaStatus === "uploading"}
                onChange=${(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setOtaFile(file);
                    setOtaStatus("idle");
                    setOtaMessage("");
                  }
                }}
              />
              ${otaFile
                ? html`<p className="file-helper">
                    ${otaFile.name} ·
                    ${(otaFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>`
                : null}
              <div className="button-row">
                <button
                  className="primary-button"
                  disabled=${controlsDisabled ||
                  !otaFile ||
                  otaStatus === "uploading"}
                  onClick=${handleOtaUpload}
                >
                  ${otaStatus === "uploading"
                    ? "Uploading…"
                    : "Upload firmware"}
                </button>
                <button
                  className="secondary-button"
                  disabled=${controlsDisabled || otaStatus === "uploading"}
                  onClick=${() => {
                    setOtaFile(null);
                    setOtaStatus("idle");
                    setOtaProgress(0);
                    setOtaMessage("");
                  }}
                >
                  Clear selection
                </button>
              </div>
              ${otaStatus !== "idle"
                ? html`<p className="status-text ${otaStatus}">
                    ${otaMessage}
                  </p>`
                : null}
              ${otaStatus === "uploading"
                ? html`<progress value=${otaProgress} max="100"></progress>`
                : null}
            </div>
          </section>
        `,
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

  const SettingsSheet = () => {
    const settingsOpen = settingsSheetOpen;

    const openTimezonePicker = (event) => {
      if (controlsDisabled) return;
      const selectEl = event.currentTarget.querySelector(
        "select.settings-select-native"
      );
      if (!selectEl) return;
      if (typeof selectEl.showPicker === "function") {
        selectEl.showPicker();
        return;
      }
      selectEl.focus({ preventScroll: true });
      const clickEvent = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      selectEl.dispatchEvent(clickEvent);
    };

    const handleFirmwareUpdate = () => {
      if (blockControlsIfUnavailable("Cannot manage firmware while offline."))
        return;
      setModal("settings");
    };

    const handleTrustedDevices = () => {
      setModal("settings");
    };

    const fanSpeedDisplay = Number.isFinite(fanRpm)
      ? `${fanRpm.toFixed(0)} RPM`
      : "—";

    return html`
    <${ModalSheet}
      open=${settingsOpen}
      title="Settings"
      onClose=${() => setSettingsSheetOpen(false)}
    >
      ${controlsDisabled ? viewOnlyNotice : null}
      <section className="settings-group" aria-labelledby="settings-group-system">
        <header className="settings-group__header">
          <h2 id="settings-group-system" className="settings-group__title">
            System
          </h2>
          <p className="settings-group__detail">Core configuration</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:toolbox"
            title="Device"
            hint="Fixed hardware target"
            value="OpenShrooly"
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:globe-with-meridians"
            title="Timezone"
            hint="Align schedules to your locale"
            className="settings-row--select"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${openTimezonePicker}
          >
            <span className="settings-row-value">${timezoneShortLabel}</span>
            <select
              className="settings-select-native"
              value=${timezone}
              disabled=${controlsDisabled}
              aria-label="Select timezone"
              onChange=${(event) => handleTimezoneChange(event.target.value)}
            >
              ${timezoneGroups.map(
                (group) => html`<optgroup label=${group.label}>
                  ${group.options.map(
                    (option) =>
                      html`<option value=${option.value}>
                        ${option.label}
                      </option>`
                  )}
                </optgroup>`
              )}
            </select>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:calendar"
            title="Last snapshot"
            value=${lastUpdateDisplay}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:battery"
            title="Input voltage"
            value=${voltageDisplay}
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-group-network">
        <header className="settings-group__header">
          <h2 id="settings-group-network" className="settings-group__title">
            Network
          </h2>
          <p className="settings-group__detail">Connection details</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:antenna-bars"
            title="Wi‑Fi"
            hint=${wifiMode}
            value=${wifiSSID}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:desktop-computer"
            title="IP address"
            value=${ipAddress}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:leaf-fluttering-in-wind"
            title="Fan speed"
            value=${fanSpeedDisplay}
          />
          <${SettingsRow}
            icon="fluent-emoji-flat:globe-showing-europe-africa"
            title="Remote connection"
            hint="Bridge data via relay"
            value="Coming soon"
          />
        </div>
      </section>

      <section className="settings-group" aria-labelledby="settings-group-maintenance">
        <header className="settings-group__header">
          <h2 id="settings-group-maintenance" className="settings-group__title">
            Maintenance
          </h2>
          <p className="settings-group__detail">Keep things healthy</p>
        </header>
        <div className="settings-card">
          <${SettingsRow}
            icon="fluent-emoji-flat:gear"
            title="Firmware update"
            hint="Upload ESPHome binary"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${handleFirmwareUpdate}
          >
            <span className="settings-row-value action">Open</span>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:satellite-antenna"
            title="BLE service"
            hint="Expose sensors and controls over BLE"
          >
            <${ToggleSwitch}
              checked=${bleEnabled}
              disabled=${controlsDisabled}
              ariaLabel="Toggle BLE service"
              onChange=${(value) => handleSwitchChange("ble_enabled", value)}
            />
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:test-tube"
            title="Calibrate reservoir"
            hint="Request a fresh dry-tank calibration"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${() => setModal("water")}
          >
            <span className="settings-row-value action">Start</span>
          </${SettingsRow}>
          <${SettingsRow}
            icon="fluent-emoji-flat:handshake"
            title="Trusted BLE devices"
            hint="Pair or forget clients"
            interactive=${true}
            disabled=${controlsDisabled}
            onPress=${handleTrustedDevices}
          >
            <span className="settings-row-value action">Manage</span>
          </${SettingsRow}>
        </div>
      </section>
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
      <${SettingsSheet} />
      ${renderModal()}
    </div>
  `;
}
