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
    ["shared.js", "geometry.js", "annotations.js", "schedule.js", "content.js"].map((file) =>
      fs.readFile(path.join(DIST_DIR, file), "utf8"),
    ),
  );
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==";
  await evaluateIsolated(`
      globalThis.chrome = {
        i18n: { getMessage: (key) => key },
        runtime: {
          getManifest: () => ({ version: "1.4.0" }),
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
            if (globalThis.__captureFactory) return { dataUrl: globalThis.__captureFactory() };
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

  // Numbered steps: each click drops the next number, and after an undo the numbering carries
  // on from the steps that are left.
  const click = (point) => targetPage.mouse.click(point.x, point.y);
  const stepNumbers = () => targetPage.locator(".region-snap-mark-svg text").allTextContents();
  await tool("step").click();
  for (const fx of [0.15, 0.3, 0.45]) await click(at(fx, 0.3));
  assert.deepEqual(await stepNumbers(), ["1", "2", "3"]);
  await targetPage.locator(".region-snap-undo").click();
  assert.deepEqual(await stepNumbers(), ["1", "2"]);
  await click(at(0.6, 0.3));
  assert.deepEqual(await stepNumbers(), ["1", "2", "3"], "undo hands the last number back");

  // Text: a click opens a note, Escape drops it, Enter keeps it, Shift+Enter adds a line, and
  // none of the typing reaches the page.
  await targetPage.evaluate(() => {
    globalThis.__pageKeys = 0;
    globalThis.addEventListener("keydown", () => (globalThis.__pageKeys += 1));
  });
  await tool("text").click();
  const editorBox = targetPage.locator(".region-snap-text-editor");
  const notes = targetPage.locator(".region-snap-text");
  await click(at(0.1, 0.6));
  await editorBox.waitFor();
  await targetPage.keyboard.type("Draft");
  await targetPage.keyboard.press("Escape");
  assert.equal(await editorBox.count(), 0, "Escape closes the note");
  assert.equal(await notes.count(), 0, "a cancelled note is not kept");
  assert.equal(await root.getAttribute("data-tool"), "text", "Escape only cancels the typing");
  assert.equal(await root.getAttribute("data-mode"), "locked");

  await targetPage.locator(".region-snap-text-size").click();
  assert.equal(
    await targetPage.locator(".region-snap-text-size").getAttribute("data-size"),
    "large",
  );
  await click(at(0.1, 0.6));
  await editorBox.waitFor();
  await targetPage.keyboard.type("Hello");
  await targetPage.keyboard.press("Shift+Enter");
  await targetPage.keyboard.type("World");
  await targetPage.keyboard.press("Enter");
  assert.equal(await editorBox.count(), 0, "Enter keeps the note");
  assert.deepEqual(await notes.allTextContents(), ["Hello\nWorld"]);
  assert.match(await notes.getAttribute("style"), /28px/, "the note has the large size");
  assert.equal(await targetPage.evaluate(() => globalThis.__pageKeys), 0, "typing stays out");

  const noteBefore = await notes.boundingBox();
  await drag(
    { x: noteBefore.x + 5, y: noteBefore.y + 5 },
    { x: noteBefore.x + 35, y: noteBefore.y + 15 },
  );
  const noteAfter = await notes.boundingBox();
  assert.ok(Math.abs(noteAfter.x - noteBefore.x - 30) < 1, "a dragged note moves");
  assert.ok(Math.abs(noteAfter.y - noteBefore.y - 10) < 1);
  assert.equal(await editorBox.count(), 0, "a drag does not open the note");
  await click({ x: noteAfter.x + 5, y: noteAfter.y + 5 });
  await editorBox.waitFor();
  assert.equal(await editorBox.inputValue(), "Hello\nWorld");
  await targetPage.keyboard.type("!");
  await targetPage.keyboard.press("Enter");
  assert.deepEqual(await notes.allTextContents(), ["Hello\nWorld!"], "a click edits the note");

  // The note and the steps are drawn into the image at its own resolution.
  await evaluateIsolated(`(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = ${viewport.width};
    canvas.height = ${viewport.height};
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    globalThis.__captureDataUrl = canvas.toDataURL("image/png");
  })()`);
  const noteBox = await notes.boundingBox();
  const annotatedPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  const annotated = await annotatedPromise;
  const annotatedBase64 = (await fs.readFile(await annotated.path())).toString("base64");
  await evaluateIsolated("globalThis.__captureDataUrl = null");
  const stepCentre = await targetPage
    .locator(".region-snap-mark-svg circle")
    .first()
    .evaluate((circle) => {
      const bounds = circle.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
  const annotatedPixels = await targetPage.evaluate(
    async ({ base64, origin, step, note }) => {
      const blob = await (await globalThis.fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await globalThis.createImageBitmap(blob);
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const pixel = (x, y) =>
        Array.from(
          context.getImageData(Math.round(x - origin.x), Math.round(y - origin.y), 1, 1).data,
        );
      const area = context.getImageData(
        Math.round(note.x - origin.x),
        Math.round(note.y - origin.y),
        Math.round(note.width),
        Math.round(note.height),
      ).data;
      let red = 0;
      for (let index = 0; index < area.length; index += 4) {
        if (area[index] > 200 && area[index + 1] < 120 && area[index + 2] < 120) red += 1;
      }
      return { stepRing: pixel(step.x + 8, step.y), stepOutside: pixel(step.x + 20, step.y), red };
    },
    {
      base64: annotatedBase64,
      origin: { x: region.x, y: region.y },
      step: stepCentre,
      note: noteBox,
    },
  );
  assert.deepEqual(annotatedPixels.stepRing, [239, 68, 68, 255], "the step circle is in the image");
  assert.deepEqual(annotatedPixels.stepOutside, [255, 255, 255, 255], "a step is a small circle");
  assert.ok(annotatedPixels.red > 50, `the note is in the image, ${annotatedPixels.red} red px`);

  await targetPage.keyboard.press("Escape");
  assert.equal(await root.getAttribute("data-tool"), "none");
  for (let left = 4; left > 0; left -= 1) await targetPage.locator(".region-snap-undo").click();
  assert.equal(await targetPage.locator(".region-snap-undo").isDisabled(), true);

  // Colours and the highlighter: the colours show while a tool that uses one is held, the pick
  // is stored for the next page, and a highlight tints the image without hiding what is under it.
  // The highlighter starts yellow and keeps its own colour; the other tools start red.
  await evaluateIsolated(`
    globalThis.__stored = {};
    globalThis.chrome.storage = {
      local: {
        get: async () => ({}),
        set: async (items) => Object.assign(globalThis.__stored, items),
      },
    };
  `);
  const colors = targetPage.locator(".region-snap-colors");
  const swatch = (name) => targetPage.locator(`.region-snap-color[data-color="${name}"]`);
  assert.equal(await colors.isVisible(), false, "no colours without a tool");
  await tool("hide").click();
  assert.equal(await colors.isVisible(), false, "a hidden area has no colour");
  await tool("highlight").click();
  assert.equal(await root.getAttribute("data-tool"), "highlight");
  assert.equal(await colors.isVisible(), true, "the colours show with the highlighter");
  assert.equal(await swatch("yellow").getAttribute("aria-pressed"), "true", "a yellow highlighter");
  assert.equal(await swatch("red").getAttribute("aria-pressed"), "false");
  const stored = async () =>
    JSON.parse((await evaluateIsolated("JSON.stringify(globalThis.__stored)")).result.value);
  const stripeY = Math.round(at(0, 0.3).y);
  await drag(at(0.1, 0.2), at(0.5, 0.4));
  const highlightRect = targetPage.locator(".region-snap-mark-svg rect.region-snap-highlight");
  assert.equal(await highlightRect.count(), 1);
  assert.ok(
    Number(
      await highlightRect.evaluate((element) => globalThis.getComputedStyle(element).fillOpacity),
    ) < 0.6,
    "the highlight is see-through on the page",
  );
  await tool("box").click();
  assert.equal(await swatch("red").getAttribute("aria-pressed"), "true", "a box starts red");
  await swatch("blue").click();
  assert.equal(await swatch("blue").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await stored(), { markColor: "#3b82f6" }, "the colour is remembered");
  await drag(at(0.6, 0.6), at(0.9, 0.9));
  assert.equal(await targetPage.locator(".region-snap-mark-svg rect").count(), 2);
  await tool("highlight").click();
  assert.equal(
    await swatch("yellow").getAttribute("aria-pressed"),
    "true",
    "picking blue for a box leaves the highlighter yellow",
  );

  // A white screenshot with one black row of "text" running through the highlight.
  await evaluateIsolated(`(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = ${viewport.width};
    canvas.height = ${viewport.height};
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.fillRect(0, ${stripeY}, canvas.width, 6);
    globalThis.__captureDataUrl = canvas.toDataURL("image/png");
  })()`);
  const colouredPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  const coloured = await colouredPromise;
  const colouredBase64 = (await fs.readFile(await coloured.path())).toString("base64");
  await evaluateIsolated("globalThis.__captureDataUrl = null");
  const colourProbes = {
    highlight: at(0.3, 0.25),
    textUnderHighlight: { x: at(0.3, 0).x, y: stripeY + 3 },
    outsideHighlight: at(0.3, 0.5),
    blueBox: at(0.6, 0.75),
  };
  const colourPixels = await targetPage.evaluate(
    async ({ base64, points, origin }) => {
      const blob = await (await globalThis.fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await globalThis.createImageBitmap(blob);
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const result = {};
      for (const [name, point] of Object.entries(points)) {
        result[name] = Array.from(
          context.getImageData(Math.round(point.x - origin.x), Math.round(point.y - origin.y), 1, 1)
            .data,
        );
      }
      return result;
    },
    { base64: colouredBase64, points: colourProbes, origin: { x: region.x, y: region.y } },
  );
  // Yellow (250, 204, 21) at 35% over white is about (253, 237, 173).
  const [hr, hg, hb] = colourPixels.highlight;
  assert.ok(
    hr > 240 && hg > 225 && hg < 250 && hb > 150 && hb < 195,
    `the highlight tints the image yellow, got ${colourPixels.highlight}`,
  );
  assert.ok(
    colourPixels.textUnderHighlight.slice(0, 3).every((channel) => channel < 120),
    `the text under a highlight stays dark, got ${colourPixels.textUnderHighlight}`,
  );
  assert.deepEqual(colourPixels.outsideHighlight, [255, 255, 255, 255]);
  assert.deepEqual(colourPixels.blueBox, [59, 130, 246, 255], "the box is drawn in blue");

  // A colour picked with the highlighter held is the highlighter's alone.
  await swatch("green").click();
  assert.deepEqual(await stored(), { markColor: "#3b82f6", highlightColor: "#22c55e" });
  await tool("arrow").click();
  assert.equal(await swatch("blue").getAttribute("aria-pressed"), "true", "the arrow stays blue");

  await targetPage.keyboard.press("Escape");
  await targetPage.locator(".region-snap-undo").click();
  await targetPage.locator(".region-snap-undo").click();
  assert.equal(await targetPage.locator(".region-snap-undo").isDisabled(), true);

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

  // A capture delay counts down in the toast; Escape stops it and keeps the region.
  await storeSettings({ captureDelay: 3, defaultAction: "download" });
  const downloadsBeforeCountdown = downloadCount;
  await targetPage.locator(".region-snap-capture").click();
  await targetPage.locator(".region-snap-toast", { hasText: "overlayCountdown" }).waitFor();
  await targetPage.keyboard.press("Escape");
  await targetPage.locator(".region-snap-toast", { hasText: "overlayCountdownStopped" }).waitFor();
  assert.equal(await root.getAttribute("data-mode"), "locked", "Escape only stops the countdown");
  await targetPage.waitForTimeout(1300);
  assert.equal(downloadCount, downloadsBeforeCountdown, "a stopped countdown must not capture");

  const countdownStart = Date.now();
  const delayedPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-capture").click();
  await delayedPromise;
  const waited = Date.now() - countdownStart;
  assert.ok(waited >= 2900, `the capture must wait out the delay, waited ${waited} ms`);

  // Burst: the shots of a series share one timestamp, carry their number, keep the interval
  // from the settings, and always download, even with copy as the default action.
  const seriesFiles = [];
  targetPage.on("download", (item) =>
    seriesFiles.push({ name: item.suggestedFilename(), at: Date.now() }),
  );
  await storeSettings({ burstCount: 3, burstInterval: 1, defaultAction: "copy", watchLimit: 5 });
  await targetPage.locator(".region-snap-burst").click();
  await targetPage.locator('#region-snap-root[data-run="burst"]').waitFor();
  assert.equal(await targetPage.locator(".region-snap-burst").getAttribute("aria-pressed"), "true");
  await targetPage.locator(".region-snap-toast", { hasText: "overlayBurstDone" }).waitFor({
    timeout: 10_000,
  });
  assert.equal(await root.getAttribute("data-run"), "none", "the indicator goes when it is done");
  assert.equal(seriesFiles.length, 3);
  const burstStamp = /^region-snap-(\d{8}-\d{6})-01\.png$/.exec(seriesFiles[0].name)?.[1];
  assert.ok(burstStamp, `unexpected burst file name ${seriesFiles[0].name}`);
  assert.deepEqual(
    seriesFiles.map((file) => file.name),
    ["01", "02", "03"].map((shot) => `region-snap-${burstStamp}-${shot}.png`),
  );
  for (let index = 1; index < seriesFiles.length; index += 1) {
    const gap = seriesFiles[index].at - seriesFiles[index - 1].at;
    assert.ok(gap >= 800, `burst shots keep the interval, gap was ${gap} ms`);
  }

  // Capture on change: a change inside the region is saved once it settles, a quick run of
  // changes is saved once, changes elsewhere are not, and it stops by itself at the limit.
  seriesFiles.length = 0;
  const changeRegion = (text) =>
    targetPage.evaluate((value) => {
      globalThis.document.querySelector("#target h1").textContent = value;
    }, text);
  await targetPage.locator(".region-snap-watch").click();
  await targetPage.locator('#region-snap-root[data-run="watch"]').waitFor();
  await targetPage.locator(".region-snap-toast", { hasText: "overlayWatchArmed" }).waitFor();
  await targetPage.waitForTimeout(800);
  assert.equal(seriesFiles.length, 0, "arming alone saves nothing");
  for (let step = 0; step < 5; step += 1) {
    await changeRegion(`Change ${step}`);
    await targetPage.waitForTimeout(60);
  }
  await targetPage.waitForTimeout(1500);
  assert.equal(seriesFiles.length, 1, "a quick run of changes is saved once");
  assert.match(seriesFiles[0].name, /^region-snap-\d{8}-\d{6}-01\.png$/);
  assert.equal(await targetPage.locator(".region-snap-run").innerText(), "1/5");
  await targetPage.evaluate(() => {
    const outside = globalThis.document.createElement("p");
    outside.textContent = "elsewhere";
    globalThis.document.body.appendChild(outside);
  });
  await targetPage.waitForTimeout(1200);
  assert.equal(seriesFiles.length, 1, "a change outside the region is not saved");
  for (let step = 2; step <= 5; step += 1) {
    await changeRegion(`Change ${step}`);
    await targetPage.waitForTimeout(1200);
  }
  await targetPage.locator(".region-snap-toast", { hasText: "overlayWatchLimit" }).waitFor();
  assert.equal(seriesFiles.length, 5);
  assert.equal(await root.getAttribute("data-run"), "none", "the limit ends the watch");
  await changeRegion("After the limit");
  await targetPage.waitForTimeout(1200);
  assert.equal(seriesFiles.length, 5, "nothing is saved once the watch has ended");

  // Escape stops a watch and keeps the region.
  await targetPage.locator(".region-snap-watch").click();
  await targetPage.locator('#region-snap-root[data-run="watch"]').waitFor();
  await targetPage.keyboard.press("Escape");
  await targetPage.locator(".region-snap-toast", { hasText: "overlaySeriesStopped" }).waitFor();
  assert.equal(await root.getAttribute("data-run"), "none");
  assert.equal(await root.getAttribute("data-mode"), "locked", "Escape only stops the watch");
  await changeRegion("Smoke target");
  await targetPage.waitForTimeout(1200);
  assert.equal(seriesFiles.length, 5, "a stopped watch saves nothing");

  // Full page: the document is photographed a viewport at a time and stitched. Each stub
  // screenshot is filled with a colour that encodes the scroll offset it was taken at.
  await storeSettings({ captureDelay: 0, defaultAction: "download", format: "png" });
  const pageMetrics = await targetPage.evaluate(() => {
    const { document } = globalThis;
    const add = (id, style) => {
      const element = document.createElement("div");
      element.id = id;
      element.style.cssText = style;
      document.body.appendChild(element);
    };
    add("smoke-sticky", "position: sticky; top: 10px; height: 20px; background: #0a0");
    add("smoke-tall", "height: 2000px");
    add("smoke-header", "position: fixed; top: 0; left: 0; width: 100%; height: 30px");
    add("smoke-footer", "position: fixed; bottom: 0; left: 0; width: 100%; height: 30px");
    globalThis.scrollTo(0, 300);
    const page = document.documentElement;
    return { height: page.scrollHeight, width: page.clientWidth, viewport: page.clientHeight };
  });
  const positions = [];
  for (let top = 0; top < pageMetrics.height; top += pageMetrics.viewport) {
    positions.push(Math.min(top, pageMetrics.height - pageMetrics.viewport));
  }
  assert.ok(positions.length >= 3, "the smoke page must need several slices");
  await evaluateIsolated(`
    globalThis.__captureLog = [];
    globalThis.__captureFactory = () => {
      const { document } = globalThis;
      const style = (id) => globalThis.getComputedStyle(document.getElementById(id));
      const top = Math.round(globalThis.scrollY);
      globalThis.__captureLog.push({
        top,
        header: style("smoke-header").visibility,
        footer: style("smoke-footer").visibility,
        sticky: style("smoke-sticky").position,
        overlay: globalThis.getComputedStyle(document.getElementById("region-snap-root")).opacity,
        at: Date.now(),
      });
      const canvas = document.createElement("canvas");
      canvas.width = globalThis.innerWidth;
      canvas.height = globalThis.innerHeight;
      const context = canvas.getContext("2d");
      context.fillStyle = "rgb(" + (top >> 8) + "," + (top & 255) + ",100)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    };
  `);
  const fullPagePromise = targetPage.waitForEvent("download");
  await evaluateIsolated(
    `new Promise((resolve) =>
      globalThis.__regionSnapListener({ type: "CAPTURE_FULL_PAGE" }, {}, resolve)
    )`,
    true,
  );
  const fullPage = await fullPagePromise;
  const fullPageBase64 = (await fs.readFile(await fullPage.path())).toString("base64");
  await targetPage.locator(".region-snap-toast", { hasText: "overlaySaved" }).waitFor();
  const captureLog = JSON.parse(
    (await evaluateIsolated("JSON.stringify(globalThis.__captureLog)")).result.value,
  );
  await evaluateIsolated("globalThis.__captureFactory = null");
  const lastSlice = positions.length - 1;
  assert.deepEqual(
    captureLog.map((entry) => entry.top),
    positions,
    "one screenshot per viewport, the last flush with the page bottom",
  );
  assert.deepEqual(
    captureLog.map((entry) => entry.header),
    positions.map((_top, index) => (index === 0 ? "visible" : "hidden")),
    "a fixed header belongs to the first slice only",
  );
  assert.deepEqual(
    captureLog.map((entry) => entry.footer),
    positions.map((_top, index) => (index === lastSlice ? "visible" : "hidden")),
    "a fixed footer belongs to the last slice only",
  );
  assert.ok(
    captureLog.every((entry) => entry.sticky === "relative" && entry.overlay === "0"),
    "sticky elements sit in the flow and the overlay is hidden in every slice",
  );
  for (let index = 1; index < captureLog.length; index += 1) {
    const gap = captureLog[index].at - captureLog[index - 1].at;
    assert.ok(gap >= 550, `slices must respect Chrome's capture quota, gap was ${gap} ms`);
  }
  const sliceColour = (top) => [top >> 8, top & 255, 100, 255];
  const fullPagePixels = await targetPage.evaluate(
    async ({ base64, rows }) => {
      const blob = await (await globalThis.fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await globalThis.createImageBitmap(blob);
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        rows: rows.map((y) => Array.from(context.getImageData(10, y, 1, 1).data)),
      };
    },
    {
      base64: fullPageBase64,
      rows: [5, pageMetrics.viewport + 5, positions[lastSlice] - 5, pageMetrics.height - 5],
    },
  );
  assert.equal(fullPagePixels.width, pageMetrics.width, "the scrollbar is not part of the image");
  assert.equal(fullPagePixels.height, pageMetrics.height);
  assert.deepEqual(fullPagePixels.rows, [
    sliceColour(positions[0]),
    sliceColour(positions[1]),
    sliceColour(positions[lastSlice - 1]),
    sliceColour(positions[lastSlice]),
  ]);
  assert.deepEqual(
    await targetPage.evaluate(() => {
      const style = (id) => globalThis.getComputedStyle(globalThis.document.getElementById(id));
      return {
        scrollY: globalThis.scrollY,
        header: style("smoke-header").visibility,
        footer: style("smoke-footer").visibility,
        sticky: style("smoke-sticky").position,
        inline: globalThis.document.getElementById("smoke-sticky").style.cssText,
      };
    }),
    {
      scrollY: 300,
      header: "visible",
      footer: "visible",
      sticky: "sticky",
      inline: "position: sticky; top: 10px; height: 20px; background: rgb(0, 170, 0);",
    },
    "the page is put back as it was",
  );
  await targetPage.locator("#region-snap-root").waitFor({ state: "detached", timeout: 6000 });

  // Scrolling capture. With nothing that scrolls under the region it says so and does nothing.
  const startPicking = () =>
    evaluateIsolated(
      `new Promise((resolve) =>
        globalThis.__regionSnapListener({ type: "START_PICKING" }, {}, resolve)
      )`,
      true,
    );
  await targetPage.evaluate(() => globalThis.scrollTo(0, 0));
  await startPicking();
  await targetPage.locator("#target").click({ position: { x: 200, y: 120 } });
  await targetPage.locator('#region-snap-root[data-mode="locked"]').waitFor();
  const downloadsBeforeNothing = downloadCount;
  await targetPage.locator(".region-snap-scroll").click();
  await targetPage.locator(".region-snap-toast", { hasText: "overlayScrollNothing" }).waitFor();
  assert.equal(downloadCount, downloadsBeforeNothing);

  // Each stub screenshot is filled with a colour that encodes the scroll offset it was taken
  // at, read from the panel or from the page, and notes what the page looked like.
  const encodeScroll = (source) => `
    globalThis.__captureLog = [];
    globalThis.__captureFactory = () => {
      const { document } = globalThis;
      const style = (id) => globalThis.getComputedStyle(document.getElementById(id));
      const top = Math.round(${source});
      globalThis.__captureLog.push({
        top,
        header: style("smoke-header").visibility,
        sticky: style("smoke-sticky").position,
        panelHead: document.getElementById("smoke-panel-head")
          ? style("smoke-panel-head").position
          : null,
        overlay: globalThis.getComputedStyle(document.getElementById("region-snap-root")).opacity,
        at: Date.now(),
      });
      const canvas = document.createElement("canvas");
      canvas.width = globalThis.innerWidth;
      canvas.height = globalThis.innerHeight;
      const context = canvas.getContext("2d");
      context.fillStyle = "rgb(" + (top >> 8) + "," + (top & 255) + ",100)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    };
  `;
  const plannedPositions = (start, end, windowHeight, maxScroll) => {
    const result = [];
    for (let top = Math.min(start, maxScroll); ; top = Math.min(top + windowHeight, maxScroll)) {
      if (result.at(-1) === top) break;
      result.push(top);
      if (top + windowHeight >= end) break;
    }
    return result;
  };
  const readRows = (base64, x, rows) =>
    targetPage.evaluate(
      async ({ data, column, ys }) => {
        const blob = await (await globalThis.fetch(`data:image/png;base64,${data}`)).blob();
        const bitmap = await globalThis.createImageBitmap(blob);
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return {
          width: bitmap.width,
          height: bitmap.height,
          rows: ys.map((y) => Array.from(context.getImageData(column, y, 1, 1).data)),
        };
      },
      { data: base64, column: x, ys: rows },
    );
  const readLog = async () =>
    JSON.parse((await evaluateIsolated("JSON.stringify(globalThis.__captureLog)")).result.value);
  const assertPaced = (log) => {
    for (let index = 1; index < log.length; index += 1) {
      const gap = log[index].at - log[index - 1].at;
      assert.ok(gap >= 550, `slices must respect Chrome's capture quota, gap was ${gap} ms`);
    }
  };

  // (a) A panel that scrolls inside the page, with a sticky heading of its own.
  const panelMetrics = await targetPage.evaluate(() => {
    const { document } = globalThis;
    const panel = document.createElement("div");
    panel.id = "smoke-panel";
    panel.style.cssText = "height: 200px; width: 300px; overflow: auto; background: #fff";
    panel.innerHTML =
      '<div id="smoke-panel-head" style="position: sticky; top: 0; height: 20px"></div>' +
      '<div id="smoke-panel-body" style="height: 1000px"></div>';
    document.getElementById("target").after(panel);
    panel.scrollTo({ top: 120, behavior: "instant" });
    panel.style.scrollBehavior = "smooth";
    const bounds = panel.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      clientWidth: panel.clientWidth,
    };
  });
  await startPicking();
  await targetPage.mouse.click(panelMetrics.x + 100, panelMetrics.y + 100);
  await targetPage.locator('#region-snap-root[data-mode="locked"]').waitFor();
  await evaluateIsolated(encodeScroll('document.getElementById("smoke-panel").scrollTop'));
  const panelPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-scroll").click();
  const panelBase64 = (await fs.readFile(await (await panelPromise).path())).toString("base64");
  await targetPage.locator(".region-snap-toast", { hasText: "overlaySaved" }).waitFor();
  const panelLog = await readLog();
  const panelPositions = plannedPositions(
    0,
    panelMetrics.scrollHeight,
    panelMetrics.clientHeight,
    panelMetrics.scrollHeight - panelMetrics.clientHeight,
  );
  assert.deepEqual(
    panelLog.map((entry) => entry.top),
    panelPositions,
    "one screenshot per panel height, the last flush with the panel's end",
  );
  assert.ok(
    panelLog.every((entry) => entry.panelHead === "relative" && entry.overlay === "0"),
    "the panel's sticky heading sits in the flow and the overlay is hidden",
  );
  assert.ok(
    panelLog.every((entry) => entry.header === "hidden"),
    "fixed elements outside the panel stay out of every slice",
  );
  assertPaced(panelLog);
  const lastPanel = panelPositions.at(-1);
  const panelImage = await readRows(panelBase64, 10, [
    5,
    panelMetrics.clientHeight + 5,
    lastPanel - 5,
    panelMetrics.scrollHeight - 5,
  ]);
  assert.equal(panelImage.width, panelMetrics.clientWidth, "the panel's scrollbar is left out");
  assert.equal(panelImage.height, panelMetrics.scrollHeight, "the whole panel content is there");
  assert.deepEqual(panelImage.rows, [
    sliceColour(panelPositions[0]),
    sliceColour(panelPositions[1]),
    sliceColour(panelPositions.at(-2)),
    sliceColour(lastPanel),
  ]);
  assert.deepEqual(
    await targetPage.evaluate(() => {
      const { document } = globalThis;
      return {
        panel: document.getElementById("smoke-panel").scrollTop,
        page: globalThis.scrollY,
        head: globalThis.getComputedStyle(document.getElementById("smoke-panel-head")).position,
        header: globalThis.getComputedStyle(document.getElementById("smoke-header")).visibility,
      };
    }),
    { panel: 120, page: 0, head: "sticky", header: "visible" },
    "the panel and the page are put back as they were",
  );
  assert.equal(await root.getAttribute("data-mode"), "locked", "the region stays locked");

  // Escape stops a scrolling capture part way: nothing is saved, the region stays, and the
  // panel is scrolled back.
  await evaluateIsolated(encodeScroll('document.getElementById("smoke-panel").scrollTop'));
  const downloadsBeforeStop = downloadCount;
  await targetPage.locator(".region-snap-scroll").click();
  await evaluateIsolated(
    `new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = () => {
        if (globalThis.__captureLog.length > 0) return resolve();
        if (Date.now() >= deadline) return reject(new Error("the scrolling capture did not start"));
        globalThis.setTimeout(poll, 10);
      };
      poll();
    })`,
    true,
  );
  await targetPage.keyboard.press("Escape");
  await targetPage.locator(".region-snap-toast", { hasText: "overlayScrollStopped" }).waitFor();
  await targetPage.waitForTimeout(700);
  assert.equal(downloadCount, downloadsBeforeStop, "a stopped scrolling capture saves nothing");
  assert.equal(await root.getAttribute("data-mode"), "locked", "Escape only stops the capture");
  assert.equal(
    await targetPage.evaluate(() => globalThis.document.getElementById("smoke-panel").scrollTop),
    120,
  );

  // (b) An element taller than the window, scrolled by the page itself.
  const tallMetrics = await targetPage.evaluate(() => {
    const { document } = globalThis;
    const tall = document.getElementById("smoke-tall");
    tall.style.background = "#ddd";
    const top = tall.getBoundingClientRect().top + globalThis.scrollY;
    globalThis.scrollTo(0, top - 200);
    const page = document.documentElement;
    return {
      top,
      height: tall.getBoundingClientRect().height,
      scrollY: globalThis.scrollY,
      viewport: page.clientHeight,
      maxScroll: page.scrollHeight - page.clientHeight,
    };
  });
  await startPicking();
  await targetPage.mouse.click(400, 450);
  await targetPage.locator('#region-snap-root[data-mode="locked"]').waitFor();
  await targetPage.locator(".region-snap-border").waitFor();
  const tallRegion = await targetPage.locator(".region-snap-border").boundingBox();
  await evaluateIsolated(encodeScroll("globalThis.scrollY"));
  const tallPromise = targetPage.waitForEvent("download");
  await targetPage.locator(".region-snap-scroll").click();
  const tallBase64 = (await fs.readFile(await (await tallPromise).path())).toString("base64");
  await targetPage.locator(".region-snap-toast", { hasText: "overlaySaved" }).waitFor();
  const tallLog = await readLog();
  await evaluateIsolated("globalThis.__captureFactory = null");
  const tallPositions = plannedPositions(
    tallMetrics.top,
    tallMetrics.top + tallMetrics.height,
    tallMetrics.viewport,
    tallMetrics.maxScroll,
  ).map(Math.round);
  assert.deepEqual(
    tallLog.map((entry) => entry.top),
    tallPositions,
  );
  assert.ok(
    tallLog.every(
      (entry) => entry.sticky === "relative" && entry.header === "hidden" && entry.overlay === "0",
    ),
    "sticky elements sit in the flow and fixed ones stay out while the page scrolls",
  );
  assertPaced(tallLog);
  const tallImage = await readRows(tallBase64, 10, [5, tallMetrics.height - 5]);
  assert.equal(tallImage.width, Math.round(tallRegion.width));
  assert.equal(tallImage.height, tallMetrics.height, "the element's full height is there");
  assert.deepEqual(tallImage.rows, [
    sliceColour(tallPositions[0]),
    sliceColour(tallPositions.at(-1)),
  ]);
  assert.equal(
    await targetPage.evaluate(() => globalThis.scrollY),
    tallMetrics.scrollY,
    "the page is scrolled back",
  );
  await targetPage.keyboard.press("Escape");
  await targetPage.locator("#region-snap-root").waitFor({ state: "detached" });

  const options = await context.newPage();
  const optionsErrors = [];
  options.on("pageerror", (error) => optionsErrors.push(error.message));
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  // The form is filled once the stored settings are read; the example name shows it is done.
  await options.locator("#file-name-example", { hasText: /\S/ }).waitFor();
  assert.equal(await options.locator('input[name="format"][value="png"]').isChecked(), true);
  await options.locator('input[name="format"][value="webp"]').check();
  await options.locator('input[name="roundedCorners"]').uncheck();
  assert.equal(await options.locator('input[name="captureDelay"][value="0"]').isChecked(), true);
  await options.locator('input[name="captureDelay"][value="5"]').check();
  assert.equal(await options.locator('input[name="burstCount"][value="5"]').isChecked(), true);
  await options.locator('input[name="burstCount"][value="10"]').check();
  await options.locator('input[name="burstInterval"][value="2"]').check();
  assert.equal(await options.locator('input[name="watchLimit"][value="10"]').isChecked(), true);
  await options.locator('input[name="watchLimit"][value="25"]').check();
  await options.locator('input[name="fileNamePrefix"]').fill("  my/shot?  ");
  await options.locator('input[name="fileNamePrefix"]').blur();
  await options.locator("#status", { hasText: /\S/ }).waitFor();
  const storedSettings = await options.evaluate(async () => {
    const stored = await globalThis.chrome.storage.local.get("settings");
    return stored.settings;
  });
  assert.deepEqual(storedSettings, {
    burstCount: 10,
    burstInterval: 2,
    captureDelay: 5,
    defaultAction: "download",
    fileNamePrefix: "myshot",
    format: "webp",
    roundedCorners: false,
    watchLimit: 25,
  });
  await options.reload();
  await options.locator("#file-name-example", { hasText: /\S/ }).waitFor();
  assert.equal(await options.locator('input[name="burstCount"][value="10"]').isChecked(), true);
  assert.equal(await options.locator('input[name="burstInterval"][value="2"]').isChecked(), true);
  assert.equal(await options.locator('input[name="watchLimit"][value="25"]').isChecked(), true);
  assert.equal(await options.locator('input[name="format"][value="webp"]').isChecked(), true);
  assert.equal(await options.locator('input[name="fileNamePrefix"]').inputValue(), "myshot");
  assert.equal(await options.locator('input[name="captureDelay"][value="5"]').isChecked(), true);
  assert.match(await options.locator("#file-name-example").innerText(), /^myshot-.*\.webp$/);
  assert.deepEqual(optionsErrors, []);
  await options.close();

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator("h1", { hasText: "Region Snap" }).waitFor();
  await page.locator("#primary-action").waitFor();
  await page.locator("#full-page-action").waitFor();
  await page.locator(".status-card").waitFor();
  const version = await page.evaluate(() => globalThis.chrome.runtime.getManifest().version);
  const manifest = JSON.parse(await fs.readFile(path.join(DIST_DIR, "manifest.json"), "utf8"));
  assert.equal(version, manifest.version);
  assert.deepEqual(pageErrors, []);
  console.log(
    `Smoke test passed for selection, marks, capture, delay, full page, scrolling capture, burst, capture on change, and popup v${version}.`,
  );
} finally {
  await context.close();
  await fs.rm(profile, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
