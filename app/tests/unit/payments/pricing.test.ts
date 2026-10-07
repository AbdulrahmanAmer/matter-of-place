import { describe, expect, it } from "vitest";
import { tierOf } from "../../../src/domain/payments";
import { AppError } from "../../../src/server/lib/errors";
import { offeringFor, priceFor } from "../../../src/server/payments/pricing";

// The amounts are typed here from S3 (the exposure schedule), not read back from `exposure.ts`.
describe("invoice pricing (S3)", () => {
  it("prices each product at its S3 amount in whole dollars", () => {
    expect([
      priceFor("The Feature"),
      priceFor("The Reach"),
      priceFor("The Campaign"),
      priceFor("Five Features"),
    ]).toEqual([295, 695, 1495, 1250]);
  });

  it("finds the offering that carries the product name", () => {
    expect(offeringFor("The Reach").line).toBe(
      "Editorial presence, expanded through precision distribution.",
    );
  });

  it("refuses Not sure yet, which has no price", () => {
    expect(() => priceFor("Not sure yet")).toThrow(AppError);
    expect(() => offeringFor("Not sure yet")).toThrow("Choose a product");
  });

  it("maps the four products to their tier", () => {
    expect([
      tierOf("The Feature"),
      tierOf("Five Features"),
      tierOf("The Reach"),
      tierOf("The Campaign"),
    ]).toEqual(["Feature", "Feature", "Reach", "Campaign"]);
  });
});
