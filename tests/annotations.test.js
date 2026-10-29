const assert = require("node:assert/strict");
const test = require("node:test");
const annotations = require("../annotations.js");

const region = { left: 100, top: 50, width: 400, height: 300 };

// Records what is drawn, in order, without a real canvas.
function recordingContext(log, name = "main") {
  const state = {};
  const call =
    (method) =>
    (...args) =>
      log.push([
        name,
        method,
        ...args.filter((value) => typeof value === "number" || typeof value === "string"),
      ]);
  return new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      return call(property);
    },
    set(target, property, value) {
      target[property] = value;
      log.push([name, `set:${String(property)}`, value]);
      return true;
    },
  });
}

test("a box is normalized whichever way it was dragged", () => {
  assert.deepEqual(annotations.createMark("box", { x: 300, y: 200 }, { x: 150, y: 80 }, region), {
    tool: "box",
    left: 150,
    top: 80,
    width: 150,
    height: 120,
  });
});

test("a mark is kept inside the region it was drawn in", () => {
  assert.deepEqual(annotations.createMark("hide", { x: 60, y: 20 }, { x: 900, y: 900 }, region), {
    tool: "hide",
    left: 100,
    top: 50,
    width: 400,
    height: 300,
  });
  assert.deepEqual(annotations.createMark("arrow", { x: 120, y: 70 }, { x: 900, y: 10 }, region), {
    tool: "arrow",
    x1: 120,
    y1: 70,
    x2: 500,
    y2: 50,
  });
});

test("a click or a sliver is not a mark", () => {
  assert.equal(
    annotations.createMark("arrow", { x: 200, y: 200 }, { x: 203, y: 202 }, region),
    null,
  );
  assert.equal(annotations.createMark("box", { x: 200, y: 200 }, { x: 320, y: 203 }, region), null);
  assert.equal(
    annotations.createMark("hide", { x: 200, y: 200 }, { x: 202, y: 320 }, region),
    null,
  );
  assert.equal(annotations.createMark("pen", { x: 200, y: 200 }, { x: 320, y: 320 }, region), null);
  for (const tool of annotations.CLICK_TOOLS) {
    assert.equal(
      annotations.createMark(tool, { x: 200, y: 200 }, { x: 320, y: 320 }, region),
      null,
      `${tool} is placed with a click, not drawn with a drag`,
    );
  }
});

test("an arrow head points along the arrow and the shaft stops at its base", () => {
  const head = annotations.arrowHead({ x1: 0, y1: 0, x2: 100, y2: 0 }, 10);
  assert.deepEqual(head.tip, { x: 100, y: 0 });
  assert.deepEqual(head.shaftEnd, { x: 90, y: 0 });
  assert.deepEqual(head.left, { x: 90, y: 5 });
  assert.deepEqual(head.right, { x: 90, y: -5 });
});

test("an arrow shorter than its head gets a head no longer than itself", () => {
  const head = annotations.arrowHead({ x1: 0, y1: 0, x2: 0, y2: 8 }, 14);
  assert.deepEqual(head.shaftEnd, { x: 0, y: 0 });
  assert.equal(annotations.arrowHead({ x1: 5, y1: 5, x2: 5, y2: 5 }), null);
});

test("marks are converted from the viewport to image pixels", () => {
  const origin = { left: 100, top: 50 };
  const scale = { x: 2, y: 2 };
  assert.deepEqual(
    annotations.toOutput({ tool: "box", left: 150, top: 80, width: 40, height: 20 }, origin, scale),
    { tool: "box", left: 100, top: 60, width: 80, height: 40 },
  );
  assert.deepEqual(
    annotations.toOutput({ tool: "arrow", x1: 100, y1: 50, x2: 300, y2: 150 }, origin, scale),
    { tool: "arrow", x1: 0, y1: 0, x2: 400, y2: 200 },
  );
});

test("a hidden area is cut to whole pixels on the canvas", () => {
  const canvas = { width: 200, height: 100 };
  assert.deepEqual(
    annotations.hideArea({ left: 10.4, top: 20.6, width: 30.2, height: 10.1 }, canvas),
    { left: 10, top: 20, width: 31, height: 11 },
  );
  assert.deepEqual(annotations.hideArea({ left: 180, top: 90, width: 80, height: 80 }, canvas), {
    left: 180,
    top: 90,
    width: 20,
    height: 10,
  });
  assert.equal(annotations.hideArea({ left: 250, top: 10, width: 30, height: 30 }, canvas), null);
});

