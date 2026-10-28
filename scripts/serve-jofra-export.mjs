import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.resolve(projectRoot, "out");
const basePath = "/workforce-mvp";
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
  [".webp", "image/webp"],
]);

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
    response.writeHead(404).end();
    return;
  }

  const relativePath = pathname.slice(basePath.length).replace(/^\/+/, "");
  const resolvedPath = path.resolve(outputRoot, relativePath || "index.html");
  const relativeToOutput = path.relative(outputRoot, resolvedPath);
  if (relativeToOutput.startsWith("..") || path.isAbsolute(relativeToOutput)) {
    response.writeHead(404).end();
    return;
  }

  let filePath = resolvedPath;
  try {
    const fileInfo = await stat(filePath);
    if (fileInfo.isDirectory()) filePath = path.join(filePath, "index.html");
    else if (!fileInfo.isFile()) throw new Error("Not a regular file");
  } catch {
    if (pathname.endsWith("/")) filePath = path.join(resolvedPath, "index.html");
  }

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Not a regular file");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": fileInfo.size,
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4173, "127.0.0.1", () => {
  console.log("Jofra static export preview listening on http://127.0.0.1:4173/workforce-mvp/");
});
