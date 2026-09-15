const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const contentSource = fs.readFileSync(path.join(projectRoot, "content.js"), "utf8");
const overlaySource = fs.readFileSync(path.join(projectRoot, "overlay.css"), "utf8");

test("pointer hot paths do not synchronously read overlay layout", () => {
  assert.doesNotMatch(contentSource, /offset(?:Width|Height|Left|Top)/);
  assert.match(contentSource, /requestAnimationFrame\(flushRender\)/);
});

test("overlay positioning uses shared CSS properties and transforms", () => {
  assert.match(contentSource, /--rs-left/);
  assert.match(overlaySource, /translate3d\(var\(--rs-left\)/);
  assert.match(overlaySource, /contain: strict/);
});

test("capture state hides the complete overlay as one compositor layer", () => {
  assert.match(contentSource, /root\.dataset\.capturing = "true"/);
  assert.match(
    overlaySource,
    /#region-snap-root\[data-capturing="true"\][\s\S]*opacity: 0 !important;/,
  );
  assert.doesNotMatch(contentSource, /root\.style\.visibility/);
});

test("PNG crop uses a transparent rounded clipping path", () => {
  assert.match(contentSource, /const CORNER_RADIUS = 12/);
  assert.match(contentSource, /clipRoundedRect\(context, canvas\.width, canvas\.height/);
  assert.match(contentSource, /context\.clip\(\)/);
  assert.match(overlaySource, /--rs-radius: 12px/);
});

test("replaced content controllers release their runtime listener", () => {
  assert.match(contentSource, /removeListener\(onRuntimeMessage\)/);
  assert.match(contentSource, /destroy,\s*\}\);/);
});

test("page-generated input cannot trigger capture controls or observe download URLs", () => {
  assert.match(contentSource, /if \(event\.isTrusted\) doCapture\(\)/);
  assert.doesNotMatch(contentSource, /appendChild\(anchor\)/);
});

test("capture work is scoped to the selection session that started it", () => {
  assert.match(contentSource, /const captureSession = sessionId/);
  assert.match(contentSource, /if \(captureSession !== sessionId\) return false/g);
  assert.match(contentSource, /if \(captureSession === sessionId\) capturing = false/);
});
