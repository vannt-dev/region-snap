const primaryButton = document.getElementById("primary-action");
const secondaryButton = document.getElementById("secondary-action");
const primaryLabel = document.getElementById("primary-label");
const primaryShortcut = document.getElementById("primary-shortcut");
const secondaryShortcut = document.getElementById("secondary-shortcut");
const stateLabel = document.getElementById("state-label");
const stateDetail = document.getElementById("state-detail");
const errorMessage = document.getElementById("error-message");
const { DEFAULT_SHORTCUTS, MESSAGE, STATE } = globalThis.RegionSnapShared;

let primaryCommand = MESSAGE.START_PICKING;
let shortcuts = { ...DEFAULT_SHORTCUTS };

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function setBusy(busy) {
  document.body.classList.toggle("is-busy", busy);
  primaryButton.disabled = busy || document.body.dataset.state === "unsupported";
  secondaryButton.disabled = busy;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function showShortcut(element, shortcut) {
  element.textContent = shortcut || "";
  element.hidden = !shortcut;
}

function setStatus(status) {
  const state = status?.supported === false ? STATE.UNSUPPORTED : status?.state || STATE.IDLE;
  document.body.dataset.state = state;
  document.body.classList.remove("is-loading");
  showError("");

  if (state === STATE.LOCKED) {
    const width = Math.round(status.rect?.width || 0);
    const height = Math.round(status.rect?.height || 0);
    stateLabel.textContent = t("popupLocked");
    stateDetail.textContent = `${width} × ${height} px`;
    primaryLabel.textContent = `${t("popupCapture")} · ${width} × ${height}`;
    showShortcut(primaryShortcut, shortcuts["capture-region"]);
    primaryCommand = MESSAGE.DO_CAPTURE;
    secondaryButton.hidden = false;
  } else if (state === STATE.HOVERING || state === STATE.DRAGGING) {
    stateLabel.textContent = t("popupSelecting");
    stateDetail.textContent = t("popupFlow");
    primaryLabel.textContent = t("popupSelect");
    showShortcut(primaryShortcut, shortcuts["toggle-picker"]);
    primaryCommand = MESSAGE.START_PICKING;
    secondaryButton.hidden = true;
  } else if (state === STATE.UNSUPPORTED) {
    stateLabel.textContent = t("popupUnavailable");
    stateDetail.textContent = status.error || t("errorUnsupportedPage");
    primaryLabel.textContent = t("popupSelect");
    showShortcut(primaryShortcut, shortcuts["toggle-picker"]);
    primaryCommand = MESSAGE.START_PICKING;
    secondaryButton.hidden = true;
    showError(status.error || t("errorUnsupportedPage"));
  } else {
    stateLabel.textContent = t("popupReady");
    stateDetail.textContent = t("popupFlow");
    primaryLabel.textContent = t("popupSelect");
    showShortcut(primaryShortcut, shortcuts["toggle-picker"]);
    primaryCommand = MESSAGE.START_PICKING;
    secondaryButton.hidden = true;
  }

  setBusy(false);
}

async function runCommand(command) {
  setBusy(true);
  showError("");
  stateDetail.textContent = t("popupConnecting");

  try {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE.RUN_COMMAND, command });
    if (!response?.ok) throw new Error(response?.error || t("popupGenericError"));
    window.close();
  } catch (error) {
    setBusy(false);
    showError(error?.message || t("popupConnectionError"));
  }
}

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    shortcuts = {
      ...shortcuts,
      ...Object.fromEntries(commands.map((command) => [command.name, command.shortcut || ""])),
    };
    showShortcut(secondaryShortcut, shortcuts["toggle-picker"]);
    showShortcut(
      primaryShortcut,
      primaryCommand === MESSAGE.DO_CAPTURE
        ? shortcuts["capture-region"]
        : shortcuts["toggle-picker"],
    );
  } catch {
    // Keep the suggested shortcuts if Chrome does not return user preferences.
  }
}

async function loadStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: MESSAGE.GET_ACTIVE_STATUS });
    setStatus(status);
  } catch (error) {
    setStatus({ supported: false, error: error?.message || t("popupConnectionError") });
  }
}

primaryButton.addEventListener("click", () => runCommand(primaryCommand));
secondaryButton.addEventListener("click", () => runCommand(MESSAGE.START_PICKING));

localizeDocument();
Promise.all([loadShortcuts(), loadStatus()]);
