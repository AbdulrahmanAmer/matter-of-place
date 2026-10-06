import { expect, test } from "@playwright/test";
import { z } from "zod";
import { CONSENT_VERSION } from "../../src/lib/consent";
import { t } from "../../src/lib/strings";
import { checkpoint } from "./fixtures/a11y";
import { adminClient, confirmIn, meStatus, signInAs, tokenHashFor } from "./helpers/session";

// B7 step 2. API-01: a sign-in link works when it is opened in another browser than the one that asked for it,
// for a magic link and for an invite, and ends on `/admin`. FE-02: the sign-in screen carries no public chrome,
// no consent notice and no analytics. Runs against mop-dev before the launch switch (ruling H35).

const MANAGING_EDITOR = "staff+managing@matterofplace.com";
const GOOGLE = /(^|\.)googletagmanager\.com$/;
const meSchema = z.object({ kind: z.string(), roles: z.array(z.string()) });

test("a magic link opened in a new browser context signs the managing editor in and ends on /admin", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  expect(new URL(page.url()).pathname).toBe("/admin");
  const me = meSchema.parse(
    await page.evaluate(async () => {
      const response = await fetch("/api/admin/me");
      return response.json() as Promise<unknown>;
    }),
  );
  expect(me).toEqual({ kind: "human", roles: ["managing_editor"] });
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === "mop_csrf")?.httpOnly).toBe(false);
  expect(cookies.find((cookie) => cookie.name.endsWith("-auth-token"))?.httpOnly).toBe(true);
  await context.close();
});

test("an invite link opened in a new browser context signs the invited person in and ends on /admin", async ({
  browser,
}) => {
  const email = `invite+${Date.now().toString()}@matterofplace.invalid`;
  const { tokenHash, userId } = await tokenHashFor(email, "invite");
  const db = adminClient();
  try {
    const granted = await db
      .from("user_roles")
      .insert({ user_id: userId, role: "visual_editor", display_name: "Invite e2e" });
    expect(granted.error).toBeNull();
    const { context, page } = await confirmIn(browser, tokenHash, "invite");
    expect(new URL(page.url()).pathname).toBe("/admin");
    expect(await meStatus(page)).toBe(200);
    await context.close();
  } finally {
    await db.auth.admin.deleteUser(userId);
  }
});

test("the confirm page spends nothing until the button is pressed", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" || request.url().includes("/auth/v1/"))
      posts.push(request.url());
  });
  await page.goto("/admin/auth/confirm?token_hash=unused&type=email");
  await expect(page.getByRole("button", { name: "Continue to Matter of Place" })).toBeVisible();
  await checkpoint(page, "/admin/auth/confirm");
  expect(posts).toEqual([]);
});

test("the sign-in screen has no public header, no cookie notice and no Google request with consent granted", async ({
  page,
}) => {
  await page.addInitScript((version) => {
    localStorage.setItem("mop_consent", JSON.stringify({ version, analytics: true }));
  }, CONSENT_VERSION);
  const google: string[] = [];
  page.on("request", (request) => {
    if (GOOGLE.test(new URL(request.url()).hostname)) google.push(request.url());
  });
  await page.goto("/admin/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await checkpoint(page, "/admin/sign-in");
  await page.waitForLoadState("networkidle");
  expect(await page.locator(".site-header").count()).toBe(0);
  expect(await page.getByRole("region", { name: t.consent.label }).count()).toBe(0);
  expect(google).toEqual([]);
});
