import { expect, test } from "@playwright/test";
import { redirects } from "./fixtures/routes";

// B4 step 6: one test per entry of `redirects`; the spec holds no case of its own.
for (const { from, to, status } of redirects) {
  test(`${from} redirects to ${to}`, async ({ request }) => {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status()).toBe(status);
    expect(new URL(response.headers()["location"] ?? "", response.url()).pathname).toBe(to);
  });
}
