import type { ExposurePackage } from "../../domain/rows.ts";
import { boundPlanIds, type ProductPlan } from "../../domain/exposure.ts";
import { AppError } from "../lib/errors.ts";

const planIdOf: Partial<Record<ExposurePackage, ProductPlan["id"]>> = boundPlanIds;

/**
 * The plan bound to the product, found by its fixed id and never by its name, so a renamed plan still invoices.
 * `Not sure yet` has none: it is resolved to a real product before an invoice.
 */
export function offeringFor(plans: readonly ProductPlan[], product: ExposurePackage): ProductPlan {
  const plan = plans.find((candidate) => candidate.id === planIdOf[product]);
  if (plan === undefined) {
    throw new AppError("validation", undefined, "Choose a product before issuing an invoice.");
  }
  return plan;
}

/** The whole dollars an invoice or a waiver carries for the product: the price of its stored plan (H80). */
export function priceFor(plans: readonly ProductPlan[], product: ExposurePackage): number {
  return offeringFor(plans, product).price;
}
