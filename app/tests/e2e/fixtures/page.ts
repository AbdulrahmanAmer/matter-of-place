import { expect, type Page } from "@playwright/test";

export type Collected = {
  consoleErrors: string[];
  pageErrors: string[];
  /** Same-origin responses with status 400 or higher: `<status> <url>`. */
  failedResponses: string[];
};

const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

/**
 * Starts listening for console errors, uncaught page errors and failed same-origin responses, and, unless the run
 * targets a deployed URL, answers the external font requests with an empty body so runs are deterministic and offline
 * (invariant 5). Call it before `page.goto`.
 */
export async function collect(page: Page): Promise<Collected> {
  const collected: Collected = { consoleErrors: [], pageErrors: [], failedResponses: [] };
  const origin = new URL(process.env["E2E_BASE_URL"] ?? "http://127.0.0.1").origin;
  // The status of the page itself is asserted by the sweep (the 404 route answers 404 on purpose), so the
  // document's own response and the console line the browser writes for it are not failures here.
  const documents = new Set<string>();
  page.on("console", (message) => {
    const ownLoad =
      documents.has(message.location().url) && message.text().startsWith("Failed to load resource");
    if (message.type() === "error" && !ownLoad) collected.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    collected.pageErrors.push(error.message);
  });
  page.on("response", (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documents.add(response.url());
      return;
    }
    if (response.status() >= 400 && new URL(response.url()).origin === origin) {
      collected.failedResponses.push(`${response.status().toString()} ${response.url()}`);
    }
  });
  if (process.env["E2E_TARGET"] !== "url") {
    await page.route(FONT_HOSTS, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
  }
  return collected;
}

/**
 * No horizontal scroll, and no element wider than the viewport outside a horizontally scrolling ancestor.
 * Measured after the entrance animations end: the home hero photograph arrives through `heroReveal`
 * (`transform: scale(1.015)` for 0.7 s), so on a fast runner the check used to land inside that window and
 * report `img.hero-image` as wider than the viewport (PRs 138, 150, 155, 158; P-531).
 */
export async function expectNoOverflow(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const measured = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (element.getBoundingClientRect().width <= viewport) continue;
      let scrolls = false;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor === document.body) break;
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") scrolls = true;
      }
      if (!scrolls) {
        offenders.push(`${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`);
      }
    }
    return { viewport, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
  expect(measured.scrollWidth, "document scroll width against the viewport").toBeLessThanOrEqual(
    measured.viewport,
  );
  expect(measured.offenders, "elements wider than the viewport").toEqual([]);
}
