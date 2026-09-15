import assert from "node:assert/strict";
import fs from "node:fs/promises";

const tag = process.env.GITHUB_REF_NAME || process.argv[2];
assert.ok(tag, "Provide a release tag such as v1.0.0");
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
assert.equal(tag, `v${packageJson.version}`, "Git tag does not match package version");
assert.equal(
  manifest.version,
  packageJson.version,
  "Manifest version does not match package version",
);
console.log(`Release version verified: ${tag}`);
