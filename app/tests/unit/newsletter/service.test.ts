import "../../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import type { AppRole } from "../../../src/server/lib/authz";
import { ForbiddenError } from "../../../src/server/lib/authz";
import { AppError } from "../../../src/server/lib/errors";
import {
  approveIssue,
  buildIssue,
  exportSubscribers,
  getIssue,
  listIssues,
  listSubscribers,
  previewIssue,
  sendTest,
  unapproveIssue,
  updateIssue,
} from "../../../src/server/newsletter/service";
import { emailEnv } from "../../fixtures/email-send";
import {
  issueRow,
  newsletterDb,
  storyBlock,
  storyRow,
  uuid,
  type Row,
} from "../../fixtures/newsletter-world";

// Screen 13's service (B11 Files, invariant 3, G27): each function authorizes first, then makes its one RPC or read.
// A send test is a job; nothing here reaches Resend.

const ISSUE = uuid(900);

const person = (role: AppRole, kind: AdminActor["kind"] = "human"): AdminActor => ({
  userId: `user-${role}`,
  kind,
  roles: [role],
  scopes: kind === "agent" ? ["newsletter"] : [],
  requestId: "req-1",
});

function world(tables: Record<string, Row[]> = {}) {
  return newsletterDb(
    { subscribers: [], ...tables },
    {
      newsletter_approve_issue: () => ({ id: ISSUE, status: "approved" }),
      newsletter_unapprove_issue: () => ({ id: ISSUE, status: "draft" }),
      newsletter_update_issue: () => ({ id: ISSUE, status: "draft" }),
      newsletter_save_draft: () => ({ id: ISSUE, number: 1 }),
      enqueue_job: () => "job-1",
      newsletter_export_subscribers: () => [
        {
          email: "reader1@gmail.com",
          markets: "california;florida",
          source: "footer",
          status: "confirmed",
          confirmed_at: "2026-10-01T00:00:00+00:00",
          unsubscribed_at: null,
        },
        {
          email: "=cmd@gmail.com",
          markets: "",
          source: "interest:california",
          status: "pending",
          confirmed_at: null,
          unsubscribed_at: null,
        },
      ],
    },
  );
}

