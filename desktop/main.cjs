/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
const {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
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
const { copyTextFromImage, createTesseractRecognizer, ocrScale } = require("./ocr.cjs");
const {
  clampOpacity,
  dragBounds,
  initialPinBounds,
  keepOnScreen,
  nextOpacity,
  nextScale,
  sameAccelerator,
  scaledBounds,
} = require("./pin-utils.cjs");

const DEFAULT_SETTINGS = Object.freeze({
  shortcut: "Alt+Shift+S",
  pinShortcut: "",
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
    textCopiedOne: "Copied 1 line of text",
    textCopied: "Copied {count} lines of text",
    pinLast: "Pin last capture",
    closePins: "Close all pins",
    noLastCapture: "There is no capture to pin yet.",
    pinCopy: "Copy",
    pinSave: "Save",
    pinSaveAs: "Save as…",
    pinOpacity: "Opacity",
    pinActualSize: "Actual size",
    pinClose: "Close",
    pinCopied: "Copied",
    pinSaved: "Saved",
    sameShortcut: "The capture and pin shortcuts must be different.",
    pinShortcutDisabled: "The pin shortcut was turned off.",
  },
  vi: {
    capture: "Chụp vùng",
    settings: "Cài đặt…",
    openFolder: "Mở thư mục ảnh",
    quit: "Thoát",
    captureFailed: "Không thể chụp màn hình.",
    captureSaved: "Đã lưu ảnh vào {path}",
    chooseFolder: "Chọn thư mục lưu ảnh",
    textCopiedOne: "Đã sao chép 1 dòng chữ",
    textCopied: "Đã sao chép {count} dòng chữ",
    pinLast: "Ghim ảnh vừa chụp",
    closePins: "Đóng mọi ảnh ghim",
    noLastCapture: "Chưa có ảnh nào để ghim.",
    pinCopy: "Sao chép",
    pinSave: "Lưu",
    pinSaveAs: "Lưu thành…",
    pinOpacity: "Độ mờ",
    pinActualSize: "Kích thước gốc",
    pinClose: "Đóng",
    pinCopied: "Đã sao chép",
    pinSaved: "Đã lưu",
    sameShortcut: "Phím tắt chụp và phím tắt ghim phải khác nhau.",
    pinShortcutDisabled: "Đã tắt phím tắt ghim ảnh.",
  },
});
const PIN_OPACITY_PRESETS = Object.freeze([1, 0.8, 0.6, 0.4]);
const overlayWindows = new Map();
const pinWindows = new Map();
let lastCapture = null;
let tray = null;
let settingsWindow = null;
let settings = { ...DEFAULT_SETTINGS };
let captureInProgress = false;
let quitting = false;
let recognizeText = null;

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
    pinShortcut: typeof candidate.pinShortcut === "string" ? candidate.pinShortcut.trim() : "",
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

function registerShortcut(accelerator, callback) {
  let registered;
  try {
    registered = globalShortcut.register(accelerator, callback);
  } catch {
    // An accelerator Electron cannot parse is reported like one that is taken.
  }
  if (!registered) throw new Error(`Không thể đăng ký phím tắt ${accelerator}.`);
}

// Registers the capture shortcut and, when set, the pin shortcut. Either both are registered or
// the error is thrown with none left registered.
function registerShortcuts({ shortcut, pinShortcut } = settings) {
  if (pinShortcut && sameAccelerator(shortcut, pinShortcut)) {
    throw new Error(mainCopy("sameShortcut"));
  }
  globalShortcut.unregisterAll();
  try {
    registerShortcut(shortcut, () => startCapture().catch(showError));
    if (pinShortcut) registerShortcut(pinShortcut, pinLastCapture);
  } catch (error) {
    globalShortcut.unregisterAll();
    throw error;
  }
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
  state.selection = selection.rect;

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

// Electron 45 replaced clipboard.writeImage with the asynchronous ClipboardItem API.
async function writeClipboardImage(image) {
  if (typeof clipboard.writeImage === "function") {
    clipboard.writeImage(image);
    return;
  }
  const png = new Blob([image.toPNG()], { type: "image/png" });
  await clipboard.write([new ClipboardItem({ "image/png": png })]);
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

function assertCaptureRequest(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !overlayWindows.has(owner) || !captureInProgress) {
    throw new Error("Yêu cầu lưu ảnh không hợp lệ.");
  }
  return overlayWindows.get(owner);
}

function rememberCapture(image, state) {
  if (!state?.selection) return;
  lastCapture = { image, bounds: initialPinBounds(state.selection, state.virtualBounds) };
  createTrayMenu();
}

function decodeCapture(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Dữ liệu ảnh không hợp lệ.");
  }
  const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  if (!bytes.length || bytes.length > MAX_CAPTURE_BYTES) {
    throw new Error("Kích thước ảnh không hợp lệ.");
  }
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error("Không thể đọc ảnh đã chụp.");
  return image;
}

