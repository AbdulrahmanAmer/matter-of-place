import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P-3700: with no Turnstile token the Worker refuses a sign-in write yet answers "sent", so the form must not send it.
const mocks = vi.hoisted((): { token: string | null } => ({ token: null }));
vi.mock("../../src/lib/turnstile", () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve(mocks.token)),
}));

const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(new Response(JSON.stringify({ status: "sent" }), { status: 200 })),
);

beforeEach(() => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.token = null;
});

describe("the admin sign-in requests and Turnstile", () => {
  it("refuses to send the link request without a token, so the page says it did not go through", async () => {
    const { requestSignInLink } = await import("../../src/admin/team/team-api");
    await expect(requestSignInLink("admin@matterofplace.com")).rejects.toThrow("turnstile");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses the password sign-in without a token too", async () => {
    const { signInWithPasswordRequest } = await import("../../src/admin/team/team-api");
    await expect(
      signInWithPasswordRequest({
        email: "admin@matterofplace.com",
        password: "x",
        next: undefined,
      }),
    ).rejects.toThrow("turnstile");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the link request with the token in its header when Cloudflare answered", async () => {
    mocks.token = "token-ok";
    const { requestSignInLink } = await import("../../src/admin/team/team-api");
    await requestSignInLink("admin@matterofplace.com").catch(() => undefined);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("x-turnstile-token")).toBe("token-ok");
  });
});
