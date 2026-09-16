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
} finally {
  if (electronApp) await electronApp.close();
  await fs.rm(userData, { recursive: true, force: true });
}
