import { describe, expect, it } from "vitest";
import { clientIp, hashKey, newToken, sha256Hex } from "../../src/server/lib/ids";

describe("clientIp", () => {
  it("reads cf-connecting-ip", () => {
    const request = new Request("https://x.test/", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    expect(clientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to one shared address without the header", () => {
    expect(clientIp(new Request("https://x.test/"))).toBe("0.0.0.0");
  });
});

describe("hashKey", () => {
  it("is the SHA-256 of salt, a colon and the value", async () => {
    expect(await hashKey("salt", "203.0.113.9")).toBe(await sha256Hex("salt:203.0.113.9"));
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("changes with the salt", async () => {
    expect(await hashKey("a", "v")).not.toBe(await hashKey("b", "v"));
  });
});

describe("newToken", () => {
  it("is 32 random bytes as base64url, different each time", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });
});
