import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAdminRecipients } from "../../../src/server/email/context";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { newsletterPreview } from "../../../src/server/jobs/system/newsletter-preview";
import type { JsonObject } from "../../../src/server/jobs/types";
import {
  emailEnv,
  emailWorld,
  failure,
  fakeFetch,
  NOW,
  PRODUCTION_SHARE,
  stepCtx,
} from "../../fixtures/email-send";
import { issueRow, uuid } from "../../fixtures/newsletter-world";

vi.mock("../../../src/server/email/context", { spy: true });

// B11 invariant 11 (GG-06): the preview of an approved issue goes to the admin recipients 24 hours ahead, and screen 13's
// send test uses the same handler for one address. B5's real `sendOne` and the real renderer run against the email world.

const ISSUE = uuid(900);
const RECIPIENTS = ["admin@matterofplace.com", "ceo@matterofplace.com"];
const INTRO = [{ id: "intro:1", type: "intro", text: "A note before the houses." }];

const issue = (values: Record<string, unknown> = {}) => ({
  ...issueRow({
    id: ISSUE,
    number: 1,
    status: "approved",
    blocks: INTRO,
    subject: "Place Notes No. 1",
    preheader: "Three places",
  }),
  approval_count: 2,
  resend_broadcast_id: null,
  ...values,
});

function world(row: Record<string, unknown> | null = issue()) {
  return emailWorld({
    share: PRODUCTION_SHARE,
    tables: {
      newsletter_issues: row === null ? [] : [row],
      properties: [],
      stories: [],
      assets: [],
    },
  });
}

const run = (db: ReturnType<typeof world>["db"], data: JsonObject) =>
  newsletterPreview.run(stepCtx(db, { type: "newsletter_preview" }), {}, data);

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

describe("newsletter_preview", () => {
  it("is registered with twelve attempts", () => {
    expect(getSystemJob("newsletter_preview")).toBe(newsletterPreview);
    expect(newsletterPreview.maxAttempts).toBe(12);
  });

  it("sends the issue to every admin recipient with the Preview: subject, one bulk message each", async () => {
    const resend = fakeFetch();
    const { db, messages } = world();
    const answer = await run(db, { issue_id: ISSUE, approval_count: 2 });
    expect(answer.status).toBe("done");
    expect(resend.requests.map(({ body }) => body.to)).toEqual(RECIPIENTS.map((to) => [to]));
    for (const { body } of resend.requests) {
      expect(body.subject).toBe("Preview: Place Notes No. 1");
      expect(body.html).toContain("A note before the houses.");
    }
    expect(messages.map((row) => [row.to_email, row.template_key, row.kind, row.subject])).toEqual(
      RECIPIENTS.map((to) => [to, "newsletter_preview", "bulk", "Preview: Place Notes No. 1"]),
    );
  });

  it("ends stale without sending after an unapprove", async () => {
    const resend = fakeFetch();
    const { db, messages } = world(issue({ status: "draft" }));
    expect(await run(db, { issue_id: ISSUE, approval_count: 2 })).toEqual({
      status: "done",
      result: { skipped: "stale" },
    });
    expect([resend.requests, messages]).toEqual([[], []]);
  });

  it("ends stale without sending after a second approval raised approval_count", async () => {
    const resend = fakeFetch();
    const { db, messages } = world(issue({ approval_count: 3 }));
    expect(await run(db, { issue_id: ISSUE, approval_count: 2 })).toEqual({
      status: "done",
      result: { skipped: "stale" },
    });
    expect([resend.requests, messages]).toEqual([[], []]);
  });

  it("ends stale when the issue is gone", async () => {
    const resend = fakeFetch();
    expect(await run(world(null).db, { issue_id: ISSUE, approval_count: 2 })).toEqual({
      status: "done",
      result: { skipped: "stale" },
    });
    expect(resend.requests).toEqual([]);
  });

  it("throws no_recipients, dead, when the recipient list is empty", async () => {
    vi.mocked(resolveAdminRecipients).mockResolvedValue([]);
    const resend = fakeFetch();
    expect(await failure(run(world().db, { issue_id: ISSUE, approval_count: 2 }))).toEqual({
      dead: true,
      message: "no_recipients",
    });
    expect(resend.requests).toEqual([]);
  });

  it("sends a test only to data.to, with the [Test] subject and kind test, and reads no recipient list", async () => {
    const resend = fakeFetch();
    const { db, messages } = world(issue({ status: "draft", approval_count: 0 }));
    await run(db, { issue_id: ISSUE, test: true, to: "editor@matterofplace.com" });
    expect(resend.requests.map(({ body }) => [body.to, body.subject])).toEqual([
      [["editor@matterofplace.com"], "[Test] Place Notes No. 1"],
    ]);
    expect(messages.map((row) => [row.template_key, row.kind])).toEqual([
      ["newsletter_preview", "test"],
    ]);
    expect(resolveAdminRecipients).not.toHaveBeenCalled();
  });

  it("is dead for a test of an issue that does not exist", async () => {
    expect(
      await failure(
        run(world(null).db, { issue_id: ISSUE, test: true, to: "editor@matterofplace.com" }),
      ),
    ).toEqual({ dead: true, message: "issue_missing" });
  });

  it("is dead when the job names no issue", async () => {
    expect(await failure(run(world().db, { approval_count: 2 }))).toEqual({
      dead: true,
      message: "issue_id_missing",
    });
  });
});
