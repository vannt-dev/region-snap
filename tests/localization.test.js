const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

test("English is complete and Vietnamese has matching message keys", () => {
  const manifest = readJson("manifest.json");
  const english = readJson("_locales/en/messages.json");
  const vietnamese = readJson("_locales/vi/messages.json");

  assert.equal(manifest.default_locale, "en");
  assert.deepEqual(Object.keys(vietnamese).sort(), Object.keys(english).sort());
  for (const value of [manifest.name, manifest.description, manifest.action.default_title]) {
    const key = /^__MSG_(.+)__$/.exec(value)?.[1];
    assert.ok(key && english[key]?.message, `${value} is not defined in English`);
  }
});
