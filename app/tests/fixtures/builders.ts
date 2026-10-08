// The single source of valid payloads for unit, api and e2e tests (GQ-03). Every address is on the reserved domain
// `fixtures.invalid`, so cleanup and counts never touch another row (invariant 8).
import type { z } from "zod";
import type { inquirySchema, submissionSchema, subscriberSchema } from "../../src/domain/contracts";
import type { IssueInvoiceInput } from "../../src/domain/payments";

export type InquiryInput = z.input<typeof inquirySchema>;
export type SubmissionInput = z.input<typeof submissionSchema> & { website: string };
export type SubscriberInput = z.input<typeof subscriberSchema>;

export function validInquiry(overrides: Partial<InquiryInput> = {}): InquiryInput {
  return {
    intent: "general",
    name: "Ines Marlowe",
    email: "inquirer@fixtures.invalid",
    message: "I would like to know more about the collection.",
    sourcePath: "/contact",
    ...overrides,
  };
}

/** Carries the honeypot field empty and one photograph well inside the media limits. */
export function validSubmission(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    address: "12 Cliff Road",
    city: "Malibu",
    state: "California",
    zip: "90265",
    currency: "USD",
    propertyType: "Residence",
    submitterKind: "agent",
    submitterName: "Ada Fixture",
    submitterEmail: "agent@fixtures.invalid",
    brokerage: "Fixture Brokerage",
    story: "Built into the cliff in 1962 and kept by one family since.",
    significance: "An early example of the coastal modern house.",
    package: "The Feature",
    rightsConfirmed: true,
    media: [{ name: "front.jpg", size: 1_048_576, type: "image/jpeg" }],
    sourcePath: "/submit",
    website: "",
    ...overrides,
  };
}

export function validSubscriber(overrides: Partial<SubscriberInput> = {}): SubscriberInput {
  return { email: "reader@fixtures.invalid", source: "home", ...overrides };
}

/** The body of `payments.issue-invoice` for a request that exists only in the test's own rows. */
export function validIssueInvoice(overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput {
  const base = {
    submissionId: "0b6a1f4e-3c52-4d7a-9e18-5a2f7c1d9b60",
    product: "The Feature",
    preferredMethod: "bank_transfer",
  } satisfies IssueInvoiceInput;
  return { ...base, ...overrides };
}
