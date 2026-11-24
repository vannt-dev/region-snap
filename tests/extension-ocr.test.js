const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const OcrText = require("../ocr-text.js");
const DesktopOcr = require("../desktop/ocr.cjs");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("the extension and the desktop app share the languages and the text clean-up", () => {
  assert.equal(DesktopOcr.OCR_LANGUAGES, OcrText.OCR_LANGUAGES);
  assert.equal(DesktopOcr.formatRecognizedText, OcrText.formatRecognizedText);
  assert.equal(DesktopOcr.ocrScale, OcrText.ocrScale);
});

test("extension pages may run WebAssembly from the package and nothing else", () => {
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  );
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("every Tesseract file the offscreen page needs ships in the package", async () => {
  const { RUNTIME_FILES, VENDOR_FILES } = await import("../scripts/project-config.mjs");
  const html = fs.readFileSync(path.join(projectRoot, "ocr.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);
  assert.deepEqual(scripts, [
    "shared.js",
    "ocr-text.js",
    "vendor/tesseract/tesseract.min.js",
    "ocr-offscreen.js",
  ]);
  for (const script of scripts) assert.ok(RUNTIME_FILES.includes(script), script);

  const vendor = Object.keys(VENDOR_FILES).map((file) => file.replace("vendor/tesseract/", ""));
  for (const file of [
    "worker.min.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-lstm.wasm.js",
    "LICENSE",
    ...OcrText.OCR_LANGUAGES.map((language) => `lang/${language}.traineddata.gz`),
  ]) {
    assert.ok(vendor.includes(file), `${file} is not bundled`);
  }
  for (const { from } of Object.values(VENDOR_FILES)) {
    assert.ok(fs.statSync(path.join(projectRoot, from)).size > 1000, `${from} is missing`);
  }

  const offscreen = fs.readFileSync(path.join(projectRoot, "ocr-offscreen.js"), "utf8");
  for (const option of ["workerPath", "corePath", "langPath"]) {
    assert.match(offscreen, new RegExp(`${option}: `), `${option} must point into the package`);
  }
  assert.match(offscreen, /workerBlobURL: false/);
  assert.match(offscreen, /cacheMethod: "none"/);
});

test("the build takes the CDN defaults out of Tesseract and finds any script address", async () => {
  const { VENDOR_FILES } = await import("../scripts/project-config.mjs");
  const { findRemoteCode, stripRemoteCode } = await import("../scripts/remote-code.mjs");
  const stripped = Object.values(VENDOR_FILES).filter((file) => file.strip);
  assert.ok(stripped.length >= 2);
  for (const { from } of stripped) {
    const source = fs.readFileSync(path.join(projectRoot, from), "utf8");
    assert.notDeepEqual(findRemoteCode(source), [], `${from} no longer names a CDN`);
    assert.deepEqual(findRemoteCode(stripRemoteCode(source)), [], from);
  }
  assert.deepEqual(findRemoteCode('a="https://example.com/x.js?v=1"; b="//unpkg.com/y"'), [
    "https://example.com/x.js?v=1",
    "//unpkg.com/y",
  ]);
  assert.deepEqual(findRemoteCode('see "https://www.apache.org/licenses/" and https://a.dev/'), []);
});