const refusal = async (pending: Promise<unknown>) => {
  const error: unknown = await pending.catch((caught: unknown) => caught);
  return error instanceof ForbiddenError ? { status: error.status, code: error.code } : error;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const AUDIT = { p_actor: "user-managing_editor", p_actor_kind: "human", p_request_id: "req-1" };

const appError = async (pending: Promise<unknown>) => {
  const error: unknown = await pending.catch((caught: unknown) => caught);
  return error instanceof AppError ? { status: error.status, code: error.code } : error;
};

describe("newsletter service", () => {
  it("refuses an agent's approve with 403 human_only before any call", async () => {
    const { db, calls } = world();
    expect(
      await refusal(approveIssue(person("managing_editor", "agent"), db, { id: ISSUE })),
    ).toEqual({ status: 403, code: "human_only" });
    expect(calls).toEqual([]);
  });

  it("approves for a person through newsletter_approve_issue with the audit triple", async () => {
    const { db, rpcCalls } = world();
    await approveIssue(person("managing_editor"), db, {
      id: ISSUE,
      send_at: "2026-10-09T15:00:00.000Z",
    });
    expect(rpcCalls("newsletter_approve_issue").map(({ args }) => args[0])).toEqual([
      {
        p_issue: ISSUE,
        p_send_at: "2026-10-09T15:00:00.000Z",
        p_actor: "user-managing_editor",
        p_actor_kind: "human",
        p_request_id: "req-1",
      },
    ]);
  });

  it("queues one newsletter_preview job with data.test for a send test and calls no Resend function", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { db, rpcCalls } = world();
    await sendTest(person("media_ops", "agent"), db, { id: ISSUE, to: "editor@matterofplace.com" });
    const jobs = rpcCalls("enqueue_job").map(({ args }) => args[0]);
    expect(jobs).toMatchObject([
      {
        p_type: "newsletter_preview",
        p_payload: {
          params: {},
          data: { issue_id: ISSUE, test: true, to: "editor@matterofplace.com" },
        },
      },
    ]);
    expect(String(Reflect.get(Object(jobs[0]), "p_idempotency_key"))).toMatch(
      new RegExp(
        `^newsletter_preview:${ISSUE}:test:user-media_ops:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$`,
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists subscriber counts and no address", async () => {
    const row = (email: string, source: string, values: Row = {}) => ({
      email,
      source,
      markets: ["california"],
      confirmed_at: "2026-10-01T00:00:00.000Z",
      unsubscribed_at: null,
      archived_at: null,
      ...values,
    });
    const { db } = world({
      subscribers: [
        row("a@gmail.com", "footer"),
        row("b@gmail.com", "footer", { confirmed_at: null }),
        row("c@gmail.com", "footer", { unsubscribed_at: "2026-10-02T00:00:00.000Z" }),
        row("d@gmail.com", "interest:california"),
        row("x1@deleted.invalid", "footer"),
      ],
    });
    const counts = await listSubscribers(person("commercial"), db);
    expect(counts).toEqual({
      total: 4,
      confirmed: 2,
      pending: 1,
      unsubscribed: 1,
      interest_only: 1,
      audiences: { "place-notes": 1, "market-ca": 1, "market-ny": 0, "market-fl": 0 },
    });
    expect(JSON.stringify(counts)).not.toContain("@");
  });

  it("refuses commercial on the export with 403", async () => {
    const { db, calls } = world();
    expect(await refusal(exportSubscribers(person("commercial"), db))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(calls).toEqual([]);
  });

  it("exports a CSV for managing_editor through one newsletter_export_subscribers call", async () => {
    const { db, rpcCalls } = world();
    const csv = await exportSubscribers(person("managing_editor"), db);
    expect(csv.split("\r\n")).toEqual([
      "email,markets,source,status,confirmed_at,unsubscribed_at",
      "reader1@gmail.com,california;florida,footer,confirmed,2026-10-01T00:00:00+00:00,",
      "'=cmd@gmail.com,,interest:california,pending,,",
      "",
    ]);
    expect(rpcCalls("newsletter_export_subscribers").map(({ args }) => args[0])).toEqual([
      { p_actor: "user-managing_editor", p_actor_kind: "human", p_request_id: "req-1" },
    ]);
  });
});

describe("newsletter service, issues", () => {
  it("lists every issue, newest first", async () => {
    const { db } = world({
      newsletter_issues: [
        issueRow({ id: uuid(901), number: 1 }),
        issueRow({ id: uuid(902), number: 2 }),
      ],
    });
    const issues = await listIssues(person("visual_editor"), db);
    expect(issues.map(({ number }) => number)).toEqual([2, 1]);
  });

  it("answers 404 not_found for an issue that does not exist", async () => {
    const { db } = world();
    expect(await appError(getIssue(person("commercial"), db, { id: ISSUE }))).toEqual({
      status: 404,
      code: "not_found",
    });
  });

  it("builds the draft from a published story through newsletter_save_draft with the editor's audit triple", async () => {
    const { db, rpcCalls } = world({ stories: [storyRow(1)] });
    expect(await buildIssue(person("managing_editor"), db)).toEqual({ id: ISSUE, number: 1 });
    expect(rpcCalls("newsletter_save_draft").map(({ args }) => args[0])).toMatchObject([
      { p_blocks: [{ id: `story:${uuid(1)}` }], ...AUDIT },
    ]);
  });

  it("refuses to build an empty issue with 422 issue_empty and saves nothing", async () => {
    const { db, rpcCalls } = world();
    expect(await appError(buildIssue(person("managing_editor"), db))).toEqual({
      status: 422,
      code: "issue_empty",
    });
    expect(rpcCalls("newsletter_save_draft")).toEqual([]);
  });

  it("updates a draft through newsletter_update_issue with the editor's audit triple", async () => {
    const { db, rpcCalls } = world();
    const blocks = [storyBlock(1)];
    await updateIssue(person("managing_editor"), db, {
      id: ISSUE,
      blocks,
      subject: "Place Notes No. 1: Under the oaks",
      preheader: "A walk.",
    });
    expect(rpcCalls("newsletter_update_issue").map(({ args }) => args[0])).toEqual([
      {
        p_issue: ISSUE,
        p_blocks: blocks,
        p_subject: "Place Notes No. 1: Under the oaks",
        p_preheader: "A walk.",
        ...AUDIT,
      },
    ]);
  });

  it("previews the issue as a subscriber gets it, at the width of the phone frame", async () => {
    emailEnv();
    const { db } = world({
      newsletter_issues: [
        {
          ...issueRow({
            id: ISSUE,
            blocks: [storyBlock(1)],
            subject: "Place Notes No. 1: Under the oaks",
            preheader: "A walk.",
          }),
          approval_count: 0,
          resend_broadcast_id: null,
        },
      ],
      stories: [storyRow(1, { slug: "under-the-oaks" })],
      settings: [],
    });
    const preview = await previewIssue(person("commercial"), db, { id: ISSUE, viewport: "phone" });
    expect(preview.width).toBe(390);
    expect(preview.html).toContain("utm_content=under-the-oaks");
  });

  it("unapproves through newsletter_unapprove_issue with the editor's audit triple", async () => {
    const { db, rpcCalls } = world();
    await unapproveIssue(person("managing_editor"), db, { id: ISSUE });
    expect(rpcCalls("newsletter_unapprove_issue").map(({ args }) => args[0])).toEqual([
      { p_issue: ISSUE, ...AUDIT },
    ]);
  });
});
