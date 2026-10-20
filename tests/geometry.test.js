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

test("only an element set to scroll, with more content than room, is a scrolling panel", () => {
  assert.equal(geometry.canScrollY("auto", 900, 300), true);
  assert.equal(geometry.canScrollY("scroll", 900, 300), true);
  assert.equal(geometry.canScrollY("overlay", 900, 300), true);
  assert.equal(geometry.canScrollY("hidden", 900, 300), false);
  assert.equal(geometry.canScrollY("visible", 900, 300), false);
  assert.equal(
    geometry.canScrollY("auto", 301, 300),
    false,
    "a pixel of rounding is not scrolling",
  );
});

// A panel 300 px high showing all of itself, with 1000 px of content.
const panel = { start: 0, end: 1000, offset: 0, windowHeight: 300, maxScroll: 700, width: 400 };

test("a scrolling panel is photographed a window apart, the last flush with its end", () => {
  const plan = geometry.planScrollCapture(panel, { x: 2, y: 2 });
  assert.deepEqual(plan.positions, [0, 300, 600, 700]);
  assert.equal(plan.width, 800);
  assert.equal(plan.height, 2000);
  assert.equal(plan.top, 0);
  assert.equal(plan.bottom, 1000);
  assert.equal(plan.truncated, false);
  assert.equal(plan.partial, false);
});

test("each slice adds only the rows not covered yet, at their place in the image", () => {
  const plan = geometry.planScrollCapture(panel, { x: 1, y: 1 });
  let covered = plan.top;
  const slices = [0, 300, 600, 700].map((position) => {
    const slice = geometry.scrollSlice(
      plan,
      position,
      { offset: 0, windowHeight: 300, windowTop: 120 },
      covered,
    );
    covered = plan.top + slice.destTop + slice.height;
    return slice;
  });
  assert.deepEqual(slices, [
    { sourceTop: 120, destTop: 0, height: 300 },
    { sourceTop: 120, destTop: 300, height: 300 },
    { sourceTop: 120, destTop: 600, height: 300 },
    { sourceTop: 320, destTop: 900, height: 100 },
  ]);
});

test("a tall element starts where it begins in the page and ends where it ends", () => {
  // The page scrolls 4000 px; the element runs from 1500 to 3700 in a 700 px window.
  const plan = geometry.planScrollCapture(
    { start: 1500, end: 3700, offset: 0, windowHeight: 700, maxScroll: 3300, width: 600 },
    { x: 1, y: 1 },
  );
  assert.deepEqual(plan.positions, [1500, 2200, 2900, 3300]);
  assert.equal(plan.height, 2200);
  assert.deepEqual(
    geometry.scrollSlice(plan, 1500, { offset: 0, windowHeight: 700, windowTop: 0 }),
    {
      sourceTop: 0,
      destTop: 0,
      height: 700,
    },
  );
  assert.deepEqual(
    geometry.scrollSlice(plan, 3300, { offset: 0, windowHeight: 700, windowTop: 0 }, 3600),
    {
      sourceTop: 300,
      destTop: 2100,
      height: 100,
    },
  );
});

test("an element near the end of the page is reached by the last scroll position", () => {
  const plan = geometry.planScrollCapture(
    { start: 3500, end: 3900, offset: 0, windowHeight: 700, maxScroll: 3300, width: 600 },
    { x: 1, y: 1 },
  );
  assert.deepEqual(plan.positions, [3300]);
  assert.deepEqual(
    geometry.scrollSlice(plan, 3300, { offset: 0, windowHeight: 700, windowTop: 0 }),
    {
      sourceTop: 200,
      destTop: 0,
      height: 400,
    },
  );
});

test("a panel cut off by the window gives what can be reached and says so", () => {
  // Only 200 px of the panel shows, starting 50 px into it: its first 50 px never come on screen.
  const plan = geometry.planScrollCapture(
    { start: 0, end: 1000, offset: 50, windowHeight: 200, maxScroll: 700, width: 400 },
    { x: 1, y: 1 },
  );
  assert.equal(plan.top, 50);
  assert.equal(plan.bottom, 950);
  assert.equal(plan.partial, true);
  assert.deepEqual(plan.positions, [0, 200, 400, 600, 700]);
});

test("an area taller than a canvas allows is cut at the limit and reported", () => {
  const plan = geometry.planScrollCapture(
    { start: 0, end: 50000, offset: 0, windowHeight: 800, maxScroll: 49200, width: 1000 },
    { x: 1, y: 1 },
  );
  assert.equal(plan.height, geometry.CANVAS_LIMITS.dimension);
  assert.equal(plan.truncated, true);
  assert.equal(plan.bottom, geometry.CANVAS_LIMITS.dimension);
  const last = plan.positions.at(-1);
  assert.ok(last + 800 >= plan.bottom, "the slices reach the cut");
  assert.ok(last < plan.bottom, "no slice is taken past the cut");
});

test("a slice that adds nothing new is skipped", () => {
  const plan = geometry.planScrollCapture(panel, { x: 1, y: 1 });
  assert.equal(
    geometry.scrollSlice(plan, 700, { offset: 0, windowHeight: 300, windowTop: 0 }, 1000),
    null,
  );
});