test("hidden areas become a mosaic before arrows and boxes are drawn over them", () => {
  const log = [];
  const canvas = { width: 800, height: 600 };
  const scratch = [];
  const createCanvas = (width, height) => {
    const small = {
      width,
      height,
      getContext: () => recordingContext(log, "scratch"),
    };
    scratch.push({ width, height });
    return small;
  };

  annotations.drawMarks(
    recordingContext(log),
    canvas,
    [
      { tool: "arrow", x1: 120, y1: 70, x2: 220, y2: 70 },
      { tool: "hide", left: 200, top: 100, width: 140, height: 28 },
      { tool: "box", left: 150, top: 80, width: 40, height: 20 },
    ],
    { origin: { left: 100, top: 50 }, scale: { x: 2, y: 2 }, createCanvas },
  );

  // 280 x 56 image pixels in blocks of 28: ten columns, two rows.
  assert.deepEqual(scratch, [{ width: 10, height: 2 }]);
  const draws = log.filter(([, method]) => method === "drawImage");
  assert.deepEqual(draws[0], ["scratch", "drawImage", 200, 100, 280, 56, 0, 0, 10, 2]);
  assert.deepEqual(draws[1], ["main", "drawImage", 0, 0, 10, 2, 200, 100, 280, 56]);

  const smoothingOff = log.findIndex(
    ([name, method, value]) =>
      name === "main" && method === "set:imageSmoothingEnabled" && value === false,
  );
  const mosaic = log.findIndex(([name, method]) => name === "main" && method === "drawImage");
  const firstStroke = log.findIndex(([name, method]) => name === "main" && method === "stroke");
  assert.ok(smoothingOff >= 0 && smoothingOff < mosaic, "the mosaic is drawn back unsmoothed");
  assert.ok(mosaic < firstStroke, "arrows and boxes are drawn after the mosaic");

  assert.deepEqual(
    log.find(([name, method]) => name === "main" && method === "set:lineWidth"),
    ["main", "set:lineWidth", annotations.LINE_WIDTH * 2],
  );
  assert.equal(log.filter(([name, method]) => name === "main" && method === "stroke").length, 2);
  assert.equal(log.filter(([name, method]) => name === "main" && method === "fill").length, 1);
});

test("an image without marks is left untouched", () => {
  const log = [];
  annotations.drawMarks(recordingContext(log), { width: 10, height: 10 }, [], {
    origin: { left: 0, top: 0 },
    scale: { x: 1, y: 1 },
    createCanvas: () => assert.fail("no scratch canvas is needed"),
  });
  assert.deepEqual(log, []);
});

test("a step is numbered one more than the highest step left", () => {
  assert.equal(annotations.nextStepNumber([]), 1);
  const first = annotations.createStepMark({ x: 150, y: 100 }, [], region);
  assert.deepEqual(first, { tool: "step", x: 150, y: 100, number: 1 });
  const box = { tool: "box", left: 150, top: 80, width: 40, height: 20 };
  const second = annotations.createStepMark({ x: 200, y: 100 }, [first, box], region);
  assert.equal(second.number, 2);
  const third = annotations.createStepMark({ x: 250, y: 100 }, [first, box, second], region);
  assert.equal(third.number, 3);
});

test("after an undo the numbering carries on from the steps that are left", () => {
  const marks = [];
  for (const x of [150, 200, 250]) {
    marks.push(annotations.createStepMark({ x, y: 100 }, marks, region));
  }
  marks.pop();
  assert.equal(annotations.nextStepNumber(marks), 3);
  assert.equal(annotations.createStepMark({ x: 300, y: 100 }, marks, region).number, 3);
  marks.splice(0);
  assert.equal(annotations.nextStepNumber(marks), 1);
});

test("a step circle stays whole inside the region", () => {
  const step = annotations.createStepMark({ x: 90, y: 400 }, [], region);
  assert.equal(step.x, region.left + annotations.STEP_RADIUS);
  assert.equal(step.y, region.top + region.height - annotations.STEP_RADIUS);
  assert.equal(annotations.createStepMark({ x: 150, y: 100 }, [], null), null);
});

test("a text mark keeps its lines and size, and empty text is no mark", () => {
  assert.deepEqual(
    annotations.createTextMark({ x: 120, y: 60 }, "Click here\r\nthen here", "large", region),
    { tool: "text", x: 120, y: 60, text: "Click here\nthen here", size: "large" },
  );
  assert.equal(
    annotations.createTextMark({ x: 120, y: 60 }, "note", "huge", region).size,
    "medium",
    "an unknown size falls back to medium",
  );
  assert.deepEqual(annotations.createTextMark({ x: 10, y: 900 }, "x", "small", region), {
    tool: "text",
    x: 100,
    y: 350,
    text: "x",
    size: "small",
  });
  assert.equal(annotations.createTextMark({ x: 120, y: 60 }, "  \n ", "small", region), null);
  assert.equal(annotations.createTextMark({ x: 120, y: 60 }, 42, "small", region), null);
});

