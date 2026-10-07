import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { DIST_DIR } from "./project-config.mjs";

const profile = await fs.mkdtemp(path.join(os.tmpdir(), "region-snap-smoke-"));
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html style="cursor: wait">
      <body style="margin: 0; padding: 80px; background: #eef4ff">
        <main id="target" style="width: 420px; height: 240px; background: white; border-radius: 18px">
          <h1 style="padding: 32px">Smoke target</h1>
        </main>
      </body>
    </html>`);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address();
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  const targetPage = await context.newPage();
  await targetPage.goto(`http://127.0.0.1:${port}`);
  await targetPage.addStyleTag({ path: path.join(DIST_DIR, "overlay.css") });
  const client = await context.newCDPSession(targetPage);
  const frameTree = await client.send("Page.getFrameTree");
  const isolatedWorld = await client.send("Page.createIsolatedWorld", {
    frameId: frameTree.frameTree.frame.id,
    worldName: "region-snap-smoke",
  });
  async function evaluateIsolated(expression, awaitPromise = false) {
    const result = await client.send("Runtime.evaluate", {
      contextId: isolatedWorld.executionContextId,
      expression,
      awaitPromise,
    });
    assert.equal(
      result.exceptionDetails,
      undefined,
      result.exceptionDetails?.exception?.description || "isolated-world evaluation failed",
    );
    return result;
  }
  const runtimeSources = await Promise.all(
    ["shared.js", "geometry.js", "annotations.js", "content.js"].map((file) =>
      fs.readFile(path.join(DIST_DIR, file), "utf8"),
    ),
  );
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";
  await evaluateIsolated(`
      globalThis.chrome = {
        i18n: { getMessage: (key) => key },
        runtime: {
          getManifest: () => ({ version: "1.2.0" }),
          onMessage: {
            addListener: (listener) => { globalThis.__regionSnapListener = listener; },
            removeListener: (listener) => {
              if (globalThis.__regionSnapListener === listener) globalThis.__regionSnapListener = null;
            }
          },
          sendMessage: async (message) => {
            if (message.type !== "CAPTURE_TAB") return { ok: true };
            if (globalThis.__delayCapture) {
              return new Promise((resolve) => {
                globalThis.__resolveCapture = () => resolve({ dataUrl: ${JSON.stringify(pngDataUrl)} });
              });
            }
            return { dataUrl: globalThis.__captureDataUrl || ${JSON.stringify(pngDataUrl)} };
          }
        }
      };
      ${runtimeSources.join("\n")}
    `);
  await evaluateIsolated(
    `new Promise((resolve) =>
      globalThis.__regionSnapListener({ type: "START_PICKING" }, {}, resolve)
    )`,
    true,
  );
  const overlay = targetPage.locator("#region-snap-root");
  await overlay.waitFor();
  await targetPage.locator("#target").click({ position: { x: 200, y: 120 } });
  await targetPage.locator('#region-snap-root[data-mode="locked"]').waitFor();
  assert.equal(
    await targetPage.evaluate(
      () => globalThis.document.activeElement?.classList.contains("region-snap-grip") || false,
    ),
    true,
    "move grip should receive focus when a region locks",
  );
  assert.equal(
    await targetPage.evaluate(() => globalThis.document.documentElement.style.cursor),
    "wait",
    "the page cursor should be restored after selection",
  );

  let downloadCount = 0;
  targetPage.on("download", () => {
    downloadCount += 1;
  });
  await targetPage.evaluate(() =>
    globalThis.document.querySelector(".region-snap-capture").click(),
  );
  await targetPage.waitForTimeout(300);
  assert.equal(downloadCount, 0, "synthetic page clicks must not trigger a capture");

  await evaluateIsolated("globalThis.__delayCapture = true");
  await targetPage.locator(".region-snap-capture").click();
  await evaluateIsolated(
    `new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = () => {
        if (typeof globalThis.__resolveCapture === "function") return resolve();
        if (Date.now() >= deadline) return reject(new Error("capture request did not start"));
        globalThis.setTimeout(poll, 10);
      };
      poll();
    })`,
    true,
  );
  await evaluateIsolated(
    `new Promise((resolve) =>
      globalThis.__regionSnapListener({ type: "START_PICKING" }, {}, resolve)
    )`,
    true,
  );
  await evaluateIsolated(`
      globalThis.__delayCapture = false;
      globalThis.__resolveCapture();
    `);
  await targetPage.waitForTimeout(300);
  assert.equal(downloadCount, 0, "a capture from a reset session must be discarded");
  await targetPage.locator('#region-snap-root[data-mode="hovering"]').waitFor();
  await targetPage.locator("#target").click({ position: { x: 200, y: 120 } });
  await targetPage.locator('#region-snap-root[data-mode="locked"]').waitFor();

  const downloadPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^region-snap-\d{8}-\d{6}\.png$/);
  const downloadPath = await download.path();
  const signature = (await fs.readFile(downloadPath)).subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a");

  // Marks: a tool takes the pointer inside the region, draws on a drag, and gives the page
  // back on Escape. The capture then carries the marks at the image's own resolution.
  const root = targetPage.locator("#region-snap-root");
  const region = await targetPage.locator(".region-snap-border").boundingBox();
  const at = (fx, fy) => ({ x: region.x + region.width * fx, y: region.y + region.height * fy });
  const drag = async (from, to) => {
    await targetPage.mouse.move(from.x, from.y);
    await targetPage.mouse.down();
    await targetPage.mouse.move(to.x, to.y, { steps: 4 });
    await targetPage.mouse.up();
  };
  const tool = (name) => targetPage.locator(`.region-snap-tool[data-tool="${name}"]`);

  assert.equal(await root.getAttribute("data-tool"), "none");
  assert.equal(await targetPage.locator(".region-snap-undo").isDisabled(), true);
  await tool("arrow").click();
  assert.equal(await root.getAttribute("data-tool"), "arrow");
  assert.equal(await tool("arrow").getAttribute("aria-pressed"), "true");
  await drag(at(0.2, 0.25), at(0.6, 0.25));
  assert.equal(await targetPage.locator(".region-snap-mark-svg line").count(), 1);
  assert.equal(await targetPage.locator(".region-snap-mark-svg polygon").count(), 1);

  await tool("box").click();
  await drag(at(0.1, 0.6), at(0.3, 0.9));
  assert.equal(await targetPage.locator(".region-snap-mark-svg rect").count(), 1);

  await tool("hide").click();
  await drag(at(0.5, 0.6), at(0.9, 0.9));
  assert.equal(await targetPage.locator(".region-snap-hide").count(), 1);
  await drag(at(0.05, 0.05), at(0.06, 0.06));
  assert.equal(
    await targetPage.locator(".region-snap-hide").count(),
    1,
    "a drag of a few pixels must not leave a mark",
  );
  await drag(at(0.4, 0.1), at(0.45, 0.2));
  assert.equal(await targetPage.locator(".region-snap-hide").count(), 2);
  await targetPage.keyboard.press("Control+z");
  assert.equal(await targetPage.locator(".region-snap-hide").count(), 1, "Ctrl+Z undoes a mark");

  await targetPage.keyboard.press("Escape");
  assert.equal(await root.getAttribute("data-tool"), "none");
  assert.equal(await root.getAttribute("data-mode"), "locked", "Escape only puts the tool down");
  await drag(at(0.2, 0.45), at(0.6, 0.45));
  assert.equal(
    await targetPage.locator(".region-snap-mark-svg line").count(),
    1,
    "without a tool a drag belongs to the page",
  );

  // A white screenshot with one black column inside the hidden area, the size of the viewport.
  const viewport = targetPage.viewportSize();
  const stripeX = Math.round(at(0.7, 0).x);
  await evaluateIsolated(`(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = ${viewport.width};
    canvas.height = ${viewport.height};
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.fillRect(${stripeX}, 0, 2, canvas.height);
    globalThis.__captureDataUrl = canvas.toDataURL("image/png");
  })()`);
  const markedPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  const marked = await markedPromise;
  const markedBase64 = (await fs.readFile(await marked.path())).toString("base64");
  await evaluateIsolated("globalThis.__captureDataUrl = null");
  const probes = {
    arrow: at(0.4, 0.25),
    boxEdge: at(0.1, 0.75),
    boxInside: at(0.2, 0.75),
    hiddenStripe: { x: stripeX + 1, y: at(0, 0.75).y },
    visibleStripe: { x: stripeX + 1, y: at(0, 0.4).y },
  };
  const pixels = await targetPage.evaluate(
    async ({ base64, points, origin }) => {
      const blob = await (await globalThis.fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await globalThis.createImageBitmap(blob);
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const result = { width: bitmap.width, height: bitmap.height };
      for (const [name, point] of Object.entries(points)) {
        result[name] = Array.from(
          context.getImageData(Math.round(point.x - origin.x), Math.round(point.y - origin.y), 1, 1)
            .data,
        );
      }
      return result;
    },
    { base64: markedBase64, points: probes, origin: { x: region.x, y: region.y } },
  );
  assert.equal(pixels.width, Math.round(region.width));
  assert.equal(pixels.height, Math.round(region.height));
  assert.deepEqual(pixels.arrow, [239, 68, 68, 255], "the arrow is drawn in the image");
  assert.deepEqual(pixels.boxEdge, [239, 68, 68, 255], "the box outline is drawn in the image");
  assert.deepEqual(pixels.boxInside, [255, 255, 255, 255], "a box is an outline, not a fill");
  assert.deepEqual(pixels.visibleStripe, [0, 0, 0, 255], "outside the hidden area nothing changes");
  assert.ok(
    pixels.hiddenStripe[0] > 150 && pixels.hiddenStripe[0] < 255,
    `the hidden area must average the stripe away, got ${pixels.hiddenStripe}`,
  );

  await targetPage.locator(".region-snap-undo").click();
  await targetPage.locator(".region-snap-undo").click();
  await targetPage.locator(".region-snap-undo").click();
  assert.equal(await targetPage.locator(".region-snap-undo").isDisabled(), true);
  assert.equal(await targetPage.locator(".region-snap-mark-svg > *").count(), 0);
  assert.equal(await targetPage.locator(".region-snap-hide").count(), 0);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const downloadsBeforeCopy = downloadCount;
  await targetPage.locator(".region-snap-copy").click();
  await targetPage.locator(".region-snap-toast", { hasText: "overlayCopied" }).waitFor();
  const clipboardTypes = await targetPage.evaluate(async () => {
    const items = await globalThis.navigator.clipboard.read();
    return items.flatMap((item) => item.types);
  });
  assert.deepEqual(clipboardTypes, ["image/png"]);
  assert.equal(downloadCount, downloadsBeforeCopy, "a successful copy must not also download");

  // Stored settings drive the format, the corners, the file name and the default action.
  const storeSettings = (settings) =>
    evaluateIsolated(`
      globalThis.chrome.storage = {
        local: { get: async () => ({ settings: ${JSON.stringify(settings)} }) }
      };
    `);
  await storeSettings({
    defaultAction: "download",
    fileNamePrefix: "shot",
    format: "jpeg",
    roundedCorners: false,
  });
  const jpegPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  const jpeg = await jpegPromise;
  assert.match(jpeg.suggestedFilename(), /^shot-\d{8}-\d{6}\.jpg$/);
  const jpegSignature = (await fs.readFile(await jpeg.path())).subarray(0, 3).toString("hex");
  assert.equal(jpegSignature, "ffd8ff");
  await targetPage.locator(".region-snap-toast", { hasText: "overlaySaved" }).waitFor();

  await storeSettings({ defaultAction: "copy", format: "jpeg" });
  const downloadsBeforeDefaultCopy = downloadCount;
  await evaluateIsolated(
    `new Promise((resolve) =>
      globalThis.__regionSnapListener({ type: "DO_CAPTURE" }, {}, resolve)
    )`,
    true,
  );
  await targetPage.locator(".region-snap-toast", { hasText: "overlayCopied" }).waitFor();
  assert.equal(
    downloadCount,
    downloadsBeforeDefaultCopy,
    "the default action must copy when the setting says so",
  );

  const options = await context.newPage();
  const optionsErrors = [];
  options.on("pageerror", (error) => optionsErrors.push(error.message));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  assert.equal(await options.locator('input[name="format"][value="png"]').isChecked(), true);
  await options.locator('input[name="format"][value="webp"]').check();
  await options.locator('input[name="roundedCorners"]').uncheck();
  await options.locator('input[name="fileNamePrefix"]').fill("  my/shot?  ");
  await options.locator('input[name="fileNamePrefix"]').blur();
  await options.locator("#status", { hasText: /\S/ }).waitFor();
  const storedSettings = await options.evaluate(async () => {
    const stored = await globalThis.chrome.storage.local.get("settings");
    return stored.settings;
  });
  assert.deepEqual(storedSettings, {
    defaultAction: "download",
    fileNamePrefix: "myshot",
    format: "webp",
    roundedCorners: false,
  });
  await options.reload();
  assert.equal(await options.locator('input[name="format"][value="webp"]').isChecked(), true);
  assert.equal(await options.locator('input[name="fileNamePrefix"]').inputValue(), "myshot");
  assert.match(await options.locator("#file-name-example").innerText(), /^myshot-.*\.webp$/);
  assert.deepEqual(optionsErrors, []);
  await options.close();

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator("h1", { hasText: "Region Snap" }).waitFor();
  await page.locator("#primary-action").waitFor();
  await page.locator(".status-card").waitFor();
  const version = await page.evaluate(() => globalThis.chrome.runtime.getManifest().version);
  const manifest = JSON.parse(await fs.readFile(path.join(DIST_DIR, "manifest.json"), "utf8"));
  assert.equal(version, manifest.version);
  assert.deepEqual(pageErrors, []);
  console.log(`Smoke test passed for selection, marks, capture, and popup v${version}.`);
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