async function saveCapture(event, dataUrl) {
  const state = assertCaptureRequest(event);
  try {
    const image = decodeCapture(dataUrl);
    const directory = outputDirectory();
    await fs.mkdir(directory, { recursive: true });
    const outputPath = await uniqueOutputPath(directory);
    await fs.writeFile(outputPath, image.toPNG(), { flag: "wx" });
    if (settings.copyToClipboard) await writeClipboardImage(image);
    rememberCapture(image, state);
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

function textRecognizer() {
  recognizeText ??= createTesseractRecognizer({
    languageDirectory: path.join(app.getPath("userData"), "ocr-languages"),
  });
  return recognizeText;
}

async function copyCaptureText(event, dataUrl) {
  assertCaptureRequest(event);
  try {
    const image = decodeCapture(dataUrl);
    const size = image.getSize();
    const scale = ocrScale(size);
    const scaled =
      scale > 1
        ? image.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
            quality: "best",
          })
        : image;
    const { lineCount } = await copyTextFromImage(scaled.toPNG(), {
      recognize: textRecognizer(),
      writeText: (text) => clipboard.writeText(text),
    });
    if (lineCount) {
      closeOverlays();
      showNotice(
        lineCount === 1 ? mainCopy("textCopiedOne") : mainCopy("textCopied", { count: lineCount }),
      );
    } else {
      setOverlaysVisible(true);
    }
    return { lineCount };
  } catch (error) {
    setOverlaysVisible(true);
    throw error;
  } finally {
    captureInProgress = false;
  }
}

async function pinCapture(event, dataUrl) {
  const state = assertCaptureRequest(event);
  try {
    const image = decodeCapture(dataUrl);
    if (!state.selection) throw new Error("Yêu cầu ghim ảnh không hợp lệ.");
    const bounds = initialPinBounds(state.selection, state.virtualBounds);
    closeOverlays();
    await createPin(image, bounds);
    rememberCapture(image, state);
    return { pinned: true };
  } catch (error) {
    // Once the overlay is gone nothing shows the error, so the tray does.
    if (overlayWindows.size) setOverlaysVisible(true);
    else showError(error);
    throw error;
  } finally {
    captureInProgress = false;
  }
}