test("the text font grows with the size and the image scale", () => {
  assert.match(
    annotations.textFont("small"),
    new RegExp(`^600 ${annotations.TEXT_SIZES.small}px `),
  );
  assert.match(
    annotations.textFont("large", 2),
    new RegExp(`^600 ${annotations.TEXT_SIZES.large * 2}px `),
  );
  assert.ok(annotations.TEXT_SIZES.small < annotations.TEXT_SIZES.medium);
  assert.ok(annotations.TEXT_SIZES.medium < annotations.TEXT_SIZES.large);
});

test("text and steps are converted from the viewport to image pixels", () => {
  const origin = { left: 100, top: 50 };
  const scale = { x: 2, y: 2 };
  assert.deepEqual(
    annotations.toOutput({ tool: "text", x: 120, y: 60, text: "Hi", size: "small" }, origin, scale),
    { tool: "text", x: 40, y: 20, text: "Hi", size: "small" },
  );
  assert.deepEqual(
    annotations.toOutput({ tool: "step", x: 150, y: 100, number: 4 }, origin, scale),
    { tool: "step", x: 100, y: 100, number: 4 },
  );
});

test("text and step numbers are drawn into the image at its resolution", () => {
  const log = [];
  annotations.drawMarks(
    recordingContext(log),
    { width: 800, height: 600 },
    [
      { tool: "text", x: 120, y: 60, text: "First\nSecond", size: "medium" },
      { tool: "step", x: 150, y: 100, number: 1 },
      { tool: "step", x: 250, y: 100, number: 2 },
    ],
    { origin: { left: 100, top: 50 }, scale: { x: 2, y: 2 }, createCanvas: () => null },
  );

  const fonts = log.filter(([, method]) => method === "set:font").map(([, , value]) => value);
  assert.ok(fonts.includes(annotations.textFont("medium", 2)), "the text font is scaled");

  const size = annotations.TEXT_SIZES.medium * 2;
  const lineHeight = size * annotations.TEXT_LINE_HEIGHT;
  const firstTop = 20 + (lineHeight - size) / 2;
  const filled = log.filter(([, method]) => method === "fillText");
  assert.deepEqual(filled, [
    ["main", "fillText", "First", 40, firstTop],
    ["main", "fillText", "Second", 40, firstTop + lineHeight],
    ["main", "fillText", "1", 100, 100],
    ["main", "fillText", "2", 300, 100],
  ]);
  assert.equal(
    log.filter(([, method]) => method === "strokeText").length,
    2,
    "every text line gets a light outline so it reads on any background",
  );

  const circles = log.filter(([, method]) => method === "arc");
  assert.deepEqual(
    circles.map(([, , x, y, radius]) => [x, y, radius]),
    [
      [100, 100, annotations.STEP_RADIUS * 2],
      [300, 100, annotations.STEP_RADIUS * 2],
    ],
  );
});

test("marks take a colour from the palette, and anything else falls back to red", () => {
  const { MARK_COLORS, MARK_COLOR } = annotations;
  assert.equal(MARK_COLOR, MARK_COLORS.red, "red stays the default colour");
  assert.ok(Object.keys(MARK_COLORS).length >= 4 && Object.keys(MARK_COLORS).length <= 6);
  for (const color of Object.values(MARK_COLORS)) assert.equal(annotations.markColor(color), color);
  for (const value of ["#123456", "red", "", null, undefined, 42, "url(x)"]) {
    assert.equal(annotations.markColor(value), MARK_COLOR, `${value} is not a mark colour`);
  }
});

test("a colour chosen for a mark is kept on it, except on a hidden area", () => {
  const blue = annotations.MARK_COLORS.blue;
  const from = { x: 150, y: 80 };
  const to = { x: 300, y: 200 };
  assert.equal(annotations.createMark("box", from, to, region, blue).color, blue);
  assert.equal(annotations.createMark("arrow", from, to, region, blue).color, blue);
  assert.equal(annotations.createMark("highlight", from, to, region, blue).color, blue);
  assert.equal(annotations.createMark("box", from, to, region, "#123456").color, "#ef4444");
  assert.equal(
    Object.hasOwn(annotations.createMark("hide", from, to, region, blue), "color"),
    false,
  );
  assert.equal(annotations.createTextMark(from, "Hi", "small", region, blue).color, blue);
  assert.equal(annotations.createStepMark(from, [], region, blue).color, blue);
});

