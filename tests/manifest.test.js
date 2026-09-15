const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));

test("manifest uses MV3 and on-demand injection", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting"]);
  assert.equal(manifest.content_scripts, undefined);
});

test("all extension entry files exist", () => {
  const requiredFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    "shared.js",
    "geometry.js",
    "content.js",
    "overlay.css",
    "popup.js",
    "popup.css",
    "_locales/en/messages.json",
    "_locales/vi/messages.json",
  ];

  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `${file} is missing`);
  }
});
