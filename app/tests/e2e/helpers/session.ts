// Staff sign-in for the admin specs (API-01): the `hashed_token` of `auth.admin.generateLink`, opened on the
// confirm page in a new browser context, so no mail is sent and the link is never spent by the context that
// asked for it. It reads the dev profile's own names (`DEV_SUPABASE_PROJECT_REF`, `DEV_SUPABASE_SERVICE_ROLE_KEY`)
// and never `SUPABASE_URL`: on the operator's laptop that name is set at the Windows user level for another
// business's project, and a client built from it created this spec's test accounts there on 2026-10-06 (P-331,
// G-901). CI's e2e job has no project ref; its ephemeral `supabase start` stack exports `SUPABASE_URL` and
// `SUPABASE_SERVICE_ROLE_KEY`, and ci.yml's admin step says so explicitly with `E2E_STACK=1` (P-2010).
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/db";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`e2e session: ${name} is not set`);
  return value;
}

/** The service-role client of the project the Worker under test reads. */
export function adminClient() {
  const [url, key] =
    process.env["E2E_STACK"] === "1"
      ? [requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY")]
      : [
          `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
          requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
        ];
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * `GET me` from inside the page. Playwright's own request context does not send a `Secure` cookie over
 * `http://127.0.0.1`, which the browser does, so a check that the session holds runs in the page.
 */
export function meStatus(page: Page): Promise<number> {
  return page.evaluate(async () => (await fetch("/api/admin/me")).status);
}

export type LinkType = "magiclink" | "invite";

/** The token hash a mailed link would carry, and the user it signs in; `invite` also creates the user. */
export async function tokenHashFor(
  email: string,
  type: LinkType,
): Promise<{ tokenHash: string; userId: string }> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type, email });
  if (error !== null) throw new Error(`generateLink ${type} failed: ${error.message}`);
  return { tokenHash: data.properties.hashed_token, userId: data.user.id };
}

/**
 * Opens the confirm page for `tokenHash` in a fresh context, presses the button, and waits for `/admin` and for
 * the layout guard's `GET me` to answer 200.
 */
export async function confirmIn(
  browser: Browser,
  tokenHash: string,
  type: LinkType,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const otpType = type === "invite" ? "invite" : "email";
  await page.goto(
    `/admin/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${otpType}`,
  );
  const guard = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/admin/me" && response.status() === 200,
  );
  await page.getByRole("button", { name: "Continue to Matter of Place" }).click();
  await page.waitForURL((url) => url.pathname === "/admin");
  await guard;
  return { context, page };
}

/** Signs `email` in through a magic-link token hash, the way every admin spec starts. */
export async function signInAs(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const { tokenHash } = await tokenHashFor(email, "magiclink");
  const signedIn = await confirmIn(browser, tokenHash, "magiclink");
  expect(await meStatus(signedIn.page)).toBe(200);
  return signedIn;
}
