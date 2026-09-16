(() => {
  const api = globalThis.regionSnapSettings;
  const { translate } = globalThis.RegionSnapI18n;
  const form = document.getElementById("settings-form");
  const shortcut = document.getElementById("shortcut");
  const outputDirectory = document.getElementById("output-directory");
  const copyToClipboard = document.getElementById("copy-to-clipboard");
  const openAtLogin = document.getElementById("open-at-login");
  const chooseDirectory = document.getElementById("choose-directory");
  const loginNote = document.getElementById("login-note");
  const status = document.getElementById("status");

  function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function render(settings) {
    shortcut.value = settings.shortcut;
    outputDirectory.value = settings.outputDirectory;
    copyToClipboard.checked = settings.copyToClipboard;
    openAtLogin.checked = settings.openAtLogin;
    loginNote.hidden = settings.packaged;
  }

  chooseDirectory.addEventListener("click", async () => {
    const directory = await api.chooseOutputDirectory();
    if (directory) outputDirectory.value = directory;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showStatus(translate("saving"));
    try {
      const saved = await api.save({
        shortcut: shortcut.value,
        outputDirectory: outputDirectory.value,
        copyToClipboard: copyToClipboard.checked,
        openAtLogin: openAtLogin.checked,
      });
      render(saved);
      showStatus(translate("saved"));
    } catch (error) {
      showStatus(error?.message || translate("saveFailed"), true);
    }
  });

  api
    .get()
    .then(render)
    .catch((error) => showStatus(error?.message, true));
})();
