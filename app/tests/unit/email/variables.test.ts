import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "../../../src/db";
import { variablesByKey } from "../../../src/domain/email";
import { loadSiteContext, type SiteContext } from "../../../src/server/email/context";
import { formatDate, formatUsd } from "../../../src/server/email/format";
import {
  entityData,
  resolveRecipient,
  resolveVariables,
  SkipSend,
} from "../../../src/server/email/variables";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

const SITE_URL = "https://dev.example.invalid";
const site: SiteContext = {
  siteUrl: SITE_URL,
  entity: null,
  address: null,
  contact: { email: null },
};

const SUBMISSION = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "22222222-2222-4222-8222-222222222222";
const INQUIRY = "33333333-3333-4333-8333-333333333333";
const SUBSCRIBER = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const REASON = "66666666-6666-4666-8666-666666666666";

type Rows = NonNullable<FakeDbOptions["tables"]>;

/** A row with the columns a test names; the resolvers read only the columns they select. */
function row<T>(values: { [K in keyof T]?: unknown }): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a fixture row names only the columns the code under test selects
  return values as T;
}

const submission = (overrides: Partial<Record<keyof Tables<"submissions">, unknown>> = {}) =>
  row<Tables<"submissions">>({
    id: SUBMISSION,
    submitter_name: "Jordan Lee",
    submitter_email: "jordan@example.com",
    submitter_kind: "owner",
    address: "412 Alder Court",
    city: "Pasadena",
    state: "California",
    package: "The Feature",
    decline_reason_id: REASON,
    decline_note: null,
    ...overrides,
  });

const inquiry = (overrides: Partial<Record<keyof Tables<"inquiries">, unknown>> = {}) =>
  row<Tables<"inquiries">>({
    id: INQUIRY,
    name: "Sam Rivera",
    email: "sam@example.com",
    phone: null,
    message: "I would like to know more about the house.",
    subject_slug: "alder-court",
    anonymised_at: null,
    ...overrides,
  });

const property = (overrides: Partial<Record<keyof Tables<"properties">, unknown>> = {}) =>
  row<Tables<"properties">>({
    slug: "alder-court",
    title: "Alder Court",
    submission_id: SUBMISSION,
    ...overrides,
  });

const request = (overrides: Partial<Record<keyof Tables<"subject_requests">, unknown>> = {}) =>
  row<Tables<"subject_requests">>({
    id: REQUEST,
    email: "requester@example.com",
    kind: "deletion",
    received_at: "2026-10-01T09:00:00Z",
    due_at: "2026-11-15T09:00:00Z",
    ...overrides,
  });

const payment = (overrides: Partial<Record<keyof Tables<"payments">, unknown>> = {}) =>
  row<Tables<"payments">>({
    id: PAYMENT,
    submission_id: SUBMISSION,
    invoice_number: "MOP-2026-0001",
    amount: "1500.00",
    product: "The Feature",
    preferred_method: "bank_transfer",
    status: "due",
    ...overrides,
  });

const setting = (key: string, value: unknown) => row<Tables<"settings">>({ key, value });

const invoiceSetting = setting("invoice", {
  terms: "Due within 14 days of the issue date.",
  billing_email: "billing@matterofplace.com",
  payment_methods: [
    {
      id: "bank_transfer",
      label: "Bank transfer",
      instructions: "Transfer to the account on the invoice.",
    },
    { id: "card", label: "Card by phone", instructions: "" },
  ],
});

const dbWith = (tables: Rows) => fakeDb({ tables });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatUsd and formatDate", () => {
  it("writes dollars with a thousands separator and dates in long form", () => {
    expect(formatUsd("1500.00")).toBe("$1,500.00");
    expect(formatUsd(295)).toBe("$295.00");
    expect(formatDate("2026-11-15T10:00:00Z")).toBe("November 15, 2026");
  });
});

