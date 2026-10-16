import { expect, test } from "@playwright/test";

// W6 item 7 (review of 2026-10-16): the client room's two public pages in a real browser, against the stack of the
// admin specs (the sign-in answers through the Worker; the confirm page asks Supabase Auth). A real `account_link` email
// sent, opened and spent is not proven here: that needs the job runner on the cloud project (UNPROVEN, W6.md item 7).

test("the sign-in form answers 'Check your email' for any address, the same words each time", async ({
  page,
}) => {
  const stamp = Date.now().toString();
  const answers: string[] = [];
  for (const email of [
    `nobody+${stamp}@matterofplace.invalid`,
    `someone.else+${stamp}@example.invalid`,
  ]) {
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send me a link" }).click();
    const notice = page.getByText("Check your email");
    await expect(notice).toBeVisible();
    answers.push(
      (await page.getByText("If we hold a request from this address").textContent()) ?? "",
    );
  }
  expect(answers[0]).toContain("a sign-in link is on its way");
  expect(answers[1]).toBe(answers[0]);
});

test("the confirm page shows a clean address after load, and an expired notice after the button", async ({
  page,
}) => {
  await page.goto("/account/confirm#token_hash=not-a-real-token");
  const button = page.getByRole("button", { name: "Sign in" });
  await expect(button).toBeEnabled();
  // the token is out of the address before anything else can read it
  const address = new URL(page.url());
  expect([address.pathname, address.hash, address.search]).toEqual(["/account/confirm", "", ""]);
  await button.click();
  await expect(page).toHaveURL(/\/account\?state=expired$/);
  await expect(page.getByText("That link has expired or was already used.")).toBeVisible();
});
