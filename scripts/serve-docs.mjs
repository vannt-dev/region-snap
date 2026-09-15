import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./project-config.mjs";

const DOCS_DIR = path.join(ROOT, "docs");
const PORT = Number(process.env.PORT) || 8080;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.join(DOCS_DIR, relative);

  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Serving docs/ at http://localhost:${PORT}/`);
});
