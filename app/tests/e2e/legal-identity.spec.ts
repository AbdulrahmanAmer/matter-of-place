import { expect, test } from "@playwright/test";

// Ruling H83 on the built Worker: with the settings rows empty (the local build reads none) the footer of every page
// and the legal pages still name Omnikom LLC and its Sheridan address, because the code carries both.

const pages = ["/", "/terms", "/privacy", "/legal", "/cookies"];

test.skip(
  process.env["E2E_MODE"] === "live",
  "the live build prints what settings.site holds, which an admin may have changed",
);

for (const path of pages) {
  test(`legal-identity: ${path} names Omnikom LLC and its Sheridan address`, async ({ page }) => {
    await page.goto(path);
    // textContent, not innerText: the footer's legal line is set in capitals by CSS.
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).toContain("Omnikom LLC");
    expect(text).toContain("30 N Gould St Ste R, Sheridan, WY 82801, USA");
  });
}
