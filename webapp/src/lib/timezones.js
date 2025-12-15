// @ts-nocheck

import { getSystemTimezone } from "./preferences.js";

export const FALLBACK_TIMEZONES = [
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

const POPULAR_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const cache = new Map();

export const getSupportedTimeZones = () => {
  const hasSupport =
    typeof Intl !== "undefined" &&
    Object.prototype.hasOwnProperty.call(Intl, "supportedValuesOf");
  const supportedFn = hasSupport
    ? /** @type {(key: string) => string[]} */ ((/** @type {any} */ (Intl)).supportedValuesOf)
    : undefined;
  if (!supportedFn) {
    return FALLBACK_TIMEZONES;
  }
  try {
    return supportedFn.call(Intl, "timeZone");
  } catch (error) {
    console.warn("[tz] Unable to query supported time zones", error);
    return FALLBACK_TIMEZONES;
  }
};

const computeOffsetLabel = (zone) => {
  if (typeof Intl === "undefined") return "";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(new Date());
    const tzName = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!tzName) return "";
    if (tzName.startsWith("GMT")) return tzName.replace("GMT", "UTC");
    return tzName;
  } catch (error) {
    console.warn("[tz] Failed to compute offset for", zone, error);
    return "";
  }
};

const prettifyZone = (zone) => {
  const parts = zone.split("/");
  const region = (parts.shift() || "Other").replace(/_/g, " ");
  const city = parts.length
    ? parts.map((part) => part.replace(/_/g, " ")).join(" / ")
    : region;
  return { region, city };
};

const createTimezoneOption = (zone, localZone) => {
  const { region, city } = prettifyZone(zone);
  const offset = computeOffsetLabel(zone);
  const labelParts = [];
  if (offset) labelParts.push(`(${offset})`);
  labelParts.push(city);
  if (city !== region) labelParts.push(`— ${region}`);
  const baseLabel = labelParts.join(" ");
  const renderLabel = zone === localZone ? `${baseLabel} • Local device` : baseLabel;
  const shortLabelParts = [];
  if (offset) shortLabelParts.push(offset);
  shortLabelParts.push(city);
  const shortLabel = shortLabelParts.join(" ");
  return {
    value: zone,
    label: renderLabel,
    baseLabel,
    shortLabel,
    region,
  };
};

export const buildTimezoneGroups = (selectedZone) => {
  const localZone = cache.get("local") ?? getSystemTimezone();
  if (!cache.has("local")) cache.set("local", localZone);

  const supported = getSupportedTimeZones();
  const allZones = new Set([...supported, ...FALLBACK_TIMEZONES]);
  if (localZone) allZones.add(localZone);
  if (selectedZone) allZones.add(selectedZone);

  const optionCache = new Map();
  const getOption = (zone) => {
    if (!optionCache.has(zone)) {
      optionCache.set(zone, createTimezoneOption(zone, localZone));
    }
    return optionCache.get(zone);
  };

  const priorityZones = [...POPULAR_TIMEZONES];
  if (selectedZone && !priorityZones.includes(selectedZone)) {
    priorityZones.unshift(selectedZone);
  }
  if (localZone && !priorityZones.includes(localZone)) {
    priorityZones.unshift(localZone);
  }

  const priorityOptions = priorityZones
    .map((zone) => getOption(zone))
    .filter(Boolean);

  const byRegion = new Map();
  allZones.forEach((zone) => {
    const option = getOption(zone);
    if (!option) return;
    const { region } = option;
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(option);
  });

  const groups = [];
  if (priorityOptions.length) {
    groups.push({ label: "Quick picks", options: priorityOptions });
  }

  const sortedRegions = [...byRegion.keys()].sort();
  sortedRegions.forEach((region) => {
    const options = byRegion.get(region).sort((a, b) => a.baseLabel.localeCompare(b.baseLabel));
    groups.push({ label: region, options });
  });

  return groups;
};
