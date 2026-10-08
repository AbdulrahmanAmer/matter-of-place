import type { PaymentMethod } from "../../../domain/rows.ts";
import type { PaymentRow } from "../../../domain/payments.ts";

/** What a method tells the payer: the text of the invoice and, for a hosted method, the provider's reference. */
interface PreparedPayment {
  instructions: string;
  externalRef?: string;
}

/** One way money arrives. A method that is paid by a provider callback also reads its webhook. */
export interface PaymentAdapter {
  readonly method: PaymentMethod;
  prepare(payment: PaymentRow): Promise<PreparedPayment>;
  parseWebhook?(req: Request): Promise<{ externalRef: string }>;
}

/** Thrown by a method that is declared but not built. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented`);
    this.name = "NotImplementedError";
  }
}
