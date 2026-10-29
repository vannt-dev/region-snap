import fs from "node:fs/promises";
import path from "node:path";
import { DIST_DIR, ROOT, RUNTIME_FILES } from "./project-config.mjs";

// A Windows checkout with core.autocrlf has CRLF text files; copy them as LF so dist/ (and the
// store ZIP) match the git blobs and a Linux build byte for byte.
const TEXT_FILE = /\.(?:css|html|js|json)$/;

await fs.rm(DIST_DIR, { recursive: true, force: true });

for (const relativePath of RUNTIME_FILES) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(DIST_DIR, relativePath);
  await fs.access(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (TEXT_FILE.test(relativePath)) {
    const text = await fs.readFile(source, "utf8");
    await fs.writeFile(destination, text.replaceAll("\r\n", "\n"));
  } else {
    await fs.copyFile(source, destination);
  }
}

console.log(`Built ${RUNTIME_FILES.length} runtime files in dist/.`);
