import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Tables } from "../../../src/db";
import { emailTemplateSchema, sampleVariables } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate } from "../../../src/server/email/render";
import { resolveRecipient, resolveVariables, SkipSend } from "../../../src/server/email/variables";
import { definitionRow } from "../../../src/templates/email/index";
import { definition } from "../../../src/templates/email/newsletter-welcome";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

// The welcome a subscriber gets once, right after confirming (operator, 2026-10-15): what it promises to each kind of
// reader, when it is not sent again, the slot it draws from the latest Place Notes issue, and the row its migration
// seeds.

const SITE_URL = "https://dev.example.invalid";
const site: SiteContext = {
  siteUrl: SITE_URL,
  entity: "Omnikom LLC",
  address: "30 N Gould St Ste R, Sheridan, WY 82801, USA",
  contact: { email: "hello@matterofplace.com" },
};

const SUBSCRIBER = "44444444-4444-4444-8444-444444444444";
const STORY = "88888888-8888-4888-8888-888888888888";
const PROPERTY = "99999999-9999-4999-8999-999999999999";
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Rows = NonNullable<FakeDbOptions["tables"]>;

/** A row with the columns a test names; the resolver reads only the columns it selects. */
function row<T>(values: { [K in keyof T]?: unknown }): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a fixture row names only the columns the code under test selects
  return values as T;
}

const subscriber = (overrides: Partial<Record<keyof Tables<"subscribers">, unknown>> = {}) =>
  row<Tables<"subscribers">>({
    id: SUBSCRIBER,
    email: "reader@example.com",
    source: "place-notes",
    markets: [],
    confirmed_at: "2026-10-15T08:00:00Z",
    unsubscribed_at: null,
    archived_at: null,
    ...overrides,
  });

const message = (template_key: string, created_at: string, status = "sent") =>
  row<Tables<"email_messages">>({ template_key, status, created_at });

const issue = (blocks: unknown[], number = 3) =>
  row<Tables<"newsletter_issues">>({ number, status: "sent", blocks });

const storyBlock = {
  id: "s1",
  type: "story",
  story_id: STORY,
  title: "The long view",
  deck: "A street of oaks above Pasadena. It has not changed in a century.",
};

const propertyBlock = {
  id: "p1",
  type: "property",
  property_id: PROPERTY,
  asset_id: ASSET,
  title: "Alder Court",
  deck: "A 1926 Spanish Revival house in Pasadena.",
};

const story = (overrides: Partial<Record<keyof Tables<"stories">, unknown>> = {}) =>
  row<Tables<"stories">>({
    id: STORY,
    slug: "the-long-view",
    editorial_state: "published",
    archived_at: null,
    ...overrides,
  });

const property = (overrides: Partial<Record<keyof Tables<"properties">, unknown>> = {}) =>
  row<Tables<"properties">>({
    id: PROPERTY,
    slug: "alder-court",
    editorial_state: "published",
    taken_down_at: null,
    ...overrides,
  });

/** The tables a welcome reads; a test overrides the ones it is about. */
const world = (tables: Rows = {}) =>
  fakeDb({
    tables: {
      subscribers: [subscriber()],
      email_messages: [message("newsletter_confirm", "2026-10-15T07:00:00Z")],
      newsletter_issues: [],
      stories: [],
      properties: [],
      ...tables,
    },
  });

const welcome = (tables: Rows = {}) =>
  resolveVariables(
    world(tables),
    "newsletter_welcome",
    { subscriber_id: SUBSCRIBER },
    undefined,
    site,
  );

const skipReason = async (tables: Rows): Promise<string> => {
  const failure: unknown = await welcome(tables).then(
    () => null,
    (error: unknown) => error,
  );
  if (!(failure instanceof SkipSend)) throw new Error("expected the welcome to be skipped");
  return failure.reason;
};

