const assert = require("node:assert/strict");
const test = require("node:test");
const {
  displayLayout,
  getNativeCropBounds,
  getVirtualBounds,
  intersectRect,
  sameDisplayLayout,
  validateSelection,
} = require("../desktop/capture-utils.cjs");

test("intersects a selection with only the displays it crosses", () => {
  assert.deepEqual(
    intersectRect(
      { left: 900, top: 100, width: 300, height: 200 },
      { left: 1000, top: 0, width: 1000, height: 800 },
    ),
    { left: 1000, top: 100, width: 200, height: 200 },
  );
  assert.equal(
    intersectRect(
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 100, top: 0, width: 100, height: 100 },
    ),
    null,
  );
});

test("validates and clips a desktop selection to its viewport", () => {
  assert.deepEqual(
    validateSelection(
      {
        rect: { left: -10, top: 50, width: 210, height: 100 },
        viewport: { width: 1000, height: 500 },
      },
      { width: 1000, height: 500 },
    ),
    {
      rect: { left: 0, top: 50, width: 200, height: 100 },
      viewport: { width: 1000, height: 500 },
    },
  );
});

test("rejects a selection from a stale virtual desktop viewport", () => {
  assert.throws(
    () =>
      validateSelection(
        {
          rect: { left: 0, top: 0, width: 100, height: 100 },
          viewport: { width: 1000, height: 500 },
        },
        { width: 2000, height: 500 },
      ),
    /Kích thước vùng chụp không hợp lệ/,
  );
});

test("normalizes displays into one virtual desktop", () => {
  const displays = [
    { id: 1, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, scaleFactor: 1 },
    { id: 2, bounds: { x: 0, y: -200, width: 1920, height: 1080 }, scaleFactor: 1.5 },
  ];
  const virtualBounds = getVirtualBounds(displays);
  assert.deepEqual(virtualBounds, { x: -1280, y: -200, width: 3200, height: 1224 });
  assert.deepEqual(displayLayout(displays, virtualBounds), [
    { id: "1", bounds: { x: 0, y: 200, width: 1280, height: 1024 }, scaleFactor: 1 },
    { id: "2", bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 },
  ]);
});

test("detects a changed display layout", () => {
  const original = [{ id: "1", bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.equal(sameDisplayLayout(original, structuredClone(original)), true);
  assert.equal(
    sameDisplayLayout(original, [{ id: "1", bounds: { x: 0, y: 0, width: 2560, height: 1440 } }]),
    false,
  );
});

test("maps a logical desktop selection to integer native-image crop bounds", () => {
  assert.deepEqual(
    getNativeCropBounds(
      { left: 100.25, top: 50.25, width: 200.5, height: 100.5 },
      { width: 1000, height: 500 },
      { width: 1500, height: 750 },
    ),
    { x: 150, y: 75, width: 302, height: 152 },
  );
});

test("clips native crop bounds at the screenshot edge", () => {
  assert.deepEqual(
    getNativeCropBounds(
      { left: 900, top: 450, width: 100, height: 50 },
      { width: 1000, height: 500 },
      { width: 1250, height: 625 },
    ),
    { x: 1125, y: 562, width: 125, height: 63 },
  );
});
