import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAdminRecipients } from "../../../src/server/email/context";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { kpiWeekly } from "../../../src/server/jobs/system/kpi-weekly";
import type { JsonObject } from "../../../src/server/jobs/types";
import { kpiDefinitions, type KpiWeek } from "../../../src/server/kpi/definitions";
import { renderCeoWeekly } from "../../../src/templates/email/ceo-weekly";
import { emailEnv, emailWorld, failure, fakeFetch, NOW, stepCtx } from "../../fixtures/email-send";

vi.mock("../../../src/server/email/context", { spy: true });

// B11 invariant 12: the CEO's weekly email. B5's real `sendOne` and the real renderer run against the email world.

const EM_DASH = String.fromCodePoint(0x2014);
const RECIPIENTS = ["admin@matterofplace.com", "ceo@matterofplace.com"];
const SITE = {
  siteUrl: "https://matterofplace.com",
  entity: "Sample legal entity",
  address: "Sample postal address",
  contact: { email: null },
};

function week(weekStart: string, overrides: Partial<KpiWeek> = {}): KpiWeek {
  return {
    week_start: weekStart,
    week_end: weekStart === "2026-09-21" ? "2026-09-27" : "2026-09-20",
    submissions_received: 3,
    decisions: { accepted: 1, declined: 1 },
    time_to_decision_hours: 20,
    invoices: { issued: 1, issued_amount: 2500, paid: 0, paid_amount: 0 },
    properties_published: 2,
    posts_by_channel: { linkedin: 1 },
    newsletter: { confirmed: 2, unsubscribed: 0, net: 2, total_confirmed: 40 },
    inquiries: {
      received: 5,
      published_properties: 2,
      top: [{ slug: "the-glass-pavilion", title: "The Glass Pavilion", count: 2 }],
    },
    ...overrides,
  };
}

const CURRENT = week("2026-09-21");
const PREVIOUS = week("2026-09-14", { submissions_received: 1, properties_published: 0 });

function world() {
  const asked: string[] = [];
  const email = emailWorld({
    rpc: {
      kpi_weekly: ({ p_week_start }) => {
        asked.push(p_week_start);
        return p_week_start === "2026-09-14" ? PREVIOUS : week(p_week_start);
      },
    },
  });
  return { ...email, asked };
}

const run = (db: ReturnType<typeof world>["db"], data: JsonObject = {}) =>
  kpiWeekly.run(stepCtx(db, { type: "kpi_weekly" }), {}, data);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  emailEnv();
  vi.mocked(resolveAdminRecipients).mockResolvedValue(RECIPIENTS);
});

afterEach(() => {
  vi.mocked(resolveAdminRecipients).mockReset();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ceo weekly email", () => {
  it("lists all eight KPIs with a change against the prior week, with no em dash", async () => {
    const email = await renderCeoWeekly({ current: CURRENT, previous: PREVIOUS }, SITE);
    for (const { label } of kpiDefinitions) {
      expect(email.html).toContain(label);
      expect(email.text).toContain(`${label}: `);
    }
    expect(email.text).toContain("Submissions received: 3 (+2)");
    expect(email.text).toContain("Properties published: 2 (+2)");
    expect(email.text).toContain("Acceptance rate: 1 of 2 (prior week 1 of 2)");
    expect(email.html).toContain("Change");
    expect(email.subject).toBe("The week in numbers: September 21, 2026");
    expect(
      [email.subject, email.preheader, email.html, email.text].join("").includes(EM_DASH),
    ).toBe(false);
  });

  it("lists the properties asked about most and the footer lines", async () => {
    const email = await renderCeoWeekly({ current: CURRENT, previous: PREVIOUS }, SITE);
    expect(email.text).toContain("The Glass Pavilion: 2");
    expect(email.html).toContain("The Glass Pavilion");
    expect(email.text).toContain("Sample legal entity");
  });
});

describe("kpi_weekly", () => {
  it("is registered with twelve attempts", () => {
    expect(getSystemJob("kpi_weekly")).toBe(kpiWeekly);
    expect(kpiWeekly.maxAttempts).toBe(12);
  });

  it("mails the last full week to every admin recipient, one kpi_weekly alert row each", async () => {
    const resend = fakeFetch();
    const { db, messages, asked } = world();
    expect((await run(db)).status).toBe("done");
    // NOW is Monday 2026-10-05 10:30 in New York, so the last full week began on 2026-09-28.
    expect([...asked].sort()).toEqual(["2026-09-21", "2026-09-28"]);
    expect(resend.requests.map(({ body }) => body.to)).toEqual(RECIPIENTS.map((to) => [to]));
    expect(messages.map((row) => [row.to_email, row.template_key, row.kind])).toEqual(
      RECIPIENTS.map((to) => [to, "kpi_weekly", "alert"]),
    );
  });

  it("sends the chosen week to the one address of data.to", async () => {
    const resend = fakeFetch();
    const { db, messages, asked } = world();
    await run(db, { week_start: "2026-09-21", to: "owner@matterofplace.com" });
    expect([...asked].sort()).toEqual(["2026-09-14", "2026-09-21"]);
    expect(resend.requests.map(({ body }) => body.to)).toEqual([["owner@matterofplace.com"]]);
    expect(resend.requests[0]?.body.text).toContain("Submissions received: 3 (+2)");
    expect(messages).toHaveLength(1);
    expect(vi.mocked(resolveAdminRecipients)).not.toHaveBeenCalled();
  });

  it("with EMAIL_DRY_RUN=1 ends with a skipped dry_run message row", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const resend = fakeFetch();
    const { db, messages } = world();
    await run(db, { week_start: "2026-09-21", to: "owner@matterofplace.com" });
    expect(resend.requests).toHaveLength(0);
    expect(messages).toMatchObject([
      { template_key: "kpi_weekly", status: "skipped", error: "dry_run" },
    ]);
  });

  it("kpi_weekly runs twice without a second outside effect", async () => {
    const resend = fakeFetch();
    const { db, messages } = world();
    await run(db);
    await run(db);
    expect(resend.requests).toHaveLength(RECIPIENTS.length);
    expect(resend.deliveries()).toBe(RECIPIENTS.length);
    expect(messages).toHaveLength(RECIPIENTS.length);
  });

  it("ends dead on a week_start that is not a Monday", async () => {
    fakeFetch();
    const { db, asked } = world();
    expect(await failure(run(db, { week_start: "2026-09-22" }))).toEqual({
      dead: true,
      message: "kpi_input_invalid",
    });
    expect(asked).toEqual([]);
  });
});
