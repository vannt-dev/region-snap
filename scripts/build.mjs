import fs from "node:fs/promises";
import path from "node:path";
import { DIST_DIR, ROOT, RUNTIME_FILES } from "./project-config.mjs";

await fs.rm(DIST_DIR, { recursive: true, force: true });

for (const relativePath of RUNTIME_FILES) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(DIST_DIR, relativePath);
  await fs.access(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

console.log(`Built ${RUNTIME_FILES.length} runtime files in dist/.`);
