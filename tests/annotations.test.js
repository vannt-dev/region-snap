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
      log.push([name, method, ...args.filter((value) => typeof value === "number")]);
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
