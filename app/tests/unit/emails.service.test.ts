import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { deliveryLine } from "../../src/domain/admin-emails";
import { listEmails, resendSubmissionEmail, submissionEmails } from "../../src/server/email/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W9 item 2: the emails about a request and what became of them, shaped like the Fairfield submission of
// 2026-10-15 (its confirmation bounced, Permanent, and the address went on the do-not-send list).

const REQUEST = "4a3c2563-c07a-481d-839b-ad0523827f69";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const MESSAGE = "c92fcbb1-f62e-4fb8-b186-744307f18dc2";
const JOB = "00000000-0000-4000-8000-0000000000e3";
const ADDRESS = "agent@brokerage.example";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-emails",
});

const editor = actor(["managing_editor"]);
const commercial = actor(["commercial"]);

const message = (over: Record<string, unknown> = {}) => ({
  id: MESSAGE,
  template_key: "received",
  to_email: ADDRESS,
  status: "bounced",
  error: null,
  entity: "submission",
  entity_id: REQUEST,
  created_at: "2026-10-15T04:10:03.019Z",
  sent_at: "2026-10-15T04:10:03.202Z",
  delivered_at: "2026-10-15T04:10:04.343Z",
  resend_id: "re_1",
  ...over,
});

const fairfield = () =>
  withTables(fakeDb(), {
    submissions: [
      { id: REQUEST, submitter_email: ADDRESS },
      { id: OTHER, submitter_email: "owner@example.com" },
    ],
    email_messages: [
      message(),
      message({ id: "00000000-0000-4000-8000-0000000000e4", entity_id: OTHER, resend_id: "re_2" }),
    ],
    email_events: [
      { resend_email_id: "re_1", type: "email.delivered", data: {} },
      { resend_email_id: "re_1", type: "email.bounced", data: { bounce_type: "Permanent" } },
    ],
    email_suppressions: [{ email: ADDRESS, reason: "bounce", at: "2026-10-15T04:10:07.215Z" }],
  });

async function outcome(promise: Promise<unknown>) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("the emails about a request", () => {
  it("lists only this request's emails, with the bounce type and the do-not-send state", async () => {
    const view = await submissionEmails(commercial, fairfield(), { id: REQUEST });
    expect(view.address).toBe(ADDRESS);
    expect(view.suppression).toEqual({
      email: ADDRESS,
      reason: "bounce",
      at: "2026-10-15T04:10:07.215Z",
    });
    expect(view.items.map((item) => [item.id, item.bounce_type, item.suppressed])).toEqual([
      [MESSAGE, "Permanent", true],
    ]);
  });

  it("reads the Fairfield bounce plainly", async () => {
    const [bounced] = (await submissionEmails(editor, fairfield(), { id: REQUEST })).items;
    expect(bounced === undefined ? "" : deliveryLine(bounced)).toBe(
      "The confirmation bounced: this mailbox does not exist.",
    );
  });

  it("answers 404 for a request that does not exist", async () => {
    expect(await outcome(submissionEmails(editor, fairfield(), { id: JOB }))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});

describe("sending an email again", () => {
  it("passes the request, the email and the corrected address to resend_submission_email and answers its job", async () => {
    const asked: unknown[] = [];
    const db = fakeDb({
      rpc: {
        resend_submission_email: (args) => {
          asked.push(args);
          return JOB;
        },
      },
    });
    const answer = await resendSubmissionEmail(editor, db, {
      id: REQUEST,
      message_id: MESSAGE,
      email: "agent@brokerage.com",
    });
    expect(answer).toEqual({ job_id: JOB });
    expect(asked).toEqual([
      {
        p_submission_id: REQUEST,
        p_message_id: MESSAGE,
        p_email: "agent@brokerage.com",
        p_actor: editor.userId,
        p_actor_kind: "human",
        p_request_id: "req-emails",
      },
    ]);
  });

  it("refuses a role that may only read, before any call", async () => {
    const db = fakeDb();
    expect(
      await outcome(
        resendSubmissionEmail(commercial, db, {
          id: REQUEST,
          message_id: MESSAGE,
          email: "a@b.co",
        }),
      ),
    ).toEqual({ status: 403, code: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it("answers the do-not-send refusal of the database as 409 with its words", async () => {
    const refusal = Object.assign(new Error("wrong_state"), {
      code: "P0001",
      details: "This address is on the do-not-send list. Ask for another address.",
      hint: null,
    });
    const db = fakeDb({ rpc: { resend_submission_email: () => refusal } });
    const thrown = await resendSubmissionEmail(editor, db, {
      id: REQUEST,
      message_id: MESSAGE,
      email: ADDRESS,
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown instanceof AppError ? [thrown.status, thrown.message] : []).toEqual([
      409,
      "This address is on the do-not-send list. Ask for another address.",
    ]);
  });
});

describe("the Sent emails screen", () => {
  it("lists every email with its delivery and the do-not-send list, for those who read the activity log", async () => {
    const view = await listEmails(actor(["chief_editor"]), fairfield(), {});
    expect(view.items).toHaveLength(2);
    expect(view.suppressions.map((row) => row.reason)).toEqual(["bounce"]);
    expect(await outcome(listEmails(commercial, fairfield(), {}))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("what became of an email, in one sentence", () => {
  it("names a transient bounce, a complaint, a skip and a failure plainly", () => {
    const base = {
      id: MESSAGE,
      template_key: "received",
      to_email: ADDRESS,
      error: null,
      bounce_type: null,
      entity: "submission",
      entity_id: REQUEST,
      created_at: "2026-10-15T04:10:03.019Z",
      sent_at: null,
      delivered_at: null,
      suppressed: false,
    };
    expect([
      deliveryLine({ ...base, status: "bounced", bounce_type: "Transient" }),
      deliveryLine({ ...base, template_key: "declined", status: "complained" }),
      deliveryLine({ ...base, status: "skipped", error: "suppressed" }),
      deliveryLine({ ...base, template_key: "x", status: "failed", error: "invalid_from" }),
    ]).toEqual([
      "The confirmation bounced: the mailbox could not take it for now.",
      "The decline letter was marked as spam by the person.",
      "The confirmation was not sent: this address is on the do-not-send list.",
      "The email could not be sent (invalid_from).",
    ]);
  });
});
