// The build board's web server (rebuilt 2026-10-11). Reading the plans, the ledger and the run journals is slow and
// synchronous, so it happens in a worker thread every 20 seconds; the server never reads a file on a request and
// answers every page from the last finished reading. Started by `node workspace/05-plans/board.mjs [--port N]
// [--snapshot <file>]`; the default port is 8790.
//
//   GET /            the board (rendered once per version)
//   GET /version     the version string the page polls every 15 s to reload itself
//   GET /data.json   the reading as JSON
//   GET /fonts/...   the two brand fonts
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const FONTS = {
  "/fonts/jost.woff2": "brand/typography/jost/jost-variable.woff2",
  "/fonts/cormorant.woff2": "brand/typography/cormorant-garamond/cormorant-garamond-variable.woff2",
};
const REFRESH_MS = 20_000;

// Worker side: one reading per request from the main thread.
if (!isMainThread && parentPort) {
  const { collect, versionOf } = await import("./board.mjs");
  parentPort.on("message", () => {
    try {
      const data = collect();
      parentPort?.postMessage({ data, version: versionOf(data) });
    } catch (error) {
      parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * @param {{ port?: number, snapshot?: string }} options
 */
export async function serve({ port = 8790, snapshot } = {}) {
  const { render } = await import("./board.mjs");
  /** @type {{ data: any, version: string } | null} */
  let reading = null;
  let page = { version: "", html: "" };
  let lastError = "";
  let busy = false;
  let snapshotVersion = snapshot && existsSync(`${snapshot}.version`) ? readFileSync(`${snapshot}.version`, "utf8") : "";

  const worker = new Worker(fileURLToPath(import.meta.url));
  worker.on("message", (message) => {
    busy = false;
    if (message.error) {
      lastError = message.error;
      console.error(`board: reading failed, the last good one is kept: ${message.error}`);
      return;
    }
    lastError = "";
    const changed = !reading || reading.version !== message.version;
    reading = message;
    if (!changed) return;
    page = { version: message.version, html: render(message.data, message.version) };
    console.log(`board: ${String(message.data.overall.launchPercent)}% to launch, ${String(message.data.overall.percent)}% overall (version ${message.version})`);
    if (snapshot && message.version !== snapshotVersion) {
      try {
        writeFileSync(snapshot, render(message.data, message.version, true));
        writeFileSync(`${snapshot}.version`, message.version);
        snapshotVersion = message.version;
        console.log(`board: snapshot written to ${snapshot}`);
      } catch (error) {
        console.error(`board: snapshot not written: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  worker.on("error", (error) => {
    busy = false;
    lastError = error.message;
    console.error(`board: the reading worker failed: ${error.message}`);
  });
  const read = () => {
    if (busy) return;
    busy = true;
    worker.postMessage("read");
  };
  read();
  setInterval(read, REFRESH_MS);

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path in FONTS) {
      try {
        response.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "max-age=86400" });
        response.end(readFileSync(join(ROOT, FONTS[/** @type {keyof typeof FONTS} */ (path)])));
      } catch {
        response.writeHead(404).end();
      }
      return;
    }
    if (!reading) {
      response.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3", "Cache-Control": "no-store" });
      response.end(
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Build board</title><body style="font:16px system-ui;padding:24px;background:#F5F2EB;color:#11110F">Reading the plans. This page refreshes in a moment.${lastError ? `<p>Last error: ${lastError.replace(/</g, "&lt;")}</p>` : ""}</body>`,
      );
      return;
    }
    if (path === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(page.html);
    } else if (path === "/version") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end(reading.version);
    } else if (path === "/data.json") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(reading.data, null, 1));
    } else {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  server.on("error", (error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "EADDRINUSE") {
      console.error(`board: port ${String(port)} is already in use by another program; stop it or pass --port <other>`);
    } else {
      console.error(`board: server error: ${error.message}`);
    }
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`board: http://localhost:${String(port)}/`);
  });
}
