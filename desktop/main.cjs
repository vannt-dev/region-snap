const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  displayLayout,
  getNativeCropBounds,
  getVirtualBounds,
  intersectRect,
  sameDisplayLayout,
  validateSelection,
} = require("./capture-utils.cjs");

const DEFAULT_SETTINGS = Object.freeze({
  shortcut: "Alt+Shift+S",
  outputDirectory: "",
  copyToClipboard: true,
  openAtLogin: false,
});
const MAX_CAPTURE_BYTES = 100 * 1024 * 1024;
const OVERLAY_HIDE_DELAY_MS = 180;
const E2E_MODE = process.env.REGION_SNAP_E2E === "1";
const MAIN_COPY = Object.freeze({
  en: {
    capture: "Capture region",
    settings: "Settings…",
    openFolder: "Open screenshot folder",
    quit: "Quit",
    captureFailed: "Could not capture the screen.",
    captureSaved: "Screenshot saved to {path}",
    chooseFolder: "Choose screenshot folder",
  },
  vi: {
    capture: "Chụp vùng",
    settings: "Cài đặt…",
    openFolder: "Mở thư mục ảnh",
    quit: "Thoát",
    captureFailed: "Không thể chụp màn hình.",
    captureSaved: "Đã lưu ảnh vào {path}",
    chooseFolder: "Chọn thư mục lưu ảnh",
  },
});
const overlayWindows = new Map();
let tray = null;
let settingsWindow = null;
let settings = { ...DEFAULT_SETTINGS };
let captureInProgress = false;
let quitting = false;

if (E2E_MODE && process.env.REGION_SNAP_E2E_USER_DATA) {
  app.setPath("userData", process.env.REGION_SNAP_E2E_USER_DATA);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const outputDirectory = () =>
  settings.outputDirectory || path.join(app.getPath("pictures"), "Region Snap");
const uiLocale = () => {
  const locale = process.env.REGION_SNAP_E2E_LOCALE || app.getLocale();
  return locale.toLowerCase().startsWith("vi") ? "vi" : "en";
};
const mainCopy = (key, values = {}) =>
  Object.entries(values).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, value),
    MAIN_COPY[uiLocale()][key],
  );

function sanitizeSettings(candidate = {}) {
  return {
    shortcut:
      typeof candidate.shortcut === "string" && candidate.shortcut.trim()
        ? candidate.shortcut.trim()
        : DEFAULT_SETTINGS.shortcut,
    outputDirectory:
      typeof candidate.outputDirectory === "string" ? candidate.outputDirectory.trim() : "",
    copyToClipboard: candidate.copyToClipboard !== false,
    openAtLogin: candidate.openAtLogin === true,
  };
}