describe("resolveVariables", () => {
  it("received and accepted give the submission's own words, and a package not yet chosen reads as a sentence", async () => {
    const db = dbWith({ submissions: [submission()] });
    const data = { submission_id: SUBMISSION };
    const received = await resolveVariables(db, "received", data);
    expect(received).toEqual({
      submitter_name: "Jordan Lee",
      property_address: "412 Alder Court",
      city: "Pasadena",
      state: "California",
      package: "The Feature",
    });
    const open = dbWith({ submissions: [submission({ package: "Not sure yet" })] });
    expect((await resolveVariables(open, "accepted", data))["package"]).toBe(
      "the product we agree together",
    );
  });

  it("declined reads the reason from the payload, else the submission, and the note from the payload, else the submission, else nothing", async () => {
    const reason = row<Tables<"decline_reasons">>({
      id: REASON,
      label: "Outside our markets",
      email_paragraph: "We publish in California, New York and Florida.",
    });
    const plain = dbWith({ submissions: [submission()], decline_reasons: [reason] });
    const none = await resolveVariables(plain, "declined", { submission_id: SUBMISSION });
    expect(none).toMatchObject({
      reason_label: "Outside our markets",
      reason_paragraph: "We publish in California, New York and Florida.",
      note_paragraph: "",
    });
    const noted = dbWith({
      submissions: [submission({ decline_note: "Stored note" })],
      decline_reasons: [reason],
    });
    const stored = await resolveVariables(noted, "declined", { submission_id: SUBMISSION });
    expect(stored["note_paragraph"]).toBe("Stored note");
    const typed = await resolveVariables(noted, "declined", {
      submission_id: SUBMISSION,
      note: "Typed note",
    });
    expect(typed["note_paragraph"]).toBe("Typed note");
    const noReason = dbWith({ submissions: [submission({ decline_reason_id: null })] });
    await expect(
      resolveVariables(noReason, "declined", { submission_id: SUBMISSION }),
    ).rejects.toThrow("missing_variable:reason_label");
  });

  it("awaiting_assets carries the note, or an empty string that drops its block", async () => {
    const db = dbWith({ submissions: [submission()] });
    const withNote = await resolveVariables(db, "awaiting_assets", {
      submission_id: SUBMISSION,
      note: "Send the plans.",
    });
    expect(withNote["assets_note"]).toBe("Send the plans.");
    const without = await resolveVariables(db, "awaiting_assets", { submission_id: SUBMISSION });
    expect(without["assets_note"]).toBe("");
  });

  it("invoice resolves the amount 1500.00 to $1,500.00 and answers every variable of the key", async () => {
    const db = dbWith({
      payments: [payment()],
      submissions: [submission()],
      settings: [invoiceSetting],
    });
    const variables = await resolveVariables(db, "invoice", { payment_id: PAYMENT });
    expect(Object.keys(variables).sort()).toEqual([...variablesByKey.invoice].sort());
    expect(variables).toMatchObject({
      amount: "$1,500.00",
      invoice_number: "MOP-2026-0001",
      product: "The Feature",
      terms: "Due within 14 days of the issue date.",
      preferred_method: "Bank transfer",
      payment_instructions: "Transfer to the account on the invoice.",
      billing_email: "billing@matterofplace.com",
      submitter_name: "Jordan Lee",
    });
  });

  it("invoice falls back to every method with instructions, finds the payment of a submission, and names what is missing", async () => {
    const tables = { submissions: [submission()], settings: [invoiceSetting] };
    const card = dbWith({ ...tables, payments: [payment({ preferred_method: "card" })] });
    const viaSubmission = await resolveVariables(card, "invoice", { submission_id: SUBMISSION });
    expect(viaSubmission["preferred_method"]).toBe("Card by phone");
    expect(viaSubmission["payment_instructions"]).toBe(
      "Bank transfer: Transfer to the account on the invoice.",
    );
    const none = dbWith({ ...tables, payments: [] });
    await expect(resolveVariables(none, "invoice", { payment_id: PAYMENT })).rejects.toThrow(
      "payment_missing",
    );
    const bare = dbWith({ submissions: [submission()], payments: [payment()], settings: [] });
    await expect(resolveVariables(bare, "invoice", { payment_id: PAYMENT })).rejects.toThrow(
      "invoice_settings_missing",
    );
  });

  it("invoice with neither a payment nor a submission to look for is payment_id_missing, not a read", async () => {
    const db = dbWith({ payments: [payment()], submissions: [submission()], settings: [] });
    const outcome = await resolveVariables(db, "invoice", {}).catch((error: unknown) => error);
    expect(outcome).toMatchObject({ message: "payment_id_missing", name: "NonRetryableError" });
    expect(db.calls.filter((call) => call.name === "payments")).toEqual([]);
  });

  it("inquiry_ack names the inquirer", async () => {
    const db = dbWith({ inquiries: [inquiry()] });
    expect(await resolveVariables(db, "inquiry_ack", { inquiry_id: INQUIRY })).toEqual({
      name: "Sam Rivera",
    });
  });

  it("inquiry_forward names the submitter, the property and how to reach the inquirer", async () => {
    const tables = { properties: [property()], submissions: [submission()] };
    const db = dbWith({ ...tables, inquiries: [inquiry({ phone: "+1 310 555 0100" })] });
    expect(await resolveVariables(db, "inquiry_forward", { inquiry_id: INQUIRY })).toEqual({
      submitter_name: "Jordan Lee",
      property_title: "Alder Court",
      inquirer_name: "Sam Rivera",
      inquirer_contact: "sam@example.com, +1 310 555 0100",
      message: "I would like to know more about the house.",
    });
    const noPhone = dbWith({ ...tables, inquiries: [inquiry()] });
    const plain = await resolveVariables(noPhone, "inquiry_forward", { inquiry_id: INQUIRY });
    expect(plain["inquirer_contact"]).toBe("sam@example.com");
    const gone = dbWith({
      ...tables,
      inquiries: [inquiry({ anonymised_at: "2026-10-02T00:00:00Z" })],
    });
    await expect(
      resolveVariables(gone, "inquiry_forward", { inquiry_id: INQUIRY }),
    ).rejects.toThrow(SkipSend);
  });

  it("subject_ack for a deletion request received on 2026-10-01 gives kind_label deletion and due_date November 15, 2026", async () => {
    const db = dbWith({ subject_requests: [request()] });
    expect(await resolveVariables(db, "subject_ack", { request_id: REQUEST })).toEqual({
      kind_label: "deletion",
      due_date: "November 15, 2026",
    });
    const optOut = dbWith({ subject_requests: [request({ kind: "opt_out" })] });
    const label = await resolveVariables(optOut, "subject_ack", { request_id: REQUEST });
    expect(label["kind_label"]).toBe("opt-out");
    const odd = dbWith({ subject_requests: [request({ kind: "constructor" })] });
    await expect(resolveVariables(odd, "subject_ack", { request_id: REQUEST })).rejects.toThrow(
      "missing_variable:kind_label",
    );
  });

  it("the confirmation keys need a sealed token, and interest_confirm needs a market it knows", async () => {
    const subscriber = row<Tables<"subscribers">>({ id: SUBSCRIBER, markets: ["california"] });
    const db = dbWith({ subscribers: [subscriber] });
    for (const key of ["interest_confirm", "newsletter_confirm", "repermission"] as const) {
      await expect(
        resolveVariables(db, key, { subscriber_id: SUBSCRIBER }, undefined, site),
      ).rejects.toThrow("missing_variable:confirm_url");
    }
    const nowhere = dbWith({
      subscribers: [row<Tables<"subscribers">>({ id: SUBSCRIBER, markets: ["narnia"] })],
    });
    await expect(
      resolveVariables(nowhere, "interest_confirm", { subscriber_id: SUBSCRIBER }, undefined, site),
    ).rejects.toThrow("missing_variable:market_names");
  });

  it("standalone has no variables", async () => {
    expect(await resolveVariables(dbWith({}), "standalone", {})).toEqual({});
  });

  it("builds the data of an entity under the name its resolver reads", () => {
    expect(entityData("submission", SUBMISSION)).toEqual({ submission_id: SUBMISSION });
    expect(entityData("subject_request", REQUEST)).toEqual({ request_id: REQUEST });
  });
});

