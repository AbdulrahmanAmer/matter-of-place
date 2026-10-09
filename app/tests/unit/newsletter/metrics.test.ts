import { describe, expect, it } from "vitest";
import {
  aggregateIssueMetrics,
  aggregateRecentIssues,
} from "../../../src/server/newsletter/metrics";
import { newsletterDb, uuid, type Row } from "../../fixtures/newsletter-world";

// B11 Files, metrics.ts: an issue's numbers come from the `email_events` rows of its broadcast only, each provider
// event once, clicks per property by the `utm_content` slug the UTM helper wrote, and unsubscribes between this
// issue and the next. The write goes through `newsletter_set_metrics`.

const NOW = new Date("2026-10-07T12:00:00.000Z");
const ISSUE = uuid(900);

const issue = (
  n: number,
  sentAt: string | null,
  broadcast: string | null = `br_${String(n)}`,
): Row => ({
  id: uuid(900 + n),
  number: n,
  sent_at: sentAt,
  resend_broadcast_id: broadcast,
});

const link = (slug: string) =>
  `https://matterofplace.com/property/${slug}?utm_source=place_notes&utm_medium=email&utm_campaign=issue-1&utm_content=${slug}`;

let eventId = 0;
const event = (type: string, data: Row = {}, broadcast = "br_0"): Row => {
  eventId += 1;
  return { provider_event_id: `evt_${String(eventId)}`, type, broadcast_id: broadcast, data };
};

function world(tables: Record<string, Row[]>) {
  const stored: { issue: unknown; metrics: unknown }[] = [];
  const { db } = newsletterDb(
    {
      newsletter_issues: [issue(0, "2026-10-04T09:00:00.000Z")],
      email_events: [],
      subscribers: [],
      properties: [
        { id: uuid(1), slug: "oak-hill" },
        { id: uuid(2), slug: "the-quiet-street" },
      ],
      ...tables,
    },
    {
      newsletter_set_metrics: (args) => {
        stored.push({ issue: args["p_issue"], metrics: args["p_metrics"] });
        return null;
      },
    },
  );
  return { db, stored };
}

describe("aggregateIssueMetrics", () => {
  it("counts the delivered, bounced and clicked events of the issue's broadcast only", async () => {
    const { db, stored } = world({
      email_events: [
        event("email.delivered"),
        event("email.delivered"),
        event("email.delivered"),
        event("email.bounced"),
        event("email.clicked", { link: link("oak-hill") }),
        event("email.delivered", {}, "br_other"),
      ],
    });
    const metrics = await aggregateIssueMetrics(db, uuid(900));
    expect(metrics).toMatchObject({ delivered: 3, bounced: 1, clicked: 1, opened: 0 });
    expect(stored).toEqual([{ issue: uuid(900), metrics }]);
  });

  it("counts a replayed event id once", async () => {
    const delivered = event("email.delivered");
    const once = await aggregateIssueMetrics(world({ email_events: [delivered] }).db, uuid(900));
    const twice = await aggregateIssueMetrics(
      world({ email_events: [delivered, { ...delivered }] }).db,
      uuid(900),
    );
    expect(twice).toEqual(once);
    expect(twice?.delivered).toBe(1);
  });

  it("puts clicks in per_property by the utm_content slug, and leaves a story's slug out", async () => {
    const { db } = world({
      email_events: [
        event("email.clicked", { link: link("oak-hill") }),
        event("email.clicked", { link: link("oak-hill") }),
        event("email.clicked", { link: link("the-quiet-street") }),
        event("email.clicked", { link: link("under-the-oaks") }),
      ],
    });
    expect((await aggregateIssueMetrics(db, uuid(900)))?.per_property).toEqual({
      "oak-hill": 2,
      "the-quiet-street": 1,
    });
  });

  it("counts the unsubscribes between this issue's send and the next issue's", async () => {
    const { db } = world({
      newsletter_issues: [
        issue(0, "2026-10-04T09:00:00.000Z"),
        issue(1, "2026-10-06T09:00:00.000Z"),
      ],
      subscribers: [
        { unsubscribed_at: "2026-10-03T09:00:00.000Z" },
        { unsubscribed_at: "2026-10-05T09:00:00.000Z" },
        { unsubscribed_at: "2026-10-05T10:00:00.000Z" },
        { unsubscribed_at: "2026-10-06T10:00:00.000Z" },
        { unsubscribed_at: null },
      ],
    });
    expect((await aggregateIssueMetrics(db, uuid(900)))?.unsubscribed).toBe(2);
  });

  it("writes nothing for an issue that has not been sent", async () => {
    const { db, stored } = world({ newsletter_issues: [issue(0, null, null)] });
    expect(await aggregateIssueMetrics(db, uuid(900))).toBeNull();
    expect(stored).toEqual([]);
  });
});

describe("aggregateRecentIssues", () => {
  it("aggregates a 3-day-old issue and skips a 15-day-old one", async () => {
    const { db, stored } = world({
      newsletter_issues: [
        issue(0, "2026-10-04T12:00:00.000Z"),
        issue(1, "2026-09-22T12:00:00.000Z"),
      ],
    });
    expect(await aggregateRecentIssues(db, NOW)).toEqual({ issues: 1 });
    expect(stored.map(({ issue: id }) => id)).toEqual([ISSUE]);
  });
});
