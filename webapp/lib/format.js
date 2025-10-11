export const formatTime = (hour) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

export const rgbToHex = (r, g, b) => {
  const toHex = (n) => {
    const hex = Math.round((n / 100) * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: Math.round((parseInt(result[1], 16) / 255) * 100),
        g: Math.round((parseInt(result[2], 16) / 255) * 100),
        b: Math.round((parseInt(result[3], 16) / 255) * 100),
      }
    : { r: 0, g: 0, b: 0 };
};

export const formatSinceShort = (date) => {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
};