describe("resolveVariables admin_notify", () => {
  const tables: Rows = {
    submissions: [submission()],
    payments: [payment()],
    inquiries: [inquiry()],
    subject_requests: [request()],
  };

  const events = [
    {
      event: "submission.received",
      data: { submission_id: SUBMISSION },
      summary: "New request: 412 Alder Court, Pasadena, California",
      path: `/admin/requests/${SUBMISSION}`,
      headline: "New request",
    },
    {
      event: "payment.marked",
      data: { payment_id: PAYMENT },
      summary: "MOP-2026-0001, $1,500.00 (due)",
      path: `/admin/invoices/${PAYMENT}`,
      headline: "Payment marked",
    },
    {
      event: "invoice.voided",
      data: { payment_id: PAYMENT },
      summary: "MOP-2026-0001, $1,500.00 (due)",
      path: `/admin/invoices/${PAYMENT}`,
      headline: "Invoice voided",
    },
    {
      event: "inquiry.received",
      data: { inquiry_id: INQUIRY },
      summary: "Sam Rivera, sam@example.com",
      path: `/admin/inquiries?id=${INQUIRY}`,
      headline: "New inquiry",
    },
    {
      event: "digest.due",
      data: {},
      summary: "Place Notes draft ready for review",
      path: "/admin/newsletter",
      headline: "Place Notes draft ready",
    },
    {
      event: "health.failed",
      data: {
        date: "2026-10-04",
        failed: [
          { check: "database", message: "no answer" },
          { check: "resend", message: "key refused" },
        ],
      },
      summary: "2 health checks failed: database: no answer; resend: key refused",
      path: "/admin/jobs",
      headline: "Health check failed",
    },
    {
      event: "subject_request.received",
      data: { request_id: REQUEST, kind: "deletion" },
      summary: "deletion request received, due November 15, 2026",
      path: "/admin/audit",
      headline: "Privacy request received",
    },
  ];

  it.each(events)("$event gives a summary and a link_url on SITE_URL", async (entry) => {
    const variables = await resolveVariables(
      dbWith(tables),
      "admin_notify",
      entry.data,
      entry.event,
      site,
    );
    expect(variables["summary"]).toBe(entry.summary);
    expect(variables["link_url"]).toBe(`${SITE_URL}${entry.path}`);
  });

  it.each(events)("$event with no params.headline gives its default headline", async (entry) => {
    const variables = await resolveVariables(
      dbWith(tables),
      "admin_notify",
      entry.data,
      entry.event,
      site,
    );
    expect(variables["headline"]).toBe(entry.headline);
  });

  it("a system job brings its own summary and link_path, and a headline of its own", async () => {
    const variables = await resolveVariables(
      dbWith({}),
      "admin_notify",
      { summary: "The Meta token expires in 5 days.", link_path: "/admin/settings" },
      undefined,
      site,
      "Token expiry: {{summary}}",
    );
    expect(variables).toEqual({
      headline: "Token expiry: The Meta token expires in 5 days.",
      summary: "The Meta token expires in 5 days.",
      link_url: `${SITE_URL}/admin/settings`,
    });
  });

  it("a health.failed without a list of failed checks is a non-retryable failure", async () => {
    const outcome = await resolveVariables(
      dbWith({}),
      "admin_notify",
      { failed: "database" },
      "health.failed",
      site,
    ).catch((error: unknown) => error);
    expect(outcome).toMatchObject({
      message: "failed_checks_malformed",
      name: "NonRetryableError",
    });
  });

  it("an unknown source without data.summary is missing_variable:summary", async () => {
    await expect(
      resolveVariables(dbWith({}), "admin_notify", {}, "something.else", site, "Headline"),
    ).rejects.toThrow("missing_variable:summary");
    await expect(
      resolveVariables(dbWith({}), "admin_notify", {}, undefined, site, "Headline"),
    ).rejects.toThrow("missing_variable:summary");
  });

  it("an unknown source with a summary and no headline asks for the headline", async () => {
    await expect(
      resolveVariables(dbWith({}), "admin_notify", { summary: "Something" }, undefined, site),
    ).rejects.toThrow("missing_variable:headline");
  });

  it("refuses a link_path that does not stay on the site", async () => {
    for (const link_path of ["//evil.example/x", "https://evil.example/x", "admin"]) {
      await expect(
        resolveVariables(
          dbWith({}),
          "admin_notify",
          { summary: "x", link_path },
          undefined,
          site,
          "H",
        ),
      ).rejects.toThrow("link_path_invalid");
    }
  });
});

