// The single source of valid payloads for unit, api and e2e tests (GQ-03). Every address is on the reserved domain
// `fixtures.invalid`, so cleanup and counts never touch another row (invariant 8).
import type { z } from "zod";
import type { inquirySchema, submissionSchema, subscriberSchema } from "../../src/domain/contracts";

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
    brokerage: "Fixture Brokerage",
    agentName: "Ada Fixture",
    agentEmail: "agent@fixtures.invalid",
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
