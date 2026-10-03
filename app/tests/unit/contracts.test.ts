import { describe, expect, it } from "vitest";
import {
  conciergeAnswerSchema,
  contactTopics,
  inquirySchema,
  receiptSchema,
  submissionReceiptSchema,
  submissionSchema,
  subscriberSchema,
  uploadLimits,
} from "../../src/domain/contracts";
import { validInquiry, validSubmission, validSubscriber } from "../fixtures/builders";

type Rejection = { field: string; value: unknown };
type Outcome = { error?: { issues: { path: PropertyKey[] }[] } };

const issuePaths = (outcome: Outcome): string[] =>
  (outcome.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));

describe("inquirySchema", () => {
  it("accepts the builder and every intent", () => {
    expect(inquirySchema.safeParse(validInquiry()).success).toBe(true);
    for (const intent of [
      "showing",
      "ask",
      "similar",
      "sell",
      "invest",
      "agent",
      "general",
    ] as const) {
      expect(inquirySchema.safeParse(validInquiry({ intent })).success).toBe(true);
    }
  });

  const rejections: Rejection[] = [
    { field: "intent", value: "browse" },
    { field: "name", value: "" },
    { field: "email", value: "not-an-email" },
    { field: "message", value: "" },
    { field: "message", value: "x".repeat(5001) },
    { field: "topic", value: "Weather" },
    { field: "sourcePath", value: "/".repeat(301) },
  ];
  it.each(rejections)("rejects $field set to a bad value", ({ field, value }) => {
    expect(issuePaths(inquirySchema.safeParse({ ...validInquiry(), [field]: value }))).toEqual([
      field,
    ]);
  });

  it("accepts a message of exactly 5,000 characters and every contact topic", () => {
    expect(inquirySchema.safeParse(validInquiry({ message: "x".repeat(5000) })).success).toBe(true);
    for (const topic of contactTopics) {
      expect(inquirySchema.safeParse(validInquiry({ topic })).success).toBe(true);
    }
  });

  it("trims text and defaults details to an empty record", () => {
    const parsed = inquirySchema.parse(
      validInquiry({ name: "  Ines  ", email: "  inquirer@fixtures.invalid " }),
    );
    expect(parsed.name).toBe("Ines");
    expect(parsed.email).toBe("inquirer@fixtures.invalid");
    expect(parsed.details).toEqual({});
  });

  it("accepts an empty optional field", () => {
    expect(inquirySchema.safeParse(validInquiry({ phone: "", location: "" })).success).toBe(true);
  });
});

describe("submissionSchema", () => {
  it("accepts the builder, honeypot included", () => {
    expect(submissionSchema.safeParse(validSubmission()).success).toBe(true);
  });

  const rejections: Rejection[] = [
    { field: "rightsConfirmed", value: false },
    { field: "zip", value: "1234" },
    { field: "zip", value: "123456" },
    { field: "state", value: "Texas" },
    { field: "currency", value: "EUR" },
    { field: "propertyType", value: "Castle" },
    { field: "package", value: "The Everything" },
    { field: "submitterEmail", value: "agent-at-fixtures" },
    { field: "story", value: "x".repeat(5001) },
    { field: "address", value: "" },
    { field: "listingUrl", value: "not a url" },
    { field: "yearBuilt", value: 1500 },
    { field: "price", value: 0 },
  ];
  it.each(rejections)("rejects $field set to a bad value", ({ field, value }) => {
    expect(
      issuePaths(submissionSchema.safeParse({ ...validSubmission(), [field]: value })),
    ).toEqual([field]);
  });

  it("rejects a submission that never confirmed the rights", () => {
    const { rightsConfirmed: _confirmed, ...without } = validSubmission();
    expect(issuePaths(submissionSchema.safeParse(without))).toEqual(["rightsConfirmed"]);
  });

  it("takes each of the three states", () => {
    for (const state of ["California", "New York", "Florida"] as const) {
      expect(submissionSchema.safeParse(validSubmission({ state })).success).toBe(true);
    }
  });

  it("rejects more than 40 media and accepts 40", () => {
    const photo = { name: "p.jpg", size: 1024, type: "image/jpeg" };
    expect(
      submissionSchema.safeParse(
        validSubmission({ media: Array(uploadLimits.maxFiles).fill(photo) }),
      ).success,
    ).toBe(true);
    const result = submissionSchema.safeParse(
      validSubmission({ media: Array(uploadLimits.maxFiles + 1).fill(photo) }),
    );
    expect(issuePaths(result)).toEqual(["media"]);
  });

  it("defaults media to an empty list", () => {
    const { media: _media, ...without } = validSubmission();
    expect(submissionSchema.parse(without).media).toEqual([]);
  });

  it("strips a filled honeypot field instead of rejecting", () => {
    const parsed = submissionSchema.parse(validSubmission({ website: "https://spam.invalid" }));
    expect("website" in parsed).toBe(false);
  });

  it("trims text and turns an empty optional url into absent", () => {
    const parsed = submissionSchema.parse(validSubmission({ city: "  Malibu ", listingUrl: "" }));
    expect(parsed.city).toBe("Malibu");
    expect(parsed.listingUrl).toBeUndefined();
  });
});

describe("subscriberSchema", () => {
  it("accepts the builder", () => {
    expect(subscriberSchema.safeParse(validSubscriber()).success).toBe(true);
  });

  it("rejects an invalid email and a source over 120 characters", () => {
    expect(issuePaths(subscriberSchema.safeParse(validSubscriber({ email: "reader" })))).toEqual([
      "email",
    ]);
    expect(
      issuePaths(subscriberSchema.safeParse(validSubscriber({ source: "s".repeat(121) }))),
    ).toEqual(["source"]);
  });

  it("trims the email", () => {
    expect(
      subscriberSchema.parse(validSubscriber({ email: " reader@fixtures.invalid " })).email,
    ).toBe("reader@fixtures.invalid");
  });
});

describe("the response schemas", () => {
  it("receiptSchema needs an id and a receivedAt", () => {
    expect(receiptSchema.safeParse({ id: "r1", receivedAt: "2026-10-01T12:00:00Z" }).success).toBe(
      true,
    );
    expect(issuePaths(receiptSchema.safeParse({ id: "r1" }))).toEqual(["receivedAt"]);
  });

  it("submissionReceiptSchema carries one upload target per photograph", () => {
    const receipt = {
      id: "r1",
      receivedAt: "2026-10-01T12:00:00Z",
      uploads: [{ name: "p.jpg", url: "u" }],
    };
    expect(submissionReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(issuePaths(submissionReceiptSchema.safeParse({ id: "r1", receivedAt: "t" }))).toEqual([
      "uploads",
    ]);
  });

  it("conciergeAnswerSchema allows only the showing action", () => {
    expect(conciergeAnswerSchema.safeParse({ text: "Yes.", action: "showing" }).success).toBe(true);
    expect(issuePaths(conciergeAnswerSchema.safeParse({ text: "Yes.", action: "buy" }))).toEqual([
      "action",
    ]);
  });
});
