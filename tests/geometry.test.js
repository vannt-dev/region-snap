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

test("shows an opened image at its own size in CSS pixels, centred below the top bar", () => {
  assert.deepEqual(
    geometry.fitImage(
      { width: 800, height: 400 },
      { width: 1200, height: 800 },
      { pixelRatio: 2, top: 100, margin: 20 },
    ),
    { left: 400, top: 340, width: 400, height: 200 },
  );
});

test("shrinks an opened image that is larger than the window and keeps its shape", () => {
  assert.deepEqual(
    geometry.fitImage(
      { width: 4000, height: 1000 },
      { width: 1040, height: 800 },
      { pixelRatio: 1, top: 100, margin: 20 },
    ),
    { left: 20, top: 315, width: 1000, height: 250 },
  );
  assert.deepEqual(
    geometry.fitImage(
      { width: 1000, height: 3000 },
      { width: 1200, height: 720 },
      { pixelRatio: 1, top: 100, margin: 20 },
    ),
    { left: 500, top: 100, width: 200, height: 600 },
  );
});

test("never shows an opened image smaller than one pixel", () => {
  const box = geometry.fitImage(
    { width: 1, height: 1 },
    { width: 30, height: 30 },
    { pixelRatio: 3, top: 40, margin: 20 },
  );
  assert.equal(box.width, 1);
  assert.equal(box.height, 1);
});

test("tells whether an image fits in one canvas", () => {
  assert.equal(geometry.fitsCanvas({ width: 4000, height: 3000 }), true);
  assert.equal(geometry.fitsCanvas({ width: 40000, height: 10 }), false);
  assert.equal(geometry.fitsCanvas({ width: 20000, height: 20000 }), false);
  assert.equal(geometry.fitsCanvas({ width: 0, height: 10 }), false);
});

// Copy text: words read from the page, each with its viewport box, become lines of text.
const word = (text, left, top, extra = {}) => ({
  text,
  left,
  top,
  width: text.length * 8,
  height: 16,
  ...extra,
});

test("keeps a word whose centre is inside the region", () => {
  const region = { left: 100, top: 100, width: 200, height: 100 };
  assert.equal(
    geometry.boxCenterInRect({ left: 90, top: 110, width: 40, height: 16 }, region),
    true,
  );
  assert.equal(
    geometry.boxCenterInRect({ left: 60, top: 110, width: 40, height: 16 }, region),
    false,
  );
  assert.equal(
    geometry.boxCenterInRect({ left: 120, top: 195, width: 40, height: 16 }, region),
    false,
  );
  assert.equal(
    geometry.boxCenterInRect({ left: 120, top: 120, width: 0, height: 0 }, region),
    false,
  );
});

test("orders words into lines top to bottom and left to right", () => {
  const result = geometry.regionText([
    word("world", 60, 10, { spaceBefore: true }),
    word("Second", 0, 30),
    word("Hello", 0, 10),
    word("line", 60, 31, { spaceBefore: true }),
  ]);
  assert.deepEqual(result, { text: "Hello world\nSecond line", lineCount: 2 });
});

test("joins pieces of one word and spaces words that sit apart", () => {
  const result = geometry.regionText([
    word("Hel", 0, 10),
    word("lo", 24, 10),
    word("Price", 200, 10),
    word("12", 260, 10, { spaceBefore: true }),
  ]);
  assert.equal(result.text, "Hello Price 12");
});

test("keeps one blank line between paragraphs", () => {
  const result = geometry.regionText([
    word("First", 0, 0),
    word("Next", 0, 20),
    word("Far", 0, 80),
    word("Farther", 0, 300),
  ]);
  assert.deepEqual(result, { text: "First\nNext\n\nFar\n\nFarther", lineCount: 4 });
});

test("tidies text like the desktop app and counts no lines when empty", () => {
  const result = geometry.regionText([
    word("Tiếng", 0, 0),
    word("  Việt  ", 50, 0, { spaceBefore: true }),
    word("a\tb\n\n\nc", 0, 20),
  ]);
  assert.equal(result.text, "Tiếng Việt\na b\n\nc");
  assert.equal(result.lineCount, 3);
  assert.deepEqual(geometry.regionText([]), { text: "", lineCount: 0 });
  assert.deepEqual(geometry.regionText([word("   ", 0, 0)]), { text: "", lineCount: 0 });
});

test("a remembered region keeps its place on the page and is found again after scrolling", () => {
  const region = geometry.rememberRegion(
    { left: 100, top: 50, width: 300, height: 200 },
    { left: 0, top: 400 },
  );
  assert.deepEqual(region, {
    left: 100,
    top: 450,
    width: 300,
    height: 200,
    scrollLeft: 0,
    scrollTop: 400,
  });
  // Scrolled back to where it was taken, the region is where it was in the window.
  assert.deepEqual(geometry.regionInView(region, { left: 0, top: 400 }, viewport), {
    left: 100,
    top: 50,
    width: 300,
    height: 200,
  });
  // Scrolled a little further, the page moved up and the region with it.
  assert.deepEqual(geometry.regionInView(region, { left: 0, top: 420 }, viewport), {
    left: 100,
    top: 30,
    width: 300,
    height: 200,
  });
});

test("a remembered region only part of which the window shows is not captured", () => {
  const region = geometry.rememberRegion(
    { left: 100, top: 50, width: 300, height: 200 },
    { left: 0, top: 400 },
  );
  assert.equal(
    geometry.regionInView(region, { left: 0, top: 0 }, { width: 1000, height: 600 }),
    null,
  );
  assert.equal(geometry.regionInView(region, { left: 0, top: 480 }, viewport), null);
  assert.equal(
    geometry.regionInView(region, { left: 0, top: 400 }, { width: 350, height: 700 }),
    null,
  );
  // Half a pixel of rounding at an edge is not a missing part.
  assert.ok(geometry.regionInView(region, { left: 0, top: 450.4 }, viewport));
});

test("a region that is not a box of numbers is not remembered", () => {
  assert.equal(geometry.rememberRegion(null, { left: 0, top: 0 }), null);
  assert.equal(
    geometry.rememberRegion({ left: 0, top: 0, width: 0, height: 10 }, { left: 0, top: 0 }),
    null,
  );
  assert.equal(
    geometry.rememberRegion({ left: "x", top: 0, width: 9, height: 9 }, { left: 0, top: 0 }),
    null,
  );
  assert.equal(geometry.regionInView({ left: 1 }, { left: 0, top: 0 }, viewport), null);
});
