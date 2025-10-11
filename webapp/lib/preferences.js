const PREF_KEY = "openshrooly:prefs";

export const getSystemTimezone = () => {
  if (typeof Intl === "undefined") return null;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.warn("[prefs] Failed to resolve system timezone", error);
    return null;
  }
};

export const loadPreferences = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[prefs] Failed to load preferences", error);
    return {};
  }
};

export const savePreferences = (prefs) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("[prefs] Failed to save preferences", error);
  }
};
