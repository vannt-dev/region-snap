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
    ["shared.js", "geometry.js", "content.js"].map((file) =>
      fs.readFile(path.join(DIST_DIR, file), "utf8"),
    ),
  );
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";
  await evaluateIsolated(`
      globalThis.chrome = {
        i18n: { getMessage: (key) => key },
        runtime: {
          getManifest: () => ({ version: "1.1.0" }),
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
            return { dataUrl: ${JSON.stringify(pngDataUrl)} };
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
  console.log(`Smoke test passed for selection, capture, and popup v${version}.`);
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
