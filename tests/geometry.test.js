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

test("a full-page plan steps a viewport at a time and ends flush with the page bottom", () => {
  const plan = geometry.planFullPage(
    { height: 2500, viewportWidth: 1000, viewportHeight: 800 },
    { x: 1, y: 1 },
  );
  assert.deepEqual(plan, {
    width: 1000,
    height: 2500,
    positions: [0, 800, 1600, 1700],
    truncated: false,
  });
});

test("a page that fits the viewport is one slice, and a short document is not cut", () => {
  assert.deepEqual(
    geometry.planFullPage(
      { height: 300, viewportWidth: 1000, viewportHeight: 800 },
      { x: 2, y: 2 },
    ),
    { width: 2000, height: 1600, positions: [0], truncated: false },
  );
  assert.deepEqual(
    geometry.planFullPage({ height: 1600, viewportWidth: 500, viewportHeight: 800 }, { x: 1, y: 1 })
      .positions,
    [0, 800],
  );
});

test("a full-page plan uses the screenshot's own scale", () => {
  const plan = geometry.planFullPage(
    { height: 1000, viewportWidth: 800, viewportHeight: 600 },
    { x: 1.25, y: 1.25 },
  );
  assert.equal(plan.width, 1000);
  assert.equal(plan.height, 1250);
  assert.deepEqual(plan.positions, [0, 400]);
});

test("a page too long for one canvas is cut at the limit and reported", () => {
  const plan = geometry.planFullPage(
    { height: 100000, viewportWidth: 1000, viewportHeight: 1000 },
    { x: 2, y: 2 },
  );
  assert.equal(plan.truncated, true);
  assert.equal(plan.height, geometry.CANVAS_LIMITS.dimension);
  assert.equal(plan.positions.length, 17);
  assert.equal(plan.positions.at(-1), 16000);

  // A wide image runs into the area limit before the height limit.
  const wide = geometry.planFullPage(
    { height: 100000, viewportWidth: 10000, viewportHeight: 1000 },
    { x: 2, y: 2 },
  );
  assert.equal(wide.height, Math.floor(geometry.CANVAS_LIMITS.area / 20000));
  assert.ok(wide.width * wide.height <= geometry.CANVAS_LIMITS.area);
});
