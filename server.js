#!/usr/bin/env node
"use strict";

import http from "http";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8780);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".hdr": "application/octet-stream",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".gltf"]);

function getCacheControl(reqPath) {
  if (/^\/(assets|models|pbr|hdr|draco|fx|art)\//.test(reqPath)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

const server = http.createServer((req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (reqPath === "/healthz") {
    const body = '{"status":"ok"}';
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    if (method === "HEAD") return res.end();
    res.end(body);
    return;
  }

  let rel = path.normalize(reqPath === "/" ? "/index.html" : reqPath).replace(/^(\.\.[/\\])+/, "");
  let fullPath = path.join(DIST_DIR, rel);

  if (!fullPath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      fullPath = path.join(DIST_DIR, "index.html");
      fs.stat(fullPath, (idxErr, idxStat) => {
        if (idxErr || !idxStat.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found (run npm run build first)");
          return;
        }
        serveFile(req, res, method, fullPath, "/index.html");
      });
      return;
    }
    serveFile(req, res, method, fullPath, reqPath);
  });
});

function serveFile(req, res, method, fullPath, reqPath) {
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = getCacheControl(reqPath);
  const acceptEnc = String(req.headers["accept-encoding"] || "");
  const shouldGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/i.test(acceptEnc);

  fs.readFile(fullPath, (readErr, raw) => {
    if (readErr) {
      res.writeHead(500);
      res.end("Internal Server Error");
      return;
    }
    const headers = {
      "Content-Type": mime,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    };
    if (shouldGzip) {
      zlib.gzip(raw, (zipErr, zipped) => {
        if (zipErr) {
          res.writeHead(200, { ...headers, "Content-Length": raw.byteLength });
          if (method === "HEAD") return res.end();
          res.end(raw);
          return;
        }
        res.writeHead(200, {
          ...headers,
          "Content-Encoding": "gzip",
          Vary: "Accept-Encoding",
          "Content-Length": zipped.byteLength,
        });
        if (method === "HEAD") return res.end();
        res.end(zipped);
      });
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": raw.byteLength });
    if (method === "HEAD") return res.end();
    res.end(raw);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`REDLINE SYNDICATE server listening at http://${HOST}:${PORT}`);
});
