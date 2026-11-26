const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  PIN_LIMITS,
  clampOpacity,
  clampScale,
  dragBounds,
  initialPinBounds,
  keepOnScreen,
  nextOpacity,
  nextScale,
  normalizeAccelerator,
  sameAccelerator,
  scaleLimits,
  scaledBounds,
} = require("../desktop/pin-utils.cjs");

const root = path.resolve(__dirname, "..");
const base = { width: 200, height: 100 };

test("pins a capture exactly over the captured region", () => {
  assert.deepEqual(
    initialPinBounds(
      { left: 100.4, top: 50.6, width: 200.2, height: 99.6 },
      { x: -1280, y: -200, width: 3200, height: 1224 },
    ),
    { x: -1180, y: -149, width: 200, height: 100 },
  );
});

test("wheel up zooms in and wheel down zooms out by one step per notch", () => {
  assert.equal(nextScale(1, -100, base), 1.1);
  assert.equal(nextScale(1, 100, base), 0.909);
  assert.equal(nextScale(1, -300, base), 1.331);
  assert.equal(nextScale(1, -50, base), 1.049, "touchpads zoom by part of a step");
  assert.equal(nextScale(1, -10_000, base), 1.331, "one event zooms at most three steps");
  assert.equal(nextScale(1, Number.NaN, base), 1);
});

test("keeps the zoom between a usable minimum and the window size limit", () => {
  assert.deepEqual(scaleLimits(base), { min: 0.16, max: PIN_LIMITS.maxScale });
  assert.deepEqual(scaleLimits({ width: 8, height: 8 }), { min: 1, max: PIN_LIMITS.maxScale });
  assert.deepEqual(scaleLimits({ width: 8000, height: 4000 }), { min: 0.1, max: 2.048 });
  assert.deepEqual(scaleLimits({ width: 20000, height: 50 }), { min: 0.32, max: 1 });
  assert.equal(clampScale(0.01, base), 0.16);
  assert.equal(clampScale(50, base), PIN_LIMITS.maxScale);
  assert.equal(clampScale(Number.POSITIVE_INFINITY, base), 1);

  let scale = 1;
  for (let step = 0; step < 100; step += 1) scale = nextScale(scale, 100, base);
  assert.equal(scale, 0.16);
  for (let step = 0; step < 100; step += 1) scale = nextScale(scale, -100, base);
  assert.equal(scale, PIN_LIMITS.maxScale);
});

test("zooms around the point under the cursor", () => {
  const bounds = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(scaledBounds(bounds, base, 2, { x: 0, y: 0 }), {
    x: 100,
    y: 100,
    width: 400,
    height: 200,
  });
  assert.deepEqual(scaledBounds(bounds, base, 2, { x: 1, y: 1 }), {
    x: -100,
    y: 0,
    width: 400,
    height: 200,
  });
  assert.deepEqual(scaledBounds(bounds, base, 0.5), { x: 150, y: 125, width: 100, height: 50 });
  assert.deepEqual(
    scaledBounds(bounds, base, 2, { x: 7, y: -3 }),
    scaledBounds(bounds, base, 2, { x: 1, y: 0 }),
    "anchors outside the window are clamped to its edges",
  );
});

test("Ctrl+wheel changes opacity within limits", () => {
  assert.equal(nextOpacity(1, 100), 0.9);
  assert.equal(nextOpacity(0.5, -100), 0.6);
  assert.equal(nextOpacity(1, -100), 1);
  assert.equal(nextOpacity(0.25, 300), PIN_LIMITS.minOpacity, "a pin never becomes invisible");
  assert.equal(clampOpacity(Number.NaN), 1);
  assert.equal(clampOpacity(0.456), 0.46);
});

test("drags a pin by how far the pointer moved and keeps its size", () => {
  const start = { x: 10, y: 20, width: 201, height: 99 };
  assert.deepEqual(dragBounds(start, { x: 500, y: 400 }, { x: 540.4, y: 370 }), {
    x: 50,
    y: -10,
    width: 201,
    height: 99,
  });
  assert.deepEqual(dragBounds(start, { x: 500, y: 400 }, { x: Number.NaN }), start);
});

test("brings a pin of an older capture back onto the display", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const inside = { x: 100, y: 100, width: 300, height: 200 };
  assert.deepEqual(keepOnScreen(inside, display), inside);
  assert.deepEqual(keepOnScreen({ ...inside, x: 3000, y: -500 }, display), {
    ...inside,
    x: 1872,
    y: 0,
  });
  assert.deepEqual(keepOnScreen({ ...inside, x: -1000, y: 2000 }, display), {
    ...inside,
    x: -252,
    y: 1032,
  });
});

test("detects a pin shortcut that repeats the capture shortcut", () => {
  assert.equal(normalizeAccelerator(" Shift + Alt + s "), "alt+shift+s");
  assert.equal(normalizeAccelerator("CommandOrControl+Shift+P"), "ctrl+shift+p");
  assert.equal(normalizeAccelerator(""), "");
  assert.equal(sameAccelerator("Alt+Shift+S", "shift+alt+S"), true);
  assert.equal(sameAccelerator("CmdOrCtrl+P", "Control+P"), true);
  assert.equal(sameAccelerator("Alt+Shift+S", "Alt+Shift+P"), false);
  assert.equal(sameAccelerator("Alt+Shift+S", ""), false);
  assert.equal(sameAccelerator("", ""), false);
});

test("the pin window keeps the desktop security settings and a strict page policy", () => {
  const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
  const pinWindow = main.slice(main.indexOf("async function createPin"));
  const options = pinWindow.slice(0, pinWindow.indexOf("hardenWindow(pin)"));
  assert.match(options, /preload: path\.join\(__dirname, "pin-preload\.cjs"\)/);
  assert.match(options, /contextIsolation: true/);
  assert.match(options, /nodeIntegration: false/);
  assert.match(options, /sandbox: true/);
  assert.match(options, /alwaysOnTop: true/);
  assert.match(options, /frame: false/);

  const page = fs.readFileSync(path.join(root, "desktop/pin.html"), "utf8");
  assert.match(
    page,
    /content="default-src 'none'; img-src data:; style-src 'self'; script-src 'self'"/,
  );
  assert.doesNotMatch(page, /<script>|\son[a-z]+="/, "the pin page has no inline script");
});