test("a highlight is a rectangle like a box, and too thin a sliver is no mark", () => {
  assert.ok(annotations.TOOLS.includes("highlight"));
  assert.equal(annotations.CLICK_TOOLS.includes("highlight"), false);
  assert.deepEqual(
    annotations.createMark("highlight", { x: 300, y: 120 }, { x: 150, y: 100 }, region),
    { tool: "highlight", left: 150, top: 100, width: 150, height: 20 },
  );
  assert.equal(
    annotations.createMark("highlight", { x: 150, y: 100 }, { x: 300, y: 102 }, region),
    null,
  );
});

test("the colour goes with a mark into image pixels", () => {
  const origin = { left: 100, top: 50 };
  const scale = { x: 2, y: 2 };
  const green = annotations.MARK_COLORS.green;
  const highlight = { tool: "highlight", left: 150, top: 80, width: 40, height: 20, color: green };
  assert.deepEqual(annotations.toOutput(highlight, origin, scale), {
    tool: "highlight",
    left: 100,
    top: 60,
    width: 80,
    height: 40,
    color: green,
  });
  const arrow = { tool: "arrow", x1: 100, y1: 50, x2: 300, y2: 150, color: green };
  assert.equal(annotations.toOutput(arrow, origin, scale).color, green);
});

test("light colours get dark ink for step numbers and note outlines", () => {
  const { MARK_COLORS, HALO_COLOR } = annotations;
  assert.equal(annotations.markInk(MARK_COLORS.red), HALO_COLOR);
  assert.equal(annotations.markInk(MARK_COLORS.blue), HALO_COLOR);
  assert.equal(annotations.markInk(MARK_COLORS.black), HALO_COLOR);
  assert.notEqual(annotations.markInk(MARK_COLORS.yellow), HALO_COLOR);
});

test("highlights are see-through, under the arrows and boxes and over hidden areas", () => {
  const log = [];
  const { MARK_COLORS } = annotations;
  annotations.drawMarks(
    recordingContext(log),
    { width: 800, height: 600 },
    [
      { tool: "box", left: 150, top: 80, width: 40, height: 20, color: MARK_COLORS.blue },
      { tool: "highlight", left: 120, top: 60, width: 100, height: 20, color: MARK_COLORS.yellow },
      { tool: "hide", left: 200, top: 100, width: 140, height: 28 },
    ],
    {
      origin: { left: 100, top: 50 },
      scale: { x: 2, y: 2 },
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => recordingContext(log, "scratch"),
      }),
    },
  );
  const main = log.filter(([name]) => name === "main");
  const mosaic = main.findIndex(([, method]) => method === "drawImage");
  const highlight = main.findIndex(([, method]) => method === "fillRect");
  const box = main.findIndex(([, method]) => method === "stroke");
  assert.ok(mosaic < highlight && highlight < box, "hidden area, then highlight, then box");
  assert.deepEqual(main[highlight], ["main", "fillRect", 40, 20, 200, 40]);
  const alpha = main.slice(0, highlight).findLast(([, method]) => method === "set:globalAlpha");
  assert.ok(alpha && alpha[2] > 0 && alpha[2] < 0.6, "the text under a highlight shows through");
  const fill = main.slice(0, highlight).findLast(([, method]) => method === "set:fillStyle");
  assert.equal(fill[2], MARK_COLORS.yellow);
  const stroke = main.slice(0, box).findLast(([, method]) => method === "set:strokeStyle");
  assert.equal(stroke[2], MARK_COLORS.blue, "each mark is drawn in its own colour");
});

test("text and steps are drawn in their colour with contrasting ink", () => {
  const log = [];
  const { MARK_COLORS } = annotations;
  annotations.drawMarks(
    recordingContext(log),
    { width: 800, height: 600 },
    [
      { tool: "text", x: 120, y: 60, text: "Hi", size: "medium", color: MARK_COLORS.green },
      { tool: "step", x: 150, y: 100, number: 1, color: MARK_COLORS.yellow },
    ],
    { origin: { left: 100, top: 50 }, scale: { x: 1, y: 1 }, createCanvas: () => null },
  );
  const fills = log.filter(([, method]) => method === "set:fillStyle").map(([, , value]) => value);
  assert.ok(fills.includes(MARK_COLORS.green), "the note is in its colour");
  assert.ok(fills.includes(MARK_COLORS.yellow), "the step is in its colour");
  assert.ok(
    fills.includes(annotations.markInk(MARK_COLORS.yellow)),
    "the number on a yellow step uses dark ink",
  );
});
