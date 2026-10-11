import { describe, expect, it } from "vitest";
import type { ProductPlan } from "../../../src/domain/exposure";
import { tierOf } from "../../../src/domain/payments";
import { AppError } from "../../../src/server/lib/errors";
import { offeringFor, priceFor } from "../../../src/server/payments/pricing";
import { seedProducts } from "../../../src/server/settings/products";

// The seed amounts are typed here from S3 (the exposure schedule), not read back from `exposure.ts`; the stored plans
// of H80 are what an invoice prices from, found by the id each product is bound to.
const stored = (): ProductPlan[] =>
  seedProducts().map((plan) =>
    plan.id === "reach" ? { ...plan, name: "The Wider Reach", price: 725 } : plan,
  );

describe("invoice pricing (S3)", () => {
  it("prices each product at its S3 amount in whole dollars", () => {
    const plans = seedProducts();
    expect([
      priceFor(plans, "The Feature"),
      priceFor(plans, "The Reach"),
      priceFor(plans, "The Campaign"),
      priceFor(plans, "Five Features"),
    ]).toEqual([295, 695, 1495, 1250]);
  });

  it("finds the plan bound to the product, at the price it is given", () => {
    expect(offeringFor(seedProducts(), "The Reach").line).toBe(
      "Editorial presence, expanded through precision distribution.",
    );
    expect(priceFor(stored(), "The Feature")).toBe(295);
  });

  it("finds a renamed plan by its bound id and prices it at its stored price", () => {
    expect(offeringFor(stored(), "The Reach").name).toBe("The Wider Reach");
    expect(priceFor(stored(), "The Reach")).toBe(725);
  });

  it("refuses Not sure yet, which has no price", () => {
    expect(() => priceFor(seedProducts(), "Not sure yet")).toThrow(AppError);
    expect(() => offeringFor(seedProducts(), "Not sure yet")).toThrow("Choose a product");
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
