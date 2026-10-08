import { expect, test, type Page } from "@playwright/test";
import { runAxe, settleAnimations } from "./fixtures/a11y";

// Ruling H72: the axe audit waits for the page's animations to end. A dialog that fades in is scanned on a
// half-faded ground otherwise (contrast 1.01 on CI's slower runner). These cases need no server route and no
// account: they set their own page, so they run in every e2e job.

const FADE_MS = 2500;

/** A page with one panel that fades from opacity 0, Obsidian text and a button on Warm Ivory (a passing pair). */
function fixture(animation: string): string {
  return `<!doctype html><html lang="en"><head><title>Fixture</title><style>
    body { margin: 0; background: #f5f2eb; color: #11110f; font: 16px sans-serif; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .panel { padding: 24px; background: #f5f2eb; ${animation} }
    button { background: #11110f; color: #f5f2eb; border: 1px solid #11110f; padding: 8px 16px; }
  </style></head><body><main><h1>Fixture</h1>
    <div class="panel" role="dialog" aria-label="Approve"><p>Approve this request.</p><button type="button">Approve</button></div>
  </main></body></html>`;
}

const opacityOfPanel = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel");
    return panel === null ? "missing" : getComputedStyle(panel).opacity;
  });

test.describe("a11y-settle: the audit waits for animations to end (ruling H72)", () => {
  test("a11y-settle: a panel that fades in is scanned after the fade", async ({ page }) => {
    await page.setContent(fixture(`animation: fade ${FADE_MS.toString()}ms linear both;`));
    expect(Number(await opacityOfPanel(page))).toBeLessThan(0.5);
    await runAxe(page, "a11y-settle fixture");
    expect(await opacityOfPanel(page)).toBe("1");
  });

  test("a11y-settle: an animation that loops for ever is not waited for", async ({ page }) => {
    await page.setContent(fixture("animation: fade 400ms linear infinite alternate both;"));
    const started = Date.now();
    expect(await settleAnimations(page, 4000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("a11y-settle: an animation longer than the cap is reported, not hidden", async ({
    page,
  }) => {
    await page.setContent(fixture("animation: fade 60s linear both;"));
    expect(await settleAnimations(page, 300)).toBe(false);
  });
});
