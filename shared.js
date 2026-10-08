((scope) => {
  const MESSAGE = Object.freeze({
    CAPTURE_FULL_PAGE: "CAPTURE_FULL_PAGE",
    CAPTURE_TAB: "CAPTURE_TAB",
    DO_CAPTURE: "DO_CAPTURE",
    GET_ACTIVE_STATUS: "GET_ACTIVE_STATUS",
    PING: "PING",
    RUN_COMMAND: "RUN_COMMAND",
    START_PICKING: "START_PICKING",
  });

  const STATE = Object.freeze({
    DRAGGING: "dragging",
    HOVERING: "hovering",
    IDLE: "idle",
    LOCKED: "locked",
    UNSUPPORTED: "unsupported",
  });

  const COMMAND_TO_MESSAGE = Object.freeze({
    "capture-full-page": MESSAGE.CAPTURE_FULL_PAGE,
    "capture-region": MESSAGE.DO_CAPTURE,
    "toggle-picker": MESSAGE.START_PICKING,
  });

  const DEFAULT_SHORTCUTS = Object.freeze({
    "capture-full-page": "Alt+Shift+F",
    "capture-region": "Alt+Shift+C",
    "toggle-picker": "Alt+Shift+S",
  });

  const SETTINGS_KEY = "settings";

  const IMAGE_FORMATS = Object.freeze({
    png: Object.freeze({ extension: "png", mime: "image/png" }),
    jpeg: Object.freeze({ extension: "jpg", mime: "image/jpeg" }),
    webp: Object.freeze({ extension: "webp", mime: "image/webp" }),
  });

  const CAPTURE_ACTIONS = Object.freeze(["download", "copy"]);

  // Seconds counted down before a region is captured; 0 captures at once.
  const CAPTURE_DELAYS = Object.freeze([0, 3, 5, 10]);

  const DEFAULT_SETTINGS = Object.freeze({
    captureDelay: 0,
    defaultAction: "download",
    fileNamePrefix: "region-snap",
    format: "png",
    roundedCorners: true,
  });

  const FILE_NAME_PREFIX_MAX_LENGTH = 60;

  // Keeps a prefix usable as a file name on Windows, macOS and Linux.
  function cleanFileNamePrefix(value) {
    if (typeof value !== "string") return DEFAULT_SETTINGS.fileNamePrefix;
    const cleaned = Array.from(value)
      .filter((character) => character.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(character))
      .join("")
      .trim()
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, "")
      .slice(0, FILE_NAME_PREFIX_MAX_LENGTH)
      .trim();
    return cleaned || DEFAULT_SETTINGS.fileNamePrefix;
  }

  // Stored settings are untrusted: an older version, a sync conflict or a hand edit can leave
  // anything there, so every field falls back to its default on its own.
  function normalizeSettings(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      captureDelay: CAPTURE_DELAYS.includes(value.captureDelay)
        ? value.captureDelay
        : DEFAULT_SETTINGS.captureDelay,
      defaultAction: CAPTURE_ACTIONS.includes(value.defaultAction)
        ? value.defaultAction
        : DEFAULT_SETTINGS.defaultAction,
      fileNamePrefix: cleanFileNamePrefix(value.fileNamePrefix),
      format: Object.hasOwn(IMAGE_FORMATS, value.format) ? value.format : DEFAULT_SETTINGS.format,
      roundedCorners:
        typeof value.roundedCorners === "boolean"
          ? value.roundedCorners
          : DEFAULT_SETTINGS.roundedCorners,
    };
  }

  function buildFileName(settings, date) {
    const pad = (number) => String(number).padStart(2, "0");
    const stamp =
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const { fileNamePrefix, format } = normalizeSettings(settings);
    return `${fileNamePrefix}-${stamp}.${IMAGE_FORMATS[format].extension}`;
  }

  const api = Object.freeze({
    ALLOWED_PROTOCOLS: Object.freeze(["http:", "https:", "file:"]),
    CAPTURE_ACTIONS,
    CAPTURE_DELAYS,
    COMMAND_TO_MESSAGE,
    DEFAULT_SETTINGS,
    DEFAULT_SHORTCUTS,
    FILE_NAME_PREFIX_MAX_LENGTH,
    IMAGE_FORMATS,
    MESSAGE,
    SETTINGS_KEY,
    STATE,
    buildFileName,
    normalizeSettings,
  });

  scope.RegionSnapShared = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
