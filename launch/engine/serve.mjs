// Tiny static server for scenes. ES modules do not load from file://, so every scene is served over http.
// Root is the workspace folder, so a scene can reference /launch/node_modules/... and the codebase's assets
// (/Matter%20Of%20Place%20Codebase/src/assets/...) by absolute URL.
// CLI: node launch/engine/serve.mjs [port]   ·   API: const { url, close } = await serve({ port })
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".wav": "audio/wav", ".woff2": "font/woff2",
};

export function serve({ port = 0, root = ROOT } = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root))) return res.writeHead(403).end();
    let st;
    try { st = statSync(file); } catch { return res.writeHead(404).end("not found: " + path); }
    if (st.isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "content-length": st.size, "cache-control": "max-age=3600" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    ok({ url, close: () => new Promise((r) => server.close(r)) });
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { url } = await serve({ port: Number(process.argv[2] || 8123) });
  console.log(`serving ${ROOT} at ${url}`);
}
