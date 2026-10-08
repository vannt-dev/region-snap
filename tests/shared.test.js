const assert = require("node:assert/strict");
const test = require("node:test");

const shared = require("../shared.js");

test("shared communication contract is immutable and internally consistent", () => {
  assert.equal(Object.isFrozen(shared), true);
  assert.equal(Object.isFrozen(shared.MESSAGE), true);
  assert.equal(Object.isFrozen(shared.STATE), true);
  assert.deepEqual(Object.values(shared.COMMAND_TO_MESSAGE).sort(), [
    shared.MESSAGE.CAPTURE_FULL_PAGE,
    shared.MESSAGE.DO_CAPTURE,
    shared.MESSAGE.START_PICKING,
  ]);
  assert.equal(new Set(shared.ALLOWED_PROTOCOLS).size, shared.ALLOWED_PROTOCOLS.length);
});

test("stored settings fall back to defaults field by field", () => {
  assert.deepEqual(shared.normalizeSettings(undefined), shared.DEFAULT_SETTINGS);
  assert.deepEqual(shared.normalizeSettings("garbage"), shared.DEFAULT_SETTINGS);
  assert.deepEqual(
    shared.normalizeSettings({
      captureDelay: 4,
      defaultAction: "upload",
      fileNamePrefix: 42,
      format: "gif",
      roundedCorners: "yes",
      unknown: true,
    }),
    shared.DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    shared.normalizeSettings({ defaultAction: "copy", format: "webp", roundedCorners: false }),
    {
      captureDelay: 0,
      defaultAction: "copy",
      fileNamePrefix: "region-snap",
      format: "webp",
      roundedCorners: false,
    },
  );
  // Only the offered delays pass, and only as numbers: a form value arrives as text.
  assert.equal(shared.normalizeSettings({ captureDelay: 5 }).captureDelay, 5);
  assert.equal(shared.normalizeSettings({ captureDelay: "5" }).captureDelay, 0);
  assert.equal(shared.normalizeSettings({ captureDelay: -3 }).captureDelay, 0);
  assert.deepEqual(
    Object.keys(shared.DEFAULT_SHORTCUTS).sort(),
    [...Object.keys(shared.COMMAND_TO_MESSAGE)].sort(),
  );
  // A lookup on the prototype chain must not pass for a format name.
  assert.equal(shared.normalizeSettings({ format: "toString" }).format, "png");
});

test("file name prefixes are safe on every platform", () => {
  const prefix = (value) => shared.normalizeSettings({ fileNamePrefix: value }).fileNamePrefix;
  assert.equal(prefix("  my shot  "), "my shot");
  assert.equal(prefix('a<b>c:d"e/f\\g|h?i*j'), "abcdefghij");
  assert.equal(prefix("../../etc/passwd"), "etcpasswd");
  assert.equal(prefix("tab\there\nnewline"), "tabherenewline");
  assert.equal(prefix("trailing. . "), "trailing");
  assert.equal(prefix("???"), "region-snap");
  assert.equal(prefix(""), "region-snap");
  assert.equal(prefix("ảnh chụp"), "ảnh chụp");
  assert.equal(prefix("x".repeat(200)).length, shared.FILE_NAME_PREFIX_MAX_LENGTH);
});

test("file names carry the prefix, a local timestamp and the format's extension", () => {
  const date = new Date(2026, 0, 5, 9, 7, 3);
  assert.equal(
    shared.buildFileName(shared.DEFAULT_SETTINGS, date),
    "region-snap-20260105-090703.png",
  );
  assert.equal(
    shared.buildFileName({ fileNamePrefix: "shot", format: "jpeg" }, date),
    "shot-20260105-090703.jpg",
  );
  assert.equal(shared.buildFileName({ format: "webp" }, date), "region-snap-20260105-090703.webp");
});