describe("resolveRecipient", () => {
  const settings = (notifications: unknown, contact: string | null) => [
    setting("notifications", notifications),
    setting("site", { contact: { email: contact } }),
  ];

  it.each(["agent", "owner"])(
    "submitter reads the submission's address for an %s",
    async (kind) => {
      const db = dbWith({
        submissions: [submission({ submitter_kind: kind, submitter_email: `${kind}@example.com` })],
      });
      expect(await resolveRecipient(db, "received", {}, { submission_id: SUBMISSION })).toEqual({
        to: [`${kind}@example.com`],
        entity: "submission",
        entityId: SUBMISSION,
      });
    },
  );

  it("gives each other kind its address, entity and id", async () => {
    const db = dbWith({
      inquiries: [inquiry()],
      subscribers: [row<Tables<"subscribers">>({ id: SUBSCRIBER, email: "reader@example.com" })],
      subject_requests: [request()],
      settings: settings({ recipients: ["a@matterofplace.com", "b@matterofplace.com"] }, null),
    });
    expect(await resolveRecipient(db, "inquiry_ack", {}, { inquiry_id: INQUIRY })).toEqual({
      to: ["sam@example.com"],
      entity: "inquiry",
      entityId: INQUIRY,
    });
    expect(
      await resolveRecipient(db, "newsletter_confirm", {}, { subscriber_id: SUBSCRIBER }),
    ).toEqual({ to: ["reader@example.com"], entity: "subscriber", entityId: SUBSCRIBER });
    expect(await resolveRecipient(db, "subject_ack", {}, { request_id: REQUEST })).toEqual({
      to: ["requester@example.com"],
      entity: "subject_request",
      entityId: REQUEST,
    });
    expect(await resolveRecipient(db, "admin_notify", {}, {})).toEqual({
      to: ["a@matterofplace.com", "b@matterofplace.com"],
      entity: null,
      entityId: null,
    });
  });

  it("params.to overrides the default of the key", async () => {
    const db = dbWith({ inquiries: [inquiry()] });
    const to = await resolveRecipient(
      db,
      "admin_notify",
      { to: "inquirer" },
      { inquiry_id: INQUIRY },
    );
    expect(to.to).toEqual(["sam@example.com"]);
  });

  it("a test job goes to its actor alone, with the entity it names", async () => {
    const db = dbWith({});
    const data = {
      test: true,
      actor_email: "admin@matterofplace.com",
      entity: "submission",
      entity_id: SUBMISSION,
    };
    expect(await resolveRecipient(db, "received", {}, data)).toEqual({
      to: ["admin@matterofplace.com"],
      entity: "submission",
      entityId: SUBMISSION,
    });
    await expect(resolveRecipient(db, "received", {}, { test: true })).rejects.toThrow(
      "recipient_missing",
    );
  });

  it("a missing row, a missing id and a key with no default are recipient_missing", async () => {
    const empty = dbWith({
      submissions: [],
      inquiries: [],
      subscribers: [],
      subject_requests: [],
    });
    const cases = [
      resolveRecipient(empty, "received", {}, { submission_id: SUBMISSION }),
      resolveRecipient(empty, "inquiry_ack", {}, { inquiry_id: INQUIRY }),
      resolveRecipient(empty, "repermission", {}, { subscriber_id: SUBSCRIBER }),
      resolveRecipient(empty, "subject_ack", {}, { request_id: REQUEST }),
      resolveRecipient(empty, "received", {}, {}),
      resolveRecipient(empty, "standalone", {}, {}),
    ];
    for (const result of cases) await expect(result).rejects.toThrow("recipient_missing");
  });

  it("requester reads the subject request and never the subscriber list", async () => {
    const db = dbWith({ subject_requests: [request({ email: "asked@example.com" })] });
    const result = await resolveRecipient(
      db,
      "subject_ack",
      { to: "requester" },
      { request_id: REQUEST },
    );
    expect(result.to).toEqual(["asked@example.com"]);
  });

  it("admins fall back to the contact address, then ADMIN_NOTIFY_EMAIL, then refuse", async () => {
    const listed = dbWith({ settings: settings({ recipients: [] }, "hello@matterofplace.com") });
    expect((await resolveRecipient(listed, "admin_notify", {}, {})).to).toEqual([
      "hello@matterofplace.com",
    ]);
    vi.stubEnv("ADMIN_NOTIFY_EMAIL", "admin@matterofplace.com");
    const bare = dbWith({ settings: [] });
    expect((await resolveRecipient(bare, "admin_notify", {}, {})).to).toEqual([
      "admin@matterofplace.com",
    ]);
    vi.stubEnv("ADMIN_NOTIFY_EMAIL", "");
    await expect(resolveRecipient(bare, "admin_notify", {}, {})).rejects.toThrow(
      "recipient_missing",
    );
  });
});

