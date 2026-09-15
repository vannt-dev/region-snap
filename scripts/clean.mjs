import fs from "node:fs/promises";
import { DIST_DIR, RELEASE_DIR, ROOT } from "./project-config.mjs";

for (const target of [DIST_DIR, RELEASE_DIR]) {
  const relative = target.slice(ROOT.length + 1);
  if (!relative || relative.includes(".."))
    throw new Error(`Refusing to remove unsafe path: ${target}`);
  await fs.rm(target, { recursive: true, force: true });
}

console.log("Removed dist/ and release/.");
