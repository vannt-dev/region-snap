import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DIST_DIR, RELEASE_DIR, ROOT, RUNTIME_FILES } from "./project-config.mjs";

const manifest = JSON.parse(await fs.readFile(path.join(DIST_DIR, "manifest.json"), "utf8"));
const locale = JSON.parse(
  await fs.readFile(
    path.join(DIST_DIR, "_locales", manifest.default_locale, "messages.json"),
    "utf8",
  ),
);
const messageKey = /^__MSG_(.+)__$/.exec(manifest.name)?.[1];
const displayName = (messageKey && locale[messageKey]?.message) || manifest.name;
const slug = displayName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const zipPath = path.join(RELEASE_DIR, `${slug}-v${manifest.version}-store.zip`);
await fs.mkdir(RELEASE_DIR, { recursive: true });
await fs.rm(zipPath, { force: true });

let result;
if (process.platform === "win32") {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `Compress-Archive -Path ${quote(path.join(DIST_DIR, "*"))} -DestinationPath ${quote(zipPath)} -CompressionLevel Optimal -Force`;
  result = spawnSync("powershell", ["-NoProfile", "-Command", command], { stdio: "inherit" });
} else {
  result = spawnSync("zip", ["-q", "-r", zipPath, "."], { cwd: DIST_DIR, stdio: "inherit" });
}
if (result.status !== 0) throw new Error(`ZIP command failed with status ${result.status}`);

const bytes = await fs.readFile(zipPath);
assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK", "release is not a ZIP file");

const entries = [];
for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
  if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
  const nameLength = bytes.readUInt16LE(offset + 28);
  const extraLength = bytes.readUInt16LE(offset + 30);
  const commentLength = bytes.readUInt16LE(offset + 32);
  const name = bytes
    .subarray(offset + 46, offset + 46 + nameLength)
    .toString("utf8")
    .replaceAll("\\", "/");
  if (!name.endsWith("/")) entries.push(name);
  offset += 45 + nameLength + extraLength + commentLength;
}
assert.deepEqual(
  entries.sort(),
  [...RUNTIME_FILES].sort(),
  "ZIP content differs from runtime allowlist",
);

const relativeZip = path.relative(ROOT, zipPath);
console.log(
  `Created ${relativeZip} (${(bytes.length / 1024).toFixed(1)} KiB, ${entries.length} files).`,
);
