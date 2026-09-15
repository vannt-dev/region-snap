import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DIST_DIR = path.join(ROOT, "dist");
export const RELEASE_DIR = path.join(ROOT, "release");

export const RUNTIME_FILES = Object.freeze([
  "manifest.json",
  "shared.js",
  "background.js",
  "geometry.js",
  "content.js",
  "overlay.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "_locales/en/messages.json",
  "_locales/vi/messages.json",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
]);

export const STORE_ASSETS = Object.freeze({
  "store-assets/icon-128.png": [128, 128],
  "store-assets/small-promo-440x280.png": [440, 280],
  "store-assets/marquee-promo-1400x560.png": [1400, 560],
  "store-assets/screenshots/01-select-region-1280x800.png": [1280, 800],
  "store-assets/screenshots/02-popup-1280x800.png": [1280, 800],
});