describe("resolveRecipient inquiry_forward", () => {
  const chain = { properties: [property()], submissions: [submission()] };

  it("reaches the submission behind the inquiry's property", async () => {
    const db = dbWith({ ...chain, inquiries: [inquiry()] });
    expect(await resolveRecipient(db, "inquiry_forward", {}, { inquiry_id: INQUIRY })).toEqual({
      to: ["jordan@example.com"],
      entity: "submission",
      entityId: SUBMISSION,
    });
  });

  it("has no one to tell for an inquiry with no subject_slug", async () => {
    const db = dbWith({ ...chain, inquiries: [inquiry({ subject_slug: null })] });
    expect(await resolveRecipient(db, "inquiry_forward", {}, { inquiry_id: INQUIRY })).toEqual({
      to: [],
      entity: null,
      entityId: null,
    });
  });

  it("has no one to tell for a property no submission made", async () => {
    const db = dbWith({
      inquiries: [inquiry()],
      properties: [property({ submission_id: null })],
      submissions: [],
    });
    expect((await resolveRecipient(db, "inquiry_forward", {}, { inquiry_id: INQUIRY })).to).toEqual(
      [],
    );
  });

  it("is recipient_missing for an inquiry that does not exist", async () => {
    const db = dbWith({ ...chain, inquiries: [] });
    await expect(
      resolveRecipient(db, "inquiry_forward", {}, { inquiry_id: INQUIRY }),
    ).rejects.toThrow("recipient_missing");
  });
});