async function loadSettings() {
  try {
    settings = sanitizeSettings(JSON.parse(await fs.readFile(settingsPath(), "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Region Snap settings:", error);
  }
}

async function persistSettings(value = settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporaryPath = `${settingsPath()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, settingsPath());
}

function applyLoginSetting() {
  if (app.isPackaged && process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
  }
}

function registerCaptureShortcut(accelerator = settings.shortcut) {
  globalShortcut.unregisterAll();
  const registered = globalShortcut.register(accelerator, () => startCapture().catch(showError));
  if (!registered) throw new Error(`Không thể đăng ký phím tắt ${accelerator}.`);
}

function timestamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    "-",
    String(now.getMilliseconds()).padStart(3, "0"),
  ].join("");
}

function closeOverlays() {
  for (const window of overlayWindows.keys()) if (!window.isDestroyed()) window.destroy();
  overlayWindows.clear();
}

function setOverlaysVisible(visible) {
  for (const window of overlayWindows.keys()) {
    if (window.isDestroyed()) continue;
    if (visible) window.show();
    else window.hide();
  }
}

function sourceForDisplay(sources, display, index) {
  return (
    sources.find((source) => String(source.display_id) === String(display.id)) || sources[index]
  );
}

async function captureDisplay(display, index) {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    },
  });
  return sourceForDisplay(sources, display, index);
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && url !== currentUrl) event.preventDefault();
  });
}

async function startCapture() {
  if (overlayWindows.size) {
    closeOverlays();
    return;
  }
  const displays = screen.getAllDisplays();
  const virtualBounds = getVirtualBounds(displays);
  const layout = displayLayout(displays, virtualBounds);
  const overlay = new BrowserWindow({
    ...virtualBounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    thickFrame: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWindow(overlay);
  overlayWindows.set(overlay, { virtualBounds, layout });
  overlay.on("closed", () => overlayWindows.delete(overlay));
  await overlay.loadFile(path.join(__dirname, "overlay.html"), { query: { lang: uiLocale() } });
  overlay.show();
  overlay.setBounds(virtualBounds, false);
  await wait(50);
  overlay.setBounds(virtualBounds, false);
  overlay.webContents.send("capture-ready", { layout });
}

async function captureSources(event, payload) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const state = owner && overlayWindows.get(owner);
  if (!owner || !state) throw new Error("Yêu cầu chụp ảnh không hợp lệ.");
  if (captureInProgress) throw new Error("Một ảnh khác đang được xử lý.");
  const selection = validateSelection(payload, state.virtualBounds);
  const displays = screen.getAllDisplays();
  const currentVirtualBounds = getVirtualBounds(displays);
  const currentLayout = displayLayout(displays, currentVirtualBounds);
  if (!sameDisplayLayout(state.layout, currentLayout)) {
    throw new Error("Cấu hình màn hình đã thay đổi. Hãy chọn vùng lại.");
  }

  captureInProgress = true;
  setOverlaysVisible(false);
  try {
    await wait(OVERLAY_HIDE_DELAY_MS);
    const pieces = [];
    for (const [index, display] of displays.entries()) {
      const displayBounds = currentLayout[index].bounds;
      const pieceBounds = intersectRect(selection.rect, {
        left: displayBounds.x,
        top: displayBounds.y,
        width: displayBounds.width,
        height: displayBounds.height,
      });
      if (!pieceBounds) continue;

      const source = await captureDisplay(display, index);
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error("Không thể chụp đầy đủ các màn hình.");
      }
      const sourceSize = source.thumbnail.getSize();
      const relativeBounds = {
        left: pieceBounds.left - displayBounds.x,
        top: pieceBounds.top - displayBounds.y,
        width: pieceBounds.width,
        height: pieceBounds.height,
      };
      const cropBounds = getNativeCropBounds(
        relativeBounds,
        { width: displayBounds.width, height: displayBounds.height },
        sourceSize,
      );
      const image = source.thumbnail.crop(cropBounds);
      const scale = {
        x: sourceSize.width / displayBounds.width,
        y: sourceSize.height / displayBounds.height,
      };
      pieces.push({
        bounds: pieceBounds,
        dataUrl: image.toDataURL(),
        imageSize: image.getSize(),
        scale,
        sourceRect: {
          left: relativeBounds.left * scale.x - cropBounds.x,
          top: relativeBounds.top * scale.y - cropBounds.y,
          width: relativeBounds.width * scale.x,
          height: relativeBounds.height * scale.y,
        },
      });
    }
    if (!pieces.length) throw new Error("Vùng chụp không nằm trên màn hình nào.");
    return { selection, pieces };
  } catch (error) {
    captureInProgress = false;
    setOverlaysVisible(true);
    throw error;
  }
}

function mostlyBlack(image) {
  const bitmap = image.toBitmap();
  const pixelCount = bitmap.length / 4;
  const step = Math.max(1, Math.floor(pixelCount / 5000));
  let sampled = 0;
  let black = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    sampled += 1;
    if (bitmap[offset] < 8 && bitmap[offset + 1] < 8 && bitmap[offset + 2] < 8) black += 1;
  }
  return sampled > 0 && black / sampled > 0.995;
}

async function uniqueOutputPath(directory) {
  const base = `region-snap-${timestamp()}`;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = path.join(directory, `${base}${suffix ? `-${suffix}` : ""}.png`);
    try {
      await fs.access(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("Không thể tạo tên file ảnh duy nhất.");
}

async function saveCapture(event, dataUrl) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !overlayWindows.has(owner) || !captureInProgress) {
    throw new Error("Yêu cầu lưu ảnh không hợp lệ.");
  }
  try {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Dữ liệu ảnh không hợp lệ.");
    }
    const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) {
      throw new Error("Kích thước ảnh không hợp lệ.");
    }
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error("Không thể đọc ảnh đã chụp.");
    const directory = outputDirectory();
    await fs.mkdir(directory, { recursive: true });
    const outputPath = await uniqueOutputPath(directory);
    await fs.writeFile(outputPath, image.toPNG(), { flag: "wx" });
    if (settings.copyToClipboard) clipboard.writeImage(image);
    const protectedWarning = mostlyBlack(image);
    closeOverlays();
    showCaptureSuccess(outputPath);
    if (protectedWarning) {
      showError(
        new Error("Ảnh gần như toàn màu đen. Nội dung có thể đang được DRM hoặc Windows bảo vệ."),
      );
    }
    return { outputPath, copiedToClipboard: settings.copyToClipboard, protectedWarning };
  } catch (error) {
    setOverlaysVisible(true);
    throw error;
  } finally {
    captureInProgress = false;
  }
}

function restoreCapture(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (owner && overlayWindows.has(owner)) setOverlaysVisible(true);
  captureInProgress = false;
}

function createTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `${mainCopy("capture")} (${settings.shortcut})`,
        click: () => startCapture().catch(showError),
      },
      { label: mainCopy("settings"), click: openSettingsWindow },
      { type: "separator" },
      {
        label: mainCopy("openFolder"),
        click: async () => {
          await fs.mkdir(outputDirectory(), { recursive: true });
          const error = await shell.openPath(outputDirectory());
          if (error) showError(new Error(error));
        },
      },
      { type: "separator" },
      {
        label: mainCopy("quit"),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(path.join(__dirname, "..", "icons", "icon32.png"));
  tray.setToolTip("Region Snap Desktop");
  createTrayMenu();
  tray.on("double-click", () => startCapture().catch(showError));
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 570,
    minWidth: 520,
    minHeight: 530,
    title: "Cài đặt Region Snap",
    autoHideMenuBar: true,
    backgroundColor: "#0e131b",
    webPreferences: {
      preload: path.join(__dirname, "settings-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWindow(settingsWindow);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"), { query: { lang: uiLocale() } });
}

async function saveSettings(_event, candidate) {
  const previous = settings;
  const next = sanitizeSettings(candidate);
  if (next.shortcut !== previous.shortcut) {
    try {
      registerCaptureShortcut(next.shortcut);
    } catch (error) {
      registerCaptureShortcut(previous.shortcut);
      throw error;
    }
  }
  try {
    await persistSettings(next);
  } catch (error) {
    if (next.shortcut !== previous.shortcut) registerCaptureShortcut(previous.shortcut);
    throw error;
  }
  settings = next;
  applyLoginSetting();
  createTrayMenu();
  return { ...settings, packaged: app.isPackaged };
}

function showError(error) {
  console.error("Region Snap Desktop:", error);
  if (tray) {
    tray.displayBalloon({
      title: "Region Snap",
      content: error?.message || mainCopy("captureFailed"),
    });
  }
}

function showCaptureSuccess(outputPath) {
  if (!tray) return;
  tray.displayBalloon({
    title: "Region Snap",
    content: mainCopy("captureSaved", { path: outputPath }),
  });
}

ipcMain.on("cancel-capture", closeOverlays);
ipcMain.on("restore-capture", restoreCapture);
ipcMain.handle("capture-sources", captureSources);
ipcMain.handle("save-capture", saveCapture);
ipcMain.handle("get-settings", () => ({ ...settings, packaged: app.isPackaged }));
ipcMain.handle("choose-output-directory", async () => {
  const result = await dialog.showOpenDialog(settingsWindow || undefined, {
    title: mainCopy("chooseFolder"),
    defaultPath: outputDirectory(),
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("save-settings", saveSettings);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => startCapture().catch(showError));
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("dev.vannt.region-snap.desktop");
    await loadSettings();
    if (E2E_MODE) {
      openSettingsWindow();
      return;
    }
    createTray();
    applyLoginSetting();
    try {
      registerCaptureShortcut();
    } catch (error) {
      settings.shortcut = DEFAULT_SETTINGS.shortcut;
      try {
        registerCaptureShortcut(DEFAULT_SETTINGS.shortcut);
      } catch (fallbackError) {
        showError(
          new Error(
            `${error.message} Phím tắt mặc định cũng không khả dụng: ${fallbackError.message}`,
          ),
        );
        return;
      }
      try {
        await persistSettings();
        showError(
          new Error(
            `${error.message} Đã chuyển về phím tắt mặc định ${DEFAULT_SETTINGS.shortcut}.`,
          ),
        );
      } catch (persistError) {
        showError(
          new Error(
            `${error.message} Đang dùng ${DEFAULT_SETTINGS.shortcut}, nhưng không thể lưu cấu hình: ${persistError.message}`,
          ),
        );
      }
    }
  });
}

app.on("window-all-closed", () => {
  // The tray application intentionally stays alive without windows.
});
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  closeOverlays();
});
app.on("activate", () => {
  if (!quitting) openSettingsWindow();
});