describe("newsletter_welcome variables", () => {
  it("tells a Place Notes reader the issue comes about every two weeks, and a home of the markets they follow too", async () => {
    const variables = await welcome({
      subscribers: [subscriber({ markets: ["california", "florida"] })],
    });
    expect(variables["what_you_receive"]).toBe(
      "Place Notes will reach you about every two weeks, with the homes and stories published since the last issue. When a single home in California or Florida has a letter of its own, it will reach you too.",
    );
    expect(variables["market_names"]).toBe("California and Florida");
    const plain = await welcome();
    expect(plain["what_you_receive"]).toBe(
      "Place Notes will reach you about every two weeks, with the homes and stories published since the last issue.",
    );
  });

  it("tells an interest signup it hears once, when the first home of its market is published, and not of the issue", async () => {
    const one = await welcome({
      subscribers: [subscriber({ source: "interest:california", markets: ["california"] })],
      email_messages: [message("interest_confirm", "2026-10-15T07:00:00Z")],
    });
    expect(one["what_you_receive"]).toBe(
      "We will write to you once, when Matter of Place publishes its first home in California. Place Notes, our letter about every two weeks, is a separate sign-up on the site.",
    );
    const two = await welcome({
      subscribers: [subscriber({ source: "interest:home", markets: ["new-york", "florida"] })],
    });
    expect(two["what_you_receive"]).toMatch(
      /^We will write to you once for each of New York and Florida, when Matter of Place publishes its first home there\./,
    );
  });

  it("is not sent after a re-permission click, twice for one sign-up, to a row no longer subscribed, or to an interest signup with no market", async () => {
    expect(
      await skipReason({
        email_messages: [
          message("newsletter_confirm", "2026-01-10T07:00:00Z"),
          message("newsletter_welcome", "2026-01-10T07:05:00Z"),
          message("repermission", "2026-10-10T07:00:00Z"),
        ],
      }),
    ).toBe("repermission");
    expect(
      await skipReason({
        email_messages: [
          message("newsletter_confirm", "2026-10-15T07:00:00Z"),
          message("newsletter_welcome", "2026-10-15T08:01:00Z"),
        ],
      }),
    ).toBe("already_welcomed");
    expect(
      await skipReason({ subscribers: [subscriber({ unsubscribed_at: "2026-10-15T09:00:00Z" })] }),
    ).toBe("not_subscribed");
    expect(
      await skipReason({ subscribers: [subscriber({ source: "interest:home", markets: [] })] }),
    ).toBe("no_market");
  });

  it("welcomes again a new sign-up after an earlier welcome, and when the earlier one never went out", async () => {
    const upgraded = await welcome({
      email_messages: [
        message("interest_confirm", "2026-09-01T07:00:00Z"),
        message("newsletter_welcome", "2026-09-01T07:05:00Z"),
        message("newsletter_confirm", "2026-10-15T07:00:00Z"),
      ],
    });
    expect(upgraded["what_you_receive"]).toMatch(/^Place Notes will reach you/);
    const failed = await welcome({
      email_messages: [
        message("newsletter_confirm", "2026-10-15T07:00:00Z"),
        message("newsletter_welcome", "2026-10-15T08:01:00Z", "failed"),
      ],
    });
    expect(failed["what_you_receive"]).toMatch(/^Place Notes will reach you/);
  });

  it("fills the slot with the lead piece of the latest issue sent, its first sentence and its address on the site", async () => {
    const variables = await welcome({
      newsletter_issues: [
        issue([{ id: "i", type: "intro", text: "Hello." }, storyBlock, propertyBlock], 3),
      ],
      stories: [story()],
      properties: [property()],
    });
    expect([
      variables["latest_number"],
      variables["latest_title"],
      variables["latest_line"],
      variables["latest_url"],
    ]).toEqual([
      "3",
      "The long view",
      "A street of oaks above Pasadena.",
      `${SITE_URL}/stories/the-long-view?utm_source=place_notes&utm_medium=email&utm_campaign=welcome&utm_content=the-long-view`,
    ]);
  });

  it("passes over a piece no longer published, and leaves the slot empty while no issue has gone out", async () => {
    const variables = await welcome({
      newsletter_issues: [issue([storyBlock, propertyBlock], 5)],
      stories: [story({ editorial_state: "draft" })],
      properties: [property()],
    });
    expect([
      variables["latest_number"],
      variables["latest_title"],
      variables["latest_url"],
    ]).toEqual([
      "5",
      "Alder Court",
      `${SITE_URL}/property/alder-court?utm_source=place_notes&utm_medium=email&utm_campaign=welcome&utm_content=alder-court`,
    ]);
    const none = await welcome();
    expect([
      none["latest_number"],
      none["latest_title"],
      none["latest_line"],
      none["latest_url"],
    ]).toEqual(["", "", "", ""]);
  });

  it("goes to the subscriber who confirmed", async () => {
    const recipient = await resolveRecipient(
      world(),
      "newsletter_welcome",
      {},
      { subscriber_id: SUBSCRIBER },
    );
    expect(recipient).toEqual({
      to: ["reader@example.com"],
      entity: "subscriber",
      entityId: SUBSCRIBER,
    });
  });
});

