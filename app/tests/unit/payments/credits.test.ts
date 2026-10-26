import { describe, expect, it } from "vitest";
import { creditsInPackage, creditValue } from "../../../src/domain/payments";

// W6 item 8, ruling H142: what a package pays for in advance, and what one credit is worth. The SQL twin
// `credits_in_package` is held to the same answers by tests/db/client-credits.db.test.ts.

describe("creditsInPackage", () => {
  it("is five for Five Features and nothing for a product that is one property", () => {
    expect([
      creditsInPackage("Five Features"),
      creditsInPackage("The Feature"),
      creditsInPackage("The Reach"),
      creditsInPackage("The Campaign"),
    ]).toEqual([5, null, null, null]);
  });
});

describe("creditValue", () => {
  it("is the pack's price over its credits, to the cent", () => {
    expect(creditValue(1250, 5)).toBe(250);
    expect(creditValue(1300, 5)).toBe(260);
    expect(creditValue(100, 3)).toBe(33.33);
  });
});
