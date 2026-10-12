import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordWasPwned } from "../../src/server/lib/pwned";

// Gap audit item 12: a new password is checked against Have I Been Pwned's range API by its SHA-1 prefix only.
// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(body: string, status = 200) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: new Headers(init.headers) });
    return Promise.resolve(new Response(body, { status }));
  });
  return calls;
}

describe("passwordWasPwned", () => {
  it("finds a leaked password by its suffix, sending only the five-character prefix with padding", async () => {
    const calls = answer(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:3861493\r\n`);
    expect(await passwordWasPwned("password")).toBe(true);
    expect(calls.map((call) => [call.url, call.headers.get("add-padding")])).toEqual([
      [`https://api.pwnedpasswords.com/range/${PREFIX}`, "true"],
    ]);
  });

  it("passes a password whose suffix is absent, or listed with a padding count of 0", async () => {
    answer(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:0\r\n`);
    expect(await passwordWasPwned("password")).toBe(false);
  });

  it("passes when the service answers an error or cannot be reached", async () => {
    answer("", 503);
    const down = await passwordWasPwned("password");
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect([down, await passwordWasPwned("password")]).toEqual([false, false]);
  });
});
