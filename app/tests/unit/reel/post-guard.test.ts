// W8 item 1, fresh Opus review of 2026-10-19: a still post's page is written by a model, so while the engine shoots it
// (`still.mjs --frames`) it reaches only a post's own files (launch/engine/post-guard.mjs): never the repository's
// .env, another file of the checkout or another host.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { afterAll, describe, expect, it } from "vitest";
import { CHROME_ARGS, findChrome } from "../../../../launch/engine/chrome.mjs";
import {
  guardPost,
  POST_CHROME_ARGS,
  postPathAllowed,
  postRequestAllowed,
} from "../../../../launch/engine/post-guard.mjs";
import { ROOT, serve } from "../../../../launch/engine/serve.mjs";

const ORIGIN = "http://127.0.0.1:4000";
const FOLDER = `guard-test-${String(process.pid)}`;
const PAGE = join(ROOT, "app", ".tmp", "post", FOLDER);

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
  });

  // The server here serves the whole repository, as it did before the guard, so this case measures the interception.
  it("is refused the repository's .env, any other file of the checkout and any other host, and served its brand files", async () => {
    mkdirSync(PAGE, { recursive: true });
    writeFileSync(join(PAGE, "page.html"), HTML);
    const server = await serve();
    const browser = await puppeteer.launch({
      executablePath: process.env["CHROME_PATH"] ?? findChrome(),
      headless: true,
      args: [...CHROME_ARGS, ...POST_CHROME_ARGS],
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
});
