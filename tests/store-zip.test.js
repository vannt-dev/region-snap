const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const TEXT_FILE = /\.(?:css|html|js|json)$/;

function run(script) {
  const result = spawnSync(process.execPath, [script], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);
}

function readCentralDirectory(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "ZIP has no end of central directory record");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, "bad central directory entry");
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    entries.push({
      name: bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      method: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      localOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(bytes, entry) {
  const start =
    entry.localOffset +
    30 +
    bytes.readUInt16LE(entry.localOffset + 26) +
    bytes.readUInt16LE(entry.localOffset + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  assert.equal(entry.method, 8, `${entry.name} uses an unknown compression method`);
  return zlib.inflateRawSync(data);
}

test("store ZIP uses forward-slash entry names and LF text on every platform", async () => {
  run("scripts/build.mjs");
  run("scripts/package-store.mjs");

  const { RELEASE_DIR, RUNTIME_FILES } = await import("../scripts/project-config.mjs");
  const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  const suffix = `-v${version}-store.zip`;
  const zips = fs.readdirSync(RELEASE_DIR).filter((name) => name.endsWith(suffix));
  assert.equal(zips.length, 1, `expected one store ZIP, found: ${zips.join(", ")}`);
  const bytes = fs.readFileSync(path.join(RELEASE_DIR, zips[0]));
  const entries = readCentralDirectory(bytes);

  const backslashed = entries.map((entry) => entry.name).filter((name) => name.includes("\\"));
  assert.deepEqual(backslashed, [], "ZIP entry names must use forward slashes");

  const files = entries.filter((entry) => !entry.name.endsWith("/"));
  assert.deepEqual(files.map((entry) => entry.name).sort(), [...RUNTIME_FILES].sort());

  const crlf = files
    .filter((entry) => TEXT_FILE.test(entry.name))
    .filter((entry) => readEntry(bytes, entry).includes("\r\n"))
    .map((entry) => entry.name);
  assert.deepEqual(crlf, [], "text files in the ZIP must use LF line endings");
});
