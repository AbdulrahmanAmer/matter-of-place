// W8 item 1, fresh Opus review of 2026-10-19: a still post's page is written by a model, so while the engine shoots it
// (`still.mjs --frames`) it reaches only a post's own files (launch/engine/post-guard.mjs): never the repository's
// .env, another file of the checkout or another host.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CHROME_ARGS, findChrome } from "../../../../launch/engine/chrome.mjs";
import {
  guardPost,
  postChromeArgs,
  postPathAllowed,
  postRequestAllowed,
} from "../../../../launch/engine/post-guard.mjs";
import { ROOT, serve } from "../../../../launch/engine/serve.mjs";

const ORIGIN = "http://127.0.0.1:4000";
const FOLDER = `guard-test-${String(process.pid)}`;
const PAGE = join(ROOT, "app", ".tmp", "post", FOLDER);
// a page the engine must refuse to open: under the repository, outside app/.tmp/post/
const OUTSIDE = join(ROOT, "app", ".tmp", `post-guard-outside-${String(process.pid)}`);
const STILL = join(ROOT, "launch", "engine", "still.mjs");

/** Another service of this machine: it counts the connections that reach it and closes each at once. */
async function localService() {
  let reached = 0;
  const server = createServer((socket) => {
    reached += 1;
    socket.destroy();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    reached: () => reached,
    close: () => new Promise((done) => server.close(done)),
  };
}

// The page opens a WebSocket to each address and keeps "open" or "refused".
const sockets = (port: number) => `
const sockets = ["ws://127.0.0.1:${String(port)}/", "ws://localhost:${String(port)}/"].map((url) =>
  new Promise((done) => {
    const socket = new WebSocket(url);
    socket.onopen = () => done("open");
    socket.onerror = () => done("refused");
  }),
);`;

/** Runs `still.mjs --frames` on a page, as the post runner does (brand-post.ts), and keeps its exit and stderr. */
function shoot(dir: string, page: string) {
  mkdirSync(dir, { recursive: true });
  const frames = join(dir, "frames.json");
  writeFileSync(
    frames,
    JSON.stringify({
      page,
      out: join(dir, "out"),
      report: join(dir, "report.json"),
      frames: [{ name: "slide-0", width: 320, height: 400 }],
    }),
  );
  // spawn, not spawnSync: the local service of the same process must keep answering while Chrome runs
  return new Promise<{ status: number | null; stderr: string }>((done) => {
    const child = spawn(process.execPath, [STILL, "--frames", frames], {
      cwd: ROOT,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      done({ status, stderr });
    });
  });
}

// The page asks for each and keeps the answer: a status, or "refused" when the request never got one.
const HTML = `<!doctype html><html><body><script>
const tries = {
  env: "/.env",
  checkout: "/app/package.json",
  climb: "/app/.tmp/post/..%2f..%2f..%2fapp%2fpackage.json",
  outside: "https://example.com/",
  brand: "/brand/logo/emblem/emblem-bone.svg",
};
window.__post = {
  ready: Promise.all(
    Object.entries(tries).map(([name, url]) =>
      fetch(url).then((answer) => [name, answer.status], () => [name, "refused"]),
    ),
  ).then((all) => { window.__results = Object.fromEntries(all); }),
};
</script></body></html>`;

describe("what a post's page may load", () => {
  it("allows its own folder, the brand, the fonts and Three.js on the engine's server, and nothing else", () => {
    expect(
      [
        `${ORIGIN}/app/.tmp/post/post/post.html?frame=slide-0`,
        `${ORIGIN}/brand/logo/emblem/emblem-bone.svg`,
        `${ORIGIN}/app/public/fonts/jost.woff2`,
        `${ORIGIN}/launch/node_modules/three/build/three.module.js`,
        "data:image/png;base64,AA==",
      ].map((url) => postRequestAllowed(url, ORIGIN)),
    ).toEqual([true, true, true, true, true]);
    expect(
      [
        `${ORIGIN}/.env`,
        `${ORIGIN}/app/package.json`,
        `${ORIGIN}/app/.tmp/post/..%2f..%2f..%2f.env`,
        `${ORIGIN}/app/.tmp/post/..%5c..%5c..%5c.env`,
        `${ORIGIN}/brandx/a.svg`,
        "http://127.0.0.1:4001/brand/a.svg",
        "https://example.com/brand/a.svg",
        "not a url",
      ].map((url) => postRequestAllowed(url, ORIGIN)),
    ).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("is all the engine's server serves when given the guard", async () => {
    const server = await serve({ allow: postPathAllowed });
    try {
      // node:http, since the unit project's fetch refuses the network (the server is this machine's own)
      const status = (path: string) =>
        new Promise<number | undefined>((done, fail) => {
          get(`${server.url}${path}`, (answer) => {
            answer.resume();
            done(answer.statusCode);
          }).on("error", fail);
        });
      expect([
        await status("/brand/logo/emblem/emblem-bone.svg"),
        await status("/.env"),
        await status("/app/package.json"),
        await status("/app/.tmp/post/..%2f..%2f..%2fapp%2fpackage.json"),
        await status("/app/.tmp/post/..%5c..%5c..%5capp%5cpackage.json"),
      ]).toEqual([200, 403, 403, 403, 403]);
    } finally {
      await server.close();
    }
  });
});

describe("a post's page in Chrome", () => {
  afterAll(() => {
    rmSync(PAGE, { recursive: true, force: true });
    rmSync(OUTSIDE, { recursive: true, force: true });
  });

  // The server here serves the whole repository, as it did before the guard, so this case measures the interception.
  it("is refused the repository's .env, any other file of the checkout and any other host, and served its brand files", async () => {
    mkdirSync(PAGE, { recursive: true });
    writeFileSync(join(PAGE, "page.html"), HTML);
    const server = await serve();
    const browser = await puppeteer.launch({
      executablePath: process.env["CHROME_PATH"] ?? findChrome(),
      headless: true,
      args: [...CHROME_ARGS, ...postChromeArgs(server.url)],
    });
    try {
      const page = await browser.newPage();
      await guardPost(page, server.url);
      await page.goto(`${server.url}/app/.tmp/post/${FOLDER}/page.html`, { waitUntil: "load" });
      await page.evaluate("window.__post.ready");
      expect(await page.evaluate("window.__results")).toEqual({
        env: "refused",
        checkout: "refused",
        climb: "refused",
        outside: "refused",
        brand: 200,
      });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60_000);

  // The interception never sees a WebSocket, and Chrome sends loopback past a proxy unless told otherwise.
  it("cannot open a WebSocket to another service of this machine", async () => {
    const service = await localService();
    mkdirSync(PAGE, { recursive: true });
    writeFileSync(
      join(PAGE, "sockets.html"),
      `<!doctype html><html><body><script>${sockets(service.port)}
window.__post = { ready: Promise.all(sockets).then((all) => { window.__results = all; }) };
</script></body></html>`,
    );
    const server = await serve({ allow: postPathAllowed });
    const browser = await puppeteer.launch({
      executablePath: process.env["CHROME_PATH"] ?? findChrome(),
      headless: true,
      args: [...CHROME_ARGS, ...postChromeArgs(server.url)],
    });
    try {
      const page = await browser.newPage();
      await guardPost(page, server.url);
      await page.goto(`${server.url}/app/.tmp/post/${FOLDER}/sockets.html`, { waitUntil: "load" });
      await page.evaluate("window.__post.ready");
      expect([await page.evaluate("window.__results"), service.reached()]).toEqual([
        ["refused", "refused"],
        0,
      ]);
    } finally {
      await browser.close();
      await server.close();
      await service.close();
    }
  }, 60_000);
});

// still.mjs --frames is where the sandbox is put together: its page check, its server's guard, its Chrome flags and
// the interception of each frame's page. These cases run it as the post runner does.
describe("the engine shooting a post's page", () => {
  afterAll(() => {
    rmSync(PAGE, { recursive: true, force: true });
    rmSync(OUTSIDE, { recursive: true, force: true });
  });

  it("fails a page that asks for the .env, another file of the checkout, another host or another local service, and names each request", async () => {
    const service = await localService();
    const dir = join(PAGE, "greedy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "post.html"),
      `<!doctype html><html><body><p>A post</p><script>${sockets(service.port)}
const asked = ["/.env", "/app/package.json", "https://example.com/"].map((url) => fetch(url).catch(() => null));
window.__post = { ready: Promise.all([...asked, ...sockets]) };
</script></body></html>`,
    );
    try {
      const { status, stderr } = await shoot(dir, join(dir, "post.html"));
      expect({
        status,
        env: /request failed: http:\/\/127\.0\.0\.1:\d+\/\.env/.test(stderr),
        checkout: /request failed: http:\/\/127\.0\.0\.1:\d+\/app\/package\.json/.test(stderr),
        outside: stderr.includes("request failed: https://example.com/"),
        // the page's interception aborts them, so the server never answers (its 403 is the next lock, not this one)
        served: /HTTP \d+ http:\/\/127\.0\.0\.1:\d+\/(\.env|app\/package\.json)/.test(stderr),
        reached: service.reached(),
      }).toEqual({
        status: 1,
        env: true,
        checkout: true,
        outside: true,
        served: false,
        reached: 0,
      });
    } finally {
      await service.close();
    }
  }, 120_000);

  it("shoots a page that loads only a post's own files, the brand's emblem here", async () => {
    const dir = join(PAGE, "clean");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "post.html"),
      `<!doctype html><html><body style="margin:0;background:#11110f">
<img src="/brand/logo/emblem/emblem-bone.svg" width="120" height="120" alt="">
</body></html>`,
    );
    const { status, stderr } = await shoot(dir, join(dir, "post.html"));
    expect({ status, stderr: status === 0 ? "" : stderr }).toEqual({ status: 0, stderr: "" });
    expect(existsSync(join(dir, "out", "slide-0.png"))).toBe(true);
    expect(
      z.array(z.unknown()).parse(JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))),
    ).toHaveLength(1);
  }, 120_000);

  // A service worker's requests never reach the interception, so here the server and the Chrome flags decide alone.
  it("serves a page's service worker only a post's files, and it reaches no other local service", async () => {
    const service = await localService();
    const dir = join(PAGE, "worker");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sw.js"),
      `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("message", (event) => {
  fetch(event.data).then((answer) => answer.status, () => "refused").then((got) => event.ports[0].postMessage(got));
});`,
    );
    writeFileSync(
      join(dir, "post.html"),
      `<!doctype html><html><body style="margin:0;background:#11110f;color:#eeeae1"><script>
const ask = (worker, url) => new Promise((done) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (message) => done(message.data);
  worker.postMessage(url, [channel.port2]);
});
window.__post = {
  ready: navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((reg) =>
    Promise.all([
      ask(reg.active, location.origin + "/app/package.json"),
      ask(reg.active, "http://127.0.0.1:${String(service.port)}/"),
    ]),
  ).then(([checkout, local]) => {
    document.body.append("checkout " + checkout + ", local " + local);
  }),
};
</script></body></html>`,
    );
    try {
      const { status, stderr } = await shoot(dir, join(dir, "post.html"));
      expect({ status, stderr: status === 0 ? "" : stderr }).toEqual({ status: 0, stderr: "" });
      const [frame] = z
        .array(z.object({ text: z.string() }))
        .parse(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")));
      expect([frame?.text, service.reached()]).toEqual(["checkout 403, local refused", 0]);
    } finally {
      await service.close();
    }
  }, 120_000);

  it("refuses to open a page outside app/.tmp/post/", async () => {
    mkdirSync(OUTSIDE, { recursive: true });
    writeFileSync(
      join(OUTSIDE, "post.html"),
      "<!doctype html><html><body><p>A post</p></body></html>",
    );
    const { status, stderr } = await shoot(OUTSIDE, join(OUTSIDE, "post.html"));
    expect([status, stderr.includes("the page must be under app/.tmp/post/")]).toEqual([1, true]);
  }, 120_000);
});