describe("loadSiteContext", () => {
  it("takes the site from the argument, else SITE_URL, and refuses to guess", async () => {
    const db = dbWith({ settings: [] });
    expect((await loadSiteContext(db, "https://a.example.invalid/")).siteUrl).toBe(
      "https://a.example.invalid",
    );
    vi.stubEnv("SITE_URL", "https://b.example.invalid");
    expect((await loadSiteContext(db)).siteUrl).toBe("https://b.example.invalid");
    vi.stubEnv("SITE_URL", "");
    await expect(loadSiteContext(db)).rejects.toThrow("site_url_missing");
  });

  it("reads the identity lines of settings.site, and nulls when they are unset or malformed", async () => {
    const named = dbWith({
      settings: [
        setting("site", {
          contact: { email: "hello@matterofplace.com" },
          legal: { entity: "Omnikom Media LLC", address: "1 Example Plaza, Pasadena" },
        }),
      ],
    });
    expect(await loadSiteContext(named, SITE_URL)).toEqual({
      siteUrl: SITE_URL,
      entity: "Omnikom Media LLC",
      address: "1 Example Plaza, Pasadena",
      contact: { email: "hello@matterofplace.com" },
    });
    for (const settings of [[], [setting("site", "not an object")]]) {
      expect(await loadSiteContext(dbWith({ settings }), SITE_URL)).toEqual({
        siteUrl: SITE_URL,
        entity: null,
        address: null,
        contact: { email: null },
      });
    }
  });
});
