const http = require("http");
const fs = require("fs");
const path = require("path");
const root = __dirname;
http.createServer((q, s) => {
  const rel = q.url === "/" ? "icon-proposals.html" : q.url.replace(/^\//, "");
  const file = path.join(root, rel);
  fs.readFile(file, (e, d) => {
    if (e) { s.statusCode = 404; s.end("not found"); return; }
    s.setHeader("content-type", rel.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
    s.end(d);
  });
}).listen(8734, "127.0.0.1", () => console.log("serving on 8734"));
