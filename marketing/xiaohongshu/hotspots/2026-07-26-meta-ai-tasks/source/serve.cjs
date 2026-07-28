const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const port = 8137;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8"
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const target = path.resolve(root, `.${pathname}`);

  if (!target.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}).listen(port, "127.0.0.1");
