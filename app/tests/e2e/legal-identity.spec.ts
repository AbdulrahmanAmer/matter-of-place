import { expect, test } from "@playwright/test";

// Ruling H83 on the built Worker: with the settings rows empty (the local build reads none) every page still names
// Omnikom LLC, and the legal pages still give its Sheridan address, because the code carries both. Ruling H90
// (operator, 2026-10-12): the footer no longer prints the address; the legal pages do, in their own text.

const pages = ["/terms", "/privacy", "/legal", "/cookies"];
const ADDRESS = "30 N Gould St Ste R, Sheridan, WY 82801, USA";

test("legal-identity: the home footer names Omnikom LLC and not the postal address", async ({
  page,
}) => {
  await page.goto("/");
  const footer = (await page.locator("footer").textContent()) ?? "";
  expect([footer.includes("Omnikom LLC"), footer.includes(ADDRESS)]).toEqual([true, false]);
});

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
    expect(text).toContain(ADDRESS);
  });
}
