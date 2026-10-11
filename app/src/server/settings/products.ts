import { offerings } from "../../data/exposure.ts";
import {
  plansFromOfferings,
  productsSettingSchema,
  type ProductPlan,
} from "../../domain/exposure.ts";
import { logLine } from "../lib/log.ts";
import type { PublicState } from "../public/state.ts";

/** The four plans of `src/data/exposure.ts`: the first stored row and the fallback when the setting is absent. */
export function seedProducts(): ProductPlan[] {
  return plansFromOfferings(offerings);
}

/**
 * The plans of the public state. A missing value is the seed, silently; a stored value that does not parse is the
 * seed too, with one `products_invalid` line, so a bad row never takes the page down.
 */
export function productsOf(state: Pick<PublicState, "products">): ProductPlan[] {
  if (state.products === null) return seedProducts();
  const parsed = productsSettingSchema.safeParse(state.products);
  if (parsed.success) return parsed.data.plans;
  logLine("warn", "products_invalid", {
    issues: parsed.error.issues.length,
    first: parsed.error.issues[0]?.message ?? null,
  });
  return seedProducts();
}
