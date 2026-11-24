import fs from "node:fs/promises";
import path from "node:path";
import { DIST_DIR, ROOT, RUNTIME_FILES, VENDOR_FILES } from "./project-config.mjs";
import { findRemoteCode, stripRemoteCode } from "./remote-code.mjs";

// A Windows checkout with core.autocrlf has CRLF text files; copy them as LF so dist/ (and the
// store ZIP) match the git blobs and a Linux build byte for byte.
const TEXT_FILE = /\.(?:css|html|js|json)$/;

await fs.rm(DIST_DIR, { recursive: true, force: true });

const offenders = [];
for (const relativePath of RUNTIME_FILES) {
  const vendor = VENDOR_FILES[relativePath];
  const source = path.join(ROOT, vendor ? vendor.from : relativePath);
  const destination = path.join(DIST_DIR, relativePath);
  try {
    await fs.access(source);
  } catch {
    throw new Error(
      vendor
        ? `${vendor.from} is missing: run "npm ci" (text recognition must not fall back to a CDN).`
        : `${relativePath} is missing.`,
    );
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (TEXT_FILE.test(relativePath)) {
    let text = (await fs.readFile(source, "utf8")).replaceAll("\r\n", "\n");
    if (vendor?.strip) text = stripRemoteCode(text);
    const found = findRemoteCode(text);
    if (found.length) offenders.push(`${relativePath}: ${[...new Set(found)].join(", ")}`);
    await fs.writeFile(destination, text);
  } else {
    await fs.copyFile(source, destination);
  }
}

if (offenders.length) {
  throw new Error(`Remotely hosted code would ship in the package:\n  ${offenders.join("\n  ")}`);
}

console.log(`Built ${RUNTIME_FILES.length} runtime files in dist/.`);