// Shows `image` in a small always-on-top window at `requestedBounds` (logical screen pixels). The
// image stays in the main process; the pin page only displays it and asks for actions on itself.
async function createPin(image, requestedBounds) {
  const display = screen.getDisplayMatching(requestedBounds);
  const bounds = keepOnScreen(requestedBounds, display.bounds);
  const pin = new BrowserWindow({
    ...bounds,
    title: "Region Snap",
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    thickFrame: false,
    hasShadow: true,
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "pin-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWindow(pin);
  pin.setAlwaysOnTop(true, "floating");
  pinWindows.set(pin, {
    image,
    baseSize: { width: bounds.width, height: bounds.height },
    bounds,
    scale: 1,
    opacity: 1,
    drag: null,
  });
  pin.on("closed", () => {
    pinWindows.delete(pin);
    createTrayMenu();
  });
  createTrayMenu();
  await pin.loadFile(path.join(__dirname, "pin.html"), { query: { lang: uiLocale() } });
  if (pin.isDestroyed()) return;
  pin.setBounds(bounds, false);
  pin.show();
}

async function pinLastCapture() {
  if (!lastCapture) {
    showNotice(mainCopy("noLastCapture"));
    return;
  }
  await createPin(lastCapture.image, lastCapture.bounds).catch(showError);
}

function closePins() {
  for (const pin of pinWindows.keys()) if (!pin.isDestroyed()) pin.destroy();
  pinWindows.clear();
  createTrayMenu();
}

// The pin that sent an IPC message, or null for any other sender: a pin acts only on itself.
function pinFromEvent(event) {
  const pin = BrowserWindow.fromWebContents(event.sender);
  const state = pin && pinWindows.get(pin);
  return state && !pin.isDestroyed() ? { pin, state } : null;
}

function setPinBounds(pin, state, bounds) {
  state.bounds = bounds;
  pin.setBounds(bounds, false);
}

function pinNotice(pin, message) {
  if (!pin.isDestroyed()) pin.webContents.send("pin-notice", message);
}

function zoomPin(pin, state, scale, anchor) {
  state.scale = scale;
  setPinBounds(pin, state, scaledBounds(state.bounds, state.baseSize, scale, anchor));
  pinNotice(pin, `${Math.round(scale * 100)}%`);
}

function setPinOpacity(pin, state, opacity) {
  state.opacity = clampOpacity(opacity);
  pin.setOpacity(state.opacity);
  pinNotice(pin, `${Math.round(state.opacity * 100)}%`);
}

async function copyPin(pin, state) {
  await writeClipboardImage(state.image);
  pinNotice(pin, mainCopy("pinCopied"));
}

async function savePin(pin, state) {
  const directory = outputDirectory();
  await fs.mkdir(directory, { recursive: true });
  const outputPath = await uniqueOutputPath(directory);
  await fs.writeFile(outputPath, state.image.toPNG(), { flag: "wx" });
  pinNotice(pin, mainCopy("pinSaved"));
  showCaptureSuccess(outputPath);
}

async function savePinAs(pin, state) {
  const result = await dialog.showSaveDialog(pin, {
    defaultPath: path.join(outputDirectory(), `region-snap-${timestamp()}.png`),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) return;
  const outputPath = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`;
  await fs.writeFile(outputPath, state.image.toPNG());
  pinNotice(pin, mainCopy("pinSaved"));
  showCaptureSuccess(outputPath);
}

function showPinMenu(pin, state) {
  Menu.buildFromTemplate([
    {
      label: mainCopy("pinCopy"),
      accelerator: "CommandOrControl+C",
      click: () => copyPin(pin, state).catch(showError),
    },
    {
      label: mainCopy("pinSave"),
      accelerator: "CommandOrControl+S",
      click: () => savePin(pin, state).catch(showError),
    },
    {
      label: mainCopy("pinSaveAs"),
      accelerator: "CommandOrControl+Shift+S",
      click: () => savePinAs(pin, state).catch(showError),
    },
    { type: "separator" },
    {
      label: mainCopy("pinOpacity"),
      submenu: PIN_OPACITY_PRESETS.map((opacity) => ({
        label: `${Math.round(opacity * 100)}%`,
        type: "radio",
        checked: Math.abs(state.opacity - opacity) < 0.005,
        click: () => setPinOpacity(pin, state, opacity),
      })),
    },
    {
      label: mainCopy("pinActualSize"),
      accelerator: "CommandOrControl+0",
      enabled: state.scale !== 1,
      click: () => zoomPin(pin, state, 1),
    },
    { type: "separator" },
    { label: mainCopy("pinClose"), accelerator: "Esc", click: () => pin.close() },
    { label: mainCopy("closePins"), click: closePins },
  ]).popup({ window: pin });
}

// Wraps a pin IPC handler so it runs only for a live pin window, on that pin's own state.
const forPin =
  (handler) =>
  (event, ...args) => {
    const target = pinFromEvent(event);
    if (!target) return undefined;
    return handler(target.pin, target.state, ...args);
  };

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
      {
        label: settings.pinShortcut
          ? `${mainCopy("pinLast")} (${settings.pinShortcut})`
          : mainCopy("pinLast"),
        enabled: Boolean(lastCapture),
        click: pinLastCapture,
      },
      { label: mainCopy("closePins"), enabled: pinWindows.size > 0, click: closePins },
      { type: "separator" },
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
    height: 740,
    minWidth: 520,
    minHeight: 700,
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
  const shortcutsChanged =
    next.shortcut !== previous.shortcut || next.pinShortcut !== previous.pinShortcut;
  if (next.pinShortcut && sameAccelerator(next.shortcut, next.pinShortcut)) {
    throw new Error(mainCopy("sameShortcut"));
  }
  if (shortcutsChanged) {
    try {
      registerShortcuts(next);
    } catch (error) {
      registerShortcuts(previous);
      throw error;
    }
  }
  try {
    await persistSettings(next);
  } catch (error) {
    if (shortcutsChanged) registerShortcuts(previous);
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

function showNotice(content) {
  if (!tray) return;
  tray.displayBalloon({ title: "Region Snap", content });
}

function showCaptureSuccess(outputPath) {
  showNotice(mainCopy("captureSaved", { path: outputPath }));
}

ipcMain.on("cancel-capture", closeOverlays);
ipcMain.on("restore-capture", restoreCapture);
ipcMain.handle("capture-sources", captureSources);
ipcMain.handle("save-capture", saveCapture);
ipcMain.handle("copy-text", copyCaptureText);
ipcMain.handle("pin-capture", pinCapture);
ipcMain.handle(
  "pin-image",
  forPin((_pin, state) => ({ dataUrl: state.image.toDataURL() })),
);
ipcMain.on(
  "pin-close",
  forPin((pin) => pin.close()),
);
ipcMain.on(
  "pin-copy",
  forPin((pin, state) => copyPin(pin, state).catch(showError)),
);
ipcMain.on(
  "pin-save",
  forPin((pin, state) => savePin(pin, state).catch(showError)),
);
ipcMain.on(
  "pin-save-as",
  forPin((pin, state) => savePinAs(pin, state).catch(showError)),
);
ipcMain.on(
  "pin-menu",
  forPin((pin, state) => showPinMenu(pin, state)),
);
ipcMain.on(
  "pin-zoom",
  forPin((pin, state, payload) =>
    zoomPin(pin, state, nextScale(state.scale, payload?.deltaY, state.baseSize), payload),
  ),
);
ipcMain.on(
  "pin-reset-zoom",
  forPin((pin, state) => zoomPin(pin, state, 1)),
);
ipcMain.on(
  "pin-opacity",
  forPin((pin, state, deltaY) => setPinOpacity(pin, state, nextOpacity(state.opacity, deltaY))),
);
ipcMain.on(
  "pin-drag-start",
  forPin((_pin, state, pointer) => {
    if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) return;
    state.drag = { bounds: state.bounds, pointer: { x: pointer.x, y: pointer.y } };
  }),
);
ipcMain.on(
  "pin-drag-move",
  forPin((pin, state, pointer) => {
    if (!state.drag) return;
    setPinBounds(pin, state, dragBounds(state.drag.bounds, state.drag.pointer, pointer));
  }),
);
ipcMain.on(
  "pin-drag-end",
  forPin((_pin, state) => {
    state.drag = null;
  }),
);
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

// At startup a shortcut another app already holds is dropped instead of leaving Region Snap without
// one: first the pin shortcut, then the capture shortcut goes back to the default.
async function recoverShortcuts(error) {
  const candidates = [
    { shortcut: settings.shortcut, pinShortcut: "" },
    { shortcut: DEFAULT_SETTINGS.shortcut, pinShortcut: settings.pinShortcut },
    { shortcut: DEFAULT_SETTINGS.shortcut, pinShortcut: "" },
  ].filter(
    (candidate) =>
      !candidate.pinShortcut || !sameAccelerator(candidate.shortcut, candidate.pinShortcut),
  );
  let fallbackError = error;
  const recovered = candidates.find((candidate) => {
    try {
      registerShortcuts(candidate);
      return true;
    } catch (candidateError) {
      fallbackError = candidateError;
      return false;
    }
  });
  if (!recovered) {
    showError(
      new Error(`${error.message} Phím tắt mặc định cũng không khả dụng: ${fallbackError.message}`),
    );
    return;
  }
  const message =
    recovered.shortcut === settings.shortcut
      ? `${error.message} ${mainCopy("pinShortcutDisabled")}`
      : `${error.message} Đã chuyển về phím tắt mặc định ${DEFAULT_SETTINGS.shortcut}.`;
  settings = { ...settings, ...recovered };
  createTrayMenu();
  try {
    await persistSettings();
    showError(new Error(message));
  } catch (persistError) {
    showError(
      new Error(
        `${error.message} Đang dùng ${recovered.shortcut}, nhưng không thể lưu cấu hình: ${persistError.message}`,
      ),
    );
  }
}

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
      registerShortcuts();
    } catch (error) {
      await recoverShortcuts(error);
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
  closePins();
});
app.on("activate", () => {
  if (!quitting) openSettingsWindow();
});
