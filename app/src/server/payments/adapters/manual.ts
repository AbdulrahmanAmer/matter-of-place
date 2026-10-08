import { z } from "zod";
import { paymentMethodSchema } from "../../../domain/payments.ts";
import { AppError } from "../../lib/errors.ts";
import type { PaymentAdapter } from "./types.ts";

const frozenMethods = z.object({ instructions: z.array(paymentMethodSchema) });

/**
 * A manual invoice: the payer follows the instructions of `settings.invoice.payment_methods` as they were at issue.
 * They are read from the frozen snapshot, so a later settings change never rewrites an invoice already sent.
 */
export const invoiceManual: PaymentAdapter = {
  method: "invoice_manual",
  prepare(payment) {
    if (payment.invoice_snapshot === null) {
      throw new AppError("wrong_state", undefined, "This payment has no invoice.");
    }
    const { instructions: methods } = frozenMethods.parse(payment.invoice_snapshot);
    const preferred = methods.filter((method) => method.id === payment.preferred_method);
    const shown = preferred.length > 0 ? preferred : methods;
    return Promise.resolve({
      instructions: shown.map((method) => `${method.label}: ${method.instructions}`).join("\n"),
    });
  },
};
