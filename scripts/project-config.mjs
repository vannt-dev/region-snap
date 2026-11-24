import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DIST_DIR = path.join(ROOT, "dist");
export const RELEASE_DIR = path.join(ROOT, "release");

// Tesseract's runtime, copied from node_modules at build time so text recognition runs offline:
// Manifest V3 forbids remotely hosted code. Only the LSTM cores ship, since the worker is always
// started with OEM.LSTM_ONLY; the worker loads whichever of the three the browser supports
// (relaxed SIMD, SIMD, neither), so all three are needed. Their `.wasm.js` files embed the
// WebAssembly binary. `strip` marks the files that name jsDelivr as a default location; the
// build removes those addresses, and the offscreen page always passes its own paths.
export const VENDOR_FILES = Object.freeze({
  "vendor/tesseract/tesseract.min.js": {
    from: "node_modules/tesseract.js/dist/tesseract.min.js",
    strip: true,
  },
  "vendor/tesseract/worker.min.js": {
    from: "node_modules/tesseract.js/dist/worker.min.js",
    strip: true,
  },
  "vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js": {
    from: "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  },
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js": {
    from: "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  },
  "vendor/tesseract/tesseract-core-lstm.wasm.js": {
    from: "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  },
  "vendor/tesseract/lang/eng.traineddata.gz": {
    from: "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  },
  "vendor/tesseract/lang/vie.traineddata.gz": {
    from: "node_modules/@tesseract.js-data/vie/4.0.0_best_int/vie.traineddata.gz",
  },
  "vendor/tesseract/LICENSE": { from: "node_modules/tesseract.js-core/LICENSE" },
  // jsQR (Apache-2.0) reads QR codes in the service worker; it fetches nothing.
  "vendor/jsqr/jsQR.js": { from: "node_modules/jsqr/dist/jsQR.js" },
  "vendor/jsqr/LICENSE": { from: "node_modules/jsqr/LICENSE" },
});

export const RUNTIME_FILES = Object.freeze([
  "manifest.json",
  "shared.js",
  "background.js",
  "geometry.js",
  "ocr-text.js",
  "ocr.html",
  "ocr-offscreen.js",
  "qr-code.js",
  "annotations.js",
  "schedule.js",
  "content.js",
  "overlay.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "editor.html",
  "editor.css",
  "editor.js",
  "_locales/en/messages.json",
  "_locales/vi/messages.json",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  ...Object.keys(VENDOR_FILES),
]);

export const STORE_ASSETS = Object.freeze({
  "store-assets/icon-128.png": [128, 128],
  "store-assets/small-promo-440x280.png": [440, 280],
  "store-assets/marquee-promo-1400x560.png": [1400, 560],
  "store-assets/screenshots/01-select-region-1280x800.png": [1280, 800],
  "store-assets/screenshots/02-popup-1280x800.png": [1280, 800],
});
