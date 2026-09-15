((scope) => {
  const MESSAGE = Object.freeze({
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
    "capture-region": MESSAGE.DO_CAPTURE,
    "toggle-picker": MESSAGE.START_PICKING,
  });

  const DEFAULT_SHORTCUTS = Object.freeze({
    "capture-region": "Alt+Shift+C",
    "toggle-picker": "Alt+Shift+S",
  });

  const api = Object.freeze({
    ALLOWED_PROTOCOLS: Object.freeze(["http:", "https:", "file:"]),
    COMMAND_TO_MESSAGE,
    DEFAULT_SHORTCUTS,
    MESSAGE,
    STATE,
  });

  scope.RegionSnapShared = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
