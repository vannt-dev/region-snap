import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
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

// Build the ZIP in Node instead of calling zip or Compress-Archive, so entry names are always
// "/"-separated (Windows PowerShell 5.1 writes backslashes) and the ZIP is the same on every OS.
function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const directories = new Set();
for (const file of RUNTIME_FILES) {
  for (let dir = path.posix.dirname(file); dir !== "."; dir = path.posix.dirname(dir)) {
    directories.add(`${dir}/`);
  }
}
const localParts = [];
const centralParts = [];
let localOffset = 0;
for (const name of [...directories, ...RUNTIME_FILES].sort()) {
  const isDirectory = name.endsWith("/");
  const source = path.join(DIST_DIR, ...name.split("/"));
  const data = isDirectory ? Buffer.alloc(0) : await fs.readFile(source);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const method = deflated.length < data.length ? 8 : 0;
  const stored = method === 8 ? deflated : data;
  const { time, date } = dosDateTime((await fs.stat(source)).mtime);
  const nameBytes = Buffer.from(name, "utf8");
  const fields = [20, 0, method, time, date];

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  fields.forEach((value, index) => local.writeUInt16LE(value, 4 + index * 2));
  local.writeUInt32LE(zlib.crc32(data), 14);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  localParts.push(local, nameBytes, stored);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  fields.forEach((value, index) => central.writeUInt16LE(value, 6 + index * 2));
  central.writeUInt32LE(zlib.crc32(data), 16);
  central.writeUInt32LE(stored.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(isDirectory ? 0x10 : 0, 38);
  central.writeUInt32LE(localOffset, 42);
  centralParts.push(central, nameBytes);
  localOffset += local.length + nameBytes.length + stored.length;
}
const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centralParts.length / 2, 8);
end.writeUInt16LE(centralParts.length / 2, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(localOffset, 16);
await fs.writeFile(zipPath, Buffer.concat([...localParts, centralDirectory, end]));

const bytes = await fs.readFile(zipPath);
assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK", "release is not a ZIP file");

const entries = [];
for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
  if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
  const nameLength = bytes.readUInt16LE(offset + 28);
  const extraLength = bytes.readUInt16LE(offset + 30);
  const commentLength = bytes.readUInt16LE(offset + 32);
  const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
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
