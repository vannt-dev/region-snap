import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { ROOT } from "./project-config.mjs";

const userData = await fs.mkdtemp(path.join(os.tmpdir(), "region-snap-e2e-"));
const outputDirectory = path.join(userData, "captures");
let electronApp;

await fs.writeFile(
  path.join(userData, "settings.json"),
  `${JSON.stringify({ outputDirectory }, null, 2)}\n`,
  "utf8",
);

function pngSize(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "capture must be a PNG",
  );
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function waitUntil(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function captureSelection(displays) {
  for (let firstIndex = 0; firstIndex < displays.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < displays.length; secondIndex += 1) {
      const first = displays[firstIndex];
      const second = displays[secondIndex];
      const left = first.x <= second.x ? first : second;
      const right = left === first ? second : first;
      const boundary = left.x + left.width;
      const overlapTop = Math.max(left.y, right.y);
      const overlapBottom = Math.min(left.y + left.height, right.y + right.height);
      if (boundary === right.x && overlapBottom - overlapTop >= 160) {
        return { left: boundary - 100, top: overlapTop + 10, width: 200, height: 140 };
      }
    }
  }
  return { left: 40, top: 40, width: 200, height: 140 };
}

try {
  electronApp = await electron.launch({
    args: [path.join(ROOT, "desktop/main.cjs")],
    cwd: ROOT,
    env: {
      ...process.env,
      REGION_SNAP_E2E: "1",
      REGION_SNAP_E2E_LOCALE: "vi",
      REGION_SNAP_E2E_USER_DATA: userData,
    },
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  assert.equal(await window.title(), "Cài đặt Region Snap");
  assert.equal(await window.locator("#shortcut").inputValue(), "Alt+Shift+S");
  assert.equal(await window.locator("#output-directory").inputValue(), outputDirectory);
  assert.equal(await window.locator("#copy-to-clipboard").isChecked(), true);
  assert.equal(await window.locator("#open-at-login").isChecked(), false);
  assert.equal(await window.locator("#pin-shortcut").inputValue(), "", "pinning has no shortcut");
  assert.equal(await window.locator("#settings-form").isVisible(), true);

  await window.locator("#copy-to-clipboard").uncheck();
  await window.locator("#settings-form").evaluate((form) => form.requestSubmit());
  await window.locator("#status").getByText("Đã lưu cài đặt.").waitFor();

  const overlayPromise = electronApp.waitForEvent("window");
  await electronApp.evaluate(({ app }) => app.emit("second-instance"));
  const overlay = await overlayPromise;
  await overlay.waitForLoadState("domcontentloaded");
  const virtualDesktop = await electronApp.evaluate(({ screen }) => {
    const displays = screen.getAllDisplays();
    const left = Math.min(...displays.map(({ bounds }) => bounds.x));
    const top = Math.min(...displays.map(({ bounds }) => bounds.y));
    const right = Math.max(...displays.map(({ bounds }) => bounds.x + bounds.width));
    const bottom = Math.max(...displays.map(({ bounds }) => bounds.y + bounds.height));
    return {
      width: right - left,
      height: bottom - top,
      displays: displays.map(({ bounds }) => ({
        x: bounds.x - left,
        y: bounds.y - top,
        width: bounds.width,
        height: bounds.height,
      })),
    };
  });
  await overlay.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    virtualDesktop,
  );
  const overlayViewport = await overlay.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  assert.deepEqual(
    overlayViewport,
    { width: virtualDesktop.width, height: virtualDesktop.height },
    "overlay must cover the virtual desktop",
  );
  const selection = captureSelection(virtualDesktop.displays);
  await overlay.mouse.move(selection.left, selection.top);
  await overlay.mouse.down();
  await overlay.mouse.move(selection.left + selection.width, selection.top + selection.height);
  await overlay.mouse.up();
  const selector = overlay.locator("#selector");
  assert.equal(
    await overlay.locator("#copy-text").isVisible(),
    true,
    "the toolbar must offer Copy text",
  );
  const beforeMove = await selector.evaluate((element) => element.style.getPropertyValue("--x"));
  await overlay.locator("#move").press("ArrowRight");
  const afterMove = await selector.evaluate((element) => element.style.getPropertyValue("--x"));
  assert.notEqual(afterMove, beforeMove, "keyboard controls must move the selection");
  await overlay.locator("#capture").click();

  try {
    await overlay.waitForEvent("close", { timeout: 15_000 });
  } catch (error) {
    const status = await overlay.locator("#status").textContent();
    throw new Error(`Capture overlay did not close: ${status || error.message}`, { cause: error });
  }
  const captures = (await fs.readdir(outputDirectory)).filter((file) => file.endsWith(".png"));
  assert.equal(captures.length, 1);
  const capture = await fs.readFile(path.join(outputDirectory, captures[0]));
  const size = pngSize(capture);
  assert.ok(
    size.width >= selection.width && size.height >= selection.height,
    `unexpected capture size ${size.width}x${size.height}`,
  );
  console.log(`Desktop capture smoke test passed (${size.width}x${size.height}).`);

  // Pin a capture: an always-on-top, frameless window over the region, with zoom, opacity, drag,
  // copy, save and close.
  async function openOverlay() {
    const opened = electronApp.waitForEvent("window");
    await electronApp.evaluate(({ app }) => app.emit("second-instance"));
    const page = await opened;
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(
      ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
      virtualDesktop,
    );
    return page;
  }
  async function pinRegion(rect, pinWith) {
    const page = await openOverlay();
    await page.locator('#selector[data-ready="true"]').waitFor({ state: "attached" });
    await page.mouse.move(rect.left, rect.top);
    await page.mouse.down();
    await page.mouse.move(rect.left + rect.width, rect.top + rect.height);
    await page.mouse.up();
    const opened = electronApp.waitForEvent("window", { timeout: 15_000 });
    await pinWith(page);
    let pin;
    try {
      pin = await opened;
    } catch (error) {
      const state = await page.evaluate(() => ({
        status: globalThis.document.getElementById("status").textContent,
        selection: globalThis.document.getElementById("selector").dataset.hasSelection,
        state: globalThis.document.getElementById("selector").dataset.state,
        focus: globalThis.document.hasFocus(),
      }));
      state.windows = await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => w.webContents.getURL().split("/").pop()),
      );
      throw new Error(`The pin did not open: ${JSON.stringify(state)}`, { cause: error });
    }
    await pin.waitForLoadState("domcontentloaded");
    await pin.waitForFunction(() => globalThis.document.getElementById("image").naturalWidth > 0);
    return pin;
  }
  const pinWindows = () =>
    electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((pin) => !pin.isDestroyed() && !pin.webContents.isDestroyed())
        .filter((pin) => pin.webContents.getURL().includes("/pin.html"))
        .sort((first, second) => first.id - second.id)
        .map((pin) => {
          const preferences = pin.webContents.getLastWebPreferences() || {};
          return {
            bounds: pin.getBounds(),
            opacity: pin.getOpacity(),
            alwaysOnTop: pin.isAlwaysOnTop(),
            visible: pin.isVisible(),
            preferences: {
              contextIsolation: preferences.contextIsolation,
              nodeIntegration: preferences.nodeIntegration,
              sandbox: preferences.sandbox,
            },
          };
        }),
    );
  const pngFiles = async () =>
    (await fs.readdir(outputDirectory)).filter((file) => file.endsWith(".png")).sort();

  const pinRect = { left: 60, top: 60, width: 160, height: 120 };
  const pin = await pinRegion(pinRect, (page) => page.locator("#pin").click());
  let [pinned] = await waitUntil(async () => {
    const windows = await pinWindows();
    return windows.length === 1 && windows[0].visible && windows;
  }, "the pin window must open");
  assert.equal(pinned.alwaysOnTop, true, "a pin stays on top");
  assert.deepEqual(pinned.preferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
  assert.equal(await pin.evaluate(() => typeof require), "undefined", "no Node.js in a pin");
  assert.ok(
    Math.abs(pinned.bounds.width - pinRect.width) <= 1 &&
      Math.abs(pinned.bounds.height - pinRect.height) <= 1,
    `pin must match the region size, got ${pinned.bounds.width}x${pinned.bounds.height}`,
  );
  const imageSize = await pin.evaluate(() => {
    const image = globalThis.document.getElementById("image");
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.ok(imageSize.width >= pinRect.width && imageSize.height >= pinRect.height);

  await pin.mouse.move(pinRect.width / 2, pinRect.height / 2);
  await pin.mouse.wheel(0, -100);
  pinned = await waitUntil(async () => {
    const [current] = await pinWindows();
    return current.bounds.width > pinned.bounds.width && current;
  }, "the mouse wheel must zoom the pin");
  assert.ok(pinned.bounds.height > pinRect.height, "zoom keeps the aspect ratio");

  await pin.keyboard.down("Control");
  await pin.mouse.wheel(0, 200);
  await pin.keyboard.up("Control");
  pinned = await waitUntil(async () => {
    const [current] = await pinWindows();
    return current.opacity < 0.95 && current;
  }, "Ctrl+wheel must change the pin opacity");
  assert.ok(pinned.opacity >= 0.2, "a pin never becomes invisible");

  await pin.mouse.move(20, 20);
  await pin.mouse.down();
  await pin.mouse.move(60, 50);
  await pin.mouse.up();
  const start = pinned.bounds;
  pinned = await waitUntil(async () => {
    const [current] = await pinWindows();
    return current.bounds.x === start.x + 40 && current.bounds.y === start.y + 30 && current;
  }, "dragging must move the pin");
  assert.equal(pinned.bounds.width, start.width, "dragging keeps the pin size");

  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  await pin.keyboard.press("Control+c");
  const copied = await waitUntil(
    () =>
      electronApp.evaluate(async ({ clipboard }) => {
        const items = await clipboard.read();
        const item = items.find((entry) => entry.types.includes("image/png"));
        if (!item) return null;
        const bytes = new DataView(await (await item.getType("image/png")).arrayBuffer());
        return { width: bytes.getUint32(16), height: bytes.getUint32(20) };
      }),
    "Ctrl+C must copy the pinned image",
  );
  assert.deepEqual(copied, imageSize, "the clipboard gets the full-resolution capture");

  await pin.keyboard.press("Control+s");
  const saved = await waitUntil(async () => {
    const files = await pngFiles();
    return files.length === 2 && files;
  }, "Ctrl+S must save the pinned image");
  const savedPin = saved.find((file) => file !== captures[0]);
  assert.deepEqual(pngSize(await fs.readFile(path.join(outputDirectory, savedPin))), imageSize);

  const secondRect = { left: 260, top: 80, width: 120, height: 90 };
  // Only key down: the overlay closes as the pin opens, before a key up could reach it.
  const secondPin = await pinRegion(secondRect, (page) => page.keyboard.down("p"));
  await waitUntil(
    async () => (await pinWindows()).length === 2,
    "the P key must open a second pin beside the first",
  );

  const secondClosed = secondPin.waitForEvent("close");
  await secondPin.keyboard.down("Escape");
  await secondClosed;
  assert.equal((await pinWindows()).length, 1, "Esc closes only its own pin");

  const firstClosed = pin.waitForEvent("close");
  await pin.mouse.dblclick(30, 30);
  await firstClosed;
  assert.equal((await pinWindows()).length, 0, "double-click closes the pin");
  console.log("Desktop pin smoke test passed.");
} finally {
  if (electronApp) await electronApp.close();
  await fs.rm(userData, { recursive: true, force: true });
}
