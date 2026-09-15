import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DIST_DIR, ROOT, RUNTIME_FILES, STORE_ASSETS } from "./project-config.mjs";

const PNG_SIGNATURE = "89504e470d0a1a0a";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pngDimensions(filePath) {
  const bytes = await fs.readFile(filePath);
  assert.equal(bytes.subarray(0, 8).toString("hex"), PNG_SIGNATURE, `${filePath} is not PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${filePath} lacks IHDR`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function collectManifestMessages(value, keys = new Set()) {
  if (typeof value === "string") {
    const key = /^__MSG_(.+)__$/.exec(value)?.[1];
    if (key) keys.add(key);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectManifestMessages(item, keys));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectManifestMessages(item, keys));
  }
  return keys;
}

async function validateRuntime(baseDir) {
  const entries = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else entries.push(path.relative(baseDir, absolute).replaceAll("\\", "/"));
    }
  }
  await walk(baseDir);
  assert.deepEqual(
    entries.sort(),
    [...RUNTIME_FILES].sort(),
    `${baseDir} has unexpected runtime files`,
  );

  const manifest = await readJson(path.join(baseDir, "manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.default_locale, "en", "English must remain the primary locale");
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting"]);
  assert.equal(manifest.content_scripts, undefined, "content scripts must remain on-demand");

  const localesDirectory = path.join(baseDir, "_locales");
  const localeNames = await fs.readdir(localesDirectory);
  assert.ok(localeNames.includes(manifest.default_locale), "default locale directory is missing");
  const primaryMessages = await readJson(
    path.join(localesDirectory, manifest.default_locale, "messages.json"),
  );
  const primaryKeys = Object.keys(primaryMessages).sort();
  for (const localeName of localeNames) {
    const messages = await readJson(path.join(localesDirectory, localeName, "messages.json"));
    assert.deepEqual(Object.keys(messages).sort(), primaryKeys, `${localeName} locale keys differ`);
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, "string", `${localeName}.${key}.message must be text`);
      assert.ok(entry.message.trim(), `${localeName}.${key}.message is empty`);
    }
  }
  for (const key of collectManifestMessages(manifest)) {
    assert.ok(primaryMessages[key]?.message, `unresolved manifest message: ${key}`);
  }

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
  ];
  for (const relativePath of new Set(referenced)) {
    await fs.access(path.join(baseDir, relativePath));
  }

  for (const relativePath of entries.filter((file) => /\.(?:js|html)$/.test(file))) {
    const source = await fs.readFile(path.join(baseDir, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /<script[^>]+src=["']https?:/i,
      `${relativePath} loads remote code`,
    );
    assert.doesNotMatch(
      source,
      /\b(?:eval|new Function)\s*\(/,
      `${relativePath} uses dynamic code`,
    );
  }
}

const packageJson = await readJson(path.join(ROOT, "package.json"));
const manifest = await readJson(path.join(ROOT, "manifest.json"));
assert.equal(packageJson.version, manifest.version, "package and manifest versions differ");
assert.match(manifest.version, /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/);

for (const [relativePath, expected] of Object.entries({
  "icons/icon16.png": [16, 16],
  "icons/icon32.png": [32, 32],
  "icons/icon48.png": [48, 48],
  "icons/icon128.png": [128, 128],
  ...STORE_ASSETS,
})) {
  assert.deepEqual(await pngDimensions(path.join(ROOT, relativePath)), expected, relativePath);
}

if (await fs.stat(DIST_DIR).catch(() => null)) await validateRuntime(DIST_DIR);

console.log(`Validated Region Snap v${manifest.version}, runtime allowlist, and Store assets.`);
