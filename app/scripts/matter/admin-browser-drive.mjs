// The browser half of admin-browser.ts, run under node (ruling H151). It reads one JSON line on stdin, drives Chrome
// with Matter's own persistent profile, and writes one JSON line on stdout. Given a confirm address it presses the
// confirm page's one button, as a person does with a mailed link; then it opens /admin, asks `me` who the session is,
// and refuses to go on unless the server answers that it is an agent. The confirm address holds a one-time token: it
// is never printed, and an error that would carry it is replaced by a plain line. Exit 0 read, 3 signed out, 1 failed.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import puppeteer from "puppeteer-core";
import { z } from "zod";
import { chromePath } from "../lib/chrome-path.mjs";

const STEP_MS = 30_000;
const NAVIGATION_MS = 45_000;
const IDLE_MS = 15_000;
const SIGNED_OUT = 3;
// Inside the 150 s the caller allows (admin-browser.ts DRIVER_MS).
const WATCHDOG_MS = 130_000;

const inputSchema = z.object({
  site: z.literal("https://matterofplace.com"),
  profile: z.string().min(1),
  path: z.string().regex(/^\/admin(?:[/?#]|$)/),
  shot: z.string().nullable(),
  text: z.boolean(),
  headed: z.boolean(),
  link: z.string().startsWith("https://matterofplace.com/admin/auth/confirm?").nullable(),
});
const answerSchema = z.object({ status: z.number(), body: z.unknown() });
const meSchema = z.object({
  kind: z.string(),
  roles: z.array(z.string()),
  scopes: z.array(z.string()),
});

/** @param {Record<string, unknown>} result */
function answer(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/** @returns {Promise<string>} the whole of stdin */
async function readStdin() {
  process.stdin.setEncoding("utf8");
  let text = "";
  // With an encoding set, each chunk is a string; stdin's iterator is typed `any`, so it is read through String().
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

/**
 * @param {import("puppeteer-core").Page} page
 * @param {string} url
 */
async function open(page, url) {
  await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_MS });
  // The admin keeps polling (presence, the Office): a quiet spell is enough, never a wait for silence.
  await page.waitForNetworkIdle({ idleTime: 800, timeout: IDLE_MS }).catch(() => undefined);
}

/** @param {import("puppeteer-core").Page} page */
const onSignIn = (page) => new URL(page.url()).pathname.startsWith("/admin/sign-in");

/**
 * Spends the token on the confirm page; any failure is reported without the address.
 * @param {import("puppeteer-core").Page} page
 * @param {string} link
 */
async function spendToken(page, link) {
  const button = 'form[action="/api/admin/auth/verify"] button[type="submit"]';
  try {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: NAVIGATION_MS });
    await page.waitForSelector(button, { timeout: STEP_MS });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: NAVIGATION_MS }),
      page.click(button),
    ]);
  } catch {
    throw new Error("The confirm page did not finish the sign-in.");
  }
}

async function main() {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(await readStdin());
  } catch {
    // A JSON error quotes the text it read, and that text holds the confirm address.
    throw new Error("The browser was given no readable instructions.");
  }
  const input = inputSchema.parse(raw);
  if (input.shot !== null) await mkdir(dirname(input.shot), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    userDataDir: input.profile,
    headless: !input.headed,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu"],
    timeout: STEP_MS,
    protocolTimeout: NAVIGATION_MS,
  });
  // The caller stops this process after its own deadline, which would leave Chrome holding the profile: end both first.
  const watchdog = setTimeout(() => {
    browser.process()?.kill();
    answer({ signedIn: false, refused: "The browser did not finish in time." });
    process.exit(1);
  }, WATCHDOG_MS);
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    page.setDefaultTimeout(STEP_MS);
    if (input.link !== null) await spendToken(page, input.link);
    await open(page, `${input.site}/admin`);
    if (onSignIn(page)) {
      answer({ signedIn: false, refused: "The profile holds no admin session." });
      return SIGNED_OUT;
    }
    // A string, not a function: the scripts' types carry no DOM library (P-1218).
    const asked = answerSchema.safeParse(
      await page.evaluate(
        `fetch("/api/admin/me", { credentials: "same-origin" }).then(async (r) => ({ status: r.status, body: r.ok ? await r.json() : null }))`,
      ),
    );
    const me = meSchema.safeParse(asked.success ? asked.data.body : null);
    if (!me.success || me.data.kind !== "agent") {
      // A server without H151 would take this session for a person's: drop it rather than act as one. A session past
      // its 12 hours answers 401: dropped too, and the caller signs in afresh.
      const session = await page.createCDPSession();
      await session.send("Network.clearBrowserCookies");
      if (asked.success && asked.data.status === 401) {
        answer({ signedIn: false, refused: "The admin session had ended." });
        return SIGNED_OUT;
      }
      answer({
        signedIn: false,
        refused:
          "The admin did not answer that this session is an agent's; its cookies were cleared.",
      });
      return 1;
    }
    if (input.path !== "/admin") await open(page, `${input.site}${input.path}`);
    if (onSignIn(page)) {
      answer({ signedIn: false, refused: `The admin sent ${input.path} back to sign-in.` });
      return 1;
    }
    if (input.shot !== null)
      await page.screenshot({ path: /** @type {`${string}.png`} */ (input.shot) });
    const text = input.text ? String(await page.evaluate("document.body.innerText")) : undefined;
    answer({
      signedIn: true,
      kind: me.data.kind,
      roles: me.data.roles,
      scopes: me.data.scopes,
      path: new URL(page.url()).pathname,
      title: await page.title(),
      ...(input.shot === null ? {} : { shot: input.shot }),
      ...(text === undefined ? {} : { text }),
    });
    return 0;
  } finally {
    clearTimeout(watchdog);
    await browser.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  // Messages here are this file's own or Chrome's launch errors; neither holds the confirm address.
  answer({
    signedIn: false,
    refused: error instanceof Error ? error.message : "The browser failed.",
  });
  process.exitCode = 1;
}