const render = (variables: Record<string, string>, at: SiteContext = site) =>
  renderTemplate(definitionRow(definition), variables, at);

const emptySlot = { latest_number: "", latest_title: "", latest_line: "", latest_url: "" };

describe("newsletter_welcome email", () => {
  it("draws the latest piece in its slot, or the quiet line while no issue has gone out, in the text part too", async () => {
    const samples = sampleVariables("newsletter_welcome", SITE_URL);
    const strings = Object.fromEntries(
      Object.entries(samples).flatMap(([name, value]) =>
        typeof value === "string" ? [[name, value]] : [],
      ),
    );
    const full = await render(strings);
    expect(full.html).toContain("From Place Notes No. 3");
    expect(full.html).toContain(`href="${(strings["latest_url"] ?? "").replaceAll("&", "&amp;")}"`);
    expect(full.text).toContain(`From Place Notes No. 3\n\nThe house that keeps the afternoon`);
    expect(full.html).not.toContain("is being prepared");
    const empty = await render({ ...strings, ...emptySlot });
    expect(empty.html).toContain("The first issue of Place Notes is being prepared.");
    expect(empty.html).not.toContain("From Place Notes");
    expect(empty.text).toContain("The first issue of Place Notes is being prepared.");
  });

  it("draws the quiet line, never the link, when the slot's address is not https", async () => {
    const strings = {
      what_you_receive: "Place Notes will reach you.",
      market_names: "",
      latest_number: "3",
      latest_title: "The long view",
      latest_line: "A street of oaks.",
      latest_url: "javascript:alert(1)",
    };
    const { html, text } = await render(strings);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("The first issue of Place Notes is being prepared.");
    expect(text).not.toContain("javascript:");
  });

  it("gives a working unsubscribe link to the house's address, and none when the site has no address", async () => {
    const strings = {
      ...emptySlot,
      what_you_receive: "Place Notes will reach you.",
      market_names: "",
    };
    const { html } = await render(strings);
    expect(html).toContain('href="mailto:hello@matterofplace.com?subject=Unsubscribe"');
    expect(html).not.toContain("RESEND_UNSUBSCRIBE_URL");
    const bare = await render(strings, { ...site, contact: { email: null } });
    expect(bare.html).not.toContain(">Unsubscribe<");
  });

  it("equals the row its migration inserts", () => {
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261015055708_newsletter_welcome_template.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const values =
      /values \(\s*'(\w+)', '(\w+)', '((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'(\[[\s\S]*?\])',\s*'\{([^}]*)\}', true\s*\)/.exec(
        sql,
      );
    const unquote = (value: string | undefined): string => (value ?? "").replaceAll("''", "'");
    expect(values).not.toBeNull();
    const [, key, kind, subject, preheader, body, variables] = values ?? [];
    expect({
      key,
      class: kind,
      subject: unquote(subject),
      preheader: unquote(preheader),
      blocks: emailTemplateSchema.shape.body.parse(JSON.parse(unquote(body))),
      variables: (variables ?? "").split(","),
    }).toEqual({
      key: definition.key,
      class: definition.class,
      subject: definition.subject,
      preheader: definition.preheader,
      blocks: definition.blocks,
      variables: [...definition.variables],
    });
  });
});
