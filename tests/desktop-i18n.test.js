const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "desktop/i18n.js"), "utf8");
const pages = ["desktop/settings.html", "desktop/overlay.html"].map((file) =>
  fs.readFileSync(path.join(root, file), "utf8"),
);
const scripts = ["desktop/settings.js", "desktop/overlay.js"].map((file) =>
  fs.readFileSync(path.join(root, file), "utf8"),
);

function translations(locale) {
  const document = {
    body: { dataset: {} },
    documentElement: { lang: "" },
    querySelectorAll: () => [],
    title: "",
  };
  const context = { document, location: { search: `?lang=${locale}` }, URLSearchParams };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.RegionSnapI18n;
}

test("desktop pages have complete English and Vietnamese translations", () => {
  const keys = new Set([
    ...pages.flatMap((html) =>
      [...html.matchAll(/data-(?:i18n(?:-title|-aria-label)?|title-key)="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
    ...scripts.flatMap((script) =>
      [...script.matchAll(/translate\("([^"]+)"\)/g)].map((match) => match[1]),
    ),
  ]);
  const english = translations("en");
  const vietnamese = translations("vi");

  assert.equal(english.locale, "en");
  assert.equal(vietnamese.locale, "vi");
  for (const key of keys) {
    assert.notEqual(english.translate(key), key, `missing English desktop message: ${key}`);
    assert.notEqual(vietnamese.translate(key), key, `missing Vietnamese desktop message: ${key}`);
  }
});
