import { NotImplementedError, type PaymentAdapter } from "./types.ts";

// STUB(post-v1): real Stripe adapter and webhook
export class StripeAdapter implements PaymentAdapter {
  readonly method = "stripe";

  prepare(): Promise<never> {
    throw new NotImplementedError("Stripe prepare");
  }

  parseWebhook(): Promise<never> {
    throw new NotImplementedError("Stripe webhook");
  }
}
