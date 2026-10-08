import type { PaymentMethod } from "../../../domain/rows.ts";
import { invoiceManual } from "./manual.ts";
import { NotImplementedError, type PaymentAdapter } from "./types.ts";

/** Registered methods. Stripe is a stub and joins this list when it is built (invariant 9). */
export const registry: Partial<Record<PaymentMethod, PaymentAdapter>> = {
  invoice_manual: invoiceManual,
};

export function getAdapter(method: PaymentMethod): PaymentAdapter {
  const adapter = registry[method];
  if (adapter === undefined) throw new NotImplementedError(`The ${method} payment method`);
  return adapter;
}
