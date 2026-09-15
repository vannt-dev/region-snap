const assert = require("node:assert/strict");
const test = require("node:test");
const geometry = require("../geometry.js");

const viewport = { width: 1000, height: 700 };

test("normalizes drag points in every direction", () => {
  assert.deepEqual(geometry.rectFromPoints({ x: 500, y: 400 }, { x: 100, y: 150 }), {
    left: 100,
    top: 150,
    width: 400,
    height: 250,
  });
});

test("clips rectangles to the visible viewport", () => {
  assert.deepEqual(
    geometry.fitRectToBounds({ left: -20, top: 650, width: 120, height: 100 }, viewport),
    { left: 0, top: 650, width: 100, height: 50 },
  );
});

test("moves rectangles without allowing overflow", () => {
  assert.deepEqual(
    geometry.moveRectTo({ left: 20, top: 20, width: 200, height: 100 }, 950, -40, viewport),
    { left: 800, top: 0, width: 200, height: 100 },
  );
});

test("resizes from a corner while enforcing the minimum size", () => {
  assert.deepEqual(
    geometry.resizeRect(
      { left: 100, top: 100, width: 300, height: 200 },
      "nw",
      { x: 500, y: 500 },
      viewport,
      8,
    ),
    { left: 392, top: 292, width: 8, height: 8 },
  );
});

test("derives crop scaling from actual screenshot dimensions", () => {
  assert.deepEqual(
    geometry.getCropMetrics(
      { left: 100, top: 50, width: 200, height: 100 },
      { width: 1000, height: 500 },
      { width: 2000, height: 1500 },
    ),
    {
      source: { x: 200, y: 150, width: 400, height: 300 },
      output: { width: 400, height: 300 },
    },
  );
});
