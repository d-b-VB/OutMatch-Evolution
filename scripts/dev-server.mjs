import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.env.SERVE_ROOT ? join(process.cwd(), process.env.SERVE_ROOT) : process.cwd();
const basePath = `/${(process.env.BASE_PATH ?? "").replace(/^\/+|\/+$/g, "")}`.replace(/\/$/, "");
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const mountedPath = basePath ? pathname.slice(basePath.length) || "/" : pathname;
  const relative = normalize(mountedPath === "/" ? "index.html" : mountedPath.slice(1));
  const file = join(root, relative.startsWith("..") ? "index.html" : relative);
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end("Not found"); return; }
  response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(response);
}).listen(port, () => process.stdout.write(`OutMatch Lab: http://localhost:${port}${basePath || "/"}\n`));
