const {
  DEFAULT_SETTINGS,
  FILE_NAME_PREFIX_MAX_LENGTH,
  SETTINGS_KEY,
  buildFileName,
  normalizeSettings,
} = globalThis.RegionSnapShared;

const form = document.getElementById("settings-form");
const example = document.getElementById("file-name-example");
const statusLabel = document.getElementById("status");
const prefixInput = form.elements.fileNamePrefix;

let statusTimer = null;

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function readForm() {
  return normalizeSettings({
    captureDelay: Number(form.elements.captureDelay.value),
    defaultAction: form.elements.defaultAction.value,
    fileNamePrefix: prefixInput.value,
    format: form.elements.format.value,
    roundedCorners: form.elements.roundedCorners.checked,
  });
}

function fillForm(settings) {
  form.elements.captureDelay.value = String(settings.captureDelay);
  form.elements.defaultAction.value = settings.defaultAction;
  form.elements.format.value = settings.format;
  form.elements.roundedCorners.checked = settings.roundedCorners;
  prefixInput.value = settings.fileNamePrefix;
  showExample(settings);
}

function showExample(settings) {
  example.textContent = buildFileName(settings, new Date());
}

function showStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("is-error", isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusLabel.textContent = "";
  }, 2000);
}

async function save(settings) {
  showExample(settings);
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    showStatus(t("optionsSaved"));
  } catch (error) {
    console.error("Region Snap could not save settings:", error);
    showStatus(t("optionsSaveError"), true);
  }
}

async function load() {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    fillForm(normalizeSettings(stored?.[SETTINGS_KEY]));
  } catch (error) {
    console.error("Region Snap could not load settings:", error);
    fillForm(normalizeSettings(null));
  }
}

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("change", () => {
  const settings = readForm();
  // Show the cleaned prefix so the field matches what was stored.
  prefixInput.value = settings.fileNamePrefix;
  save(settings);
});
prefixInput.addEventListener("input", () => showExample(readForm()));
document.getElementById("reset").addEventListener("click", () => {
  const settings = { ...DEFAULT_SETTINGS };
  fillForm(settings);
  save(settings);
});

prefixInput.maxLength = FILE_NAME_PREFIX_MAX_LENGTH;
localizeDocument();
load();
