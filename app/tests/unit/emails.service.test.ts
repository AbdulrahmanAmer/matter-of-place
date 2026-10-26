import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { deliveryLine } from "../../src/domain/admin-emails";
import {
  listEmails,
  resendSubmissionEmail,
  submissionEmails,
} from "../../src/server/email/service";
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

const PAGE = { limit: 50 };
const reader = actor(["chief_editor"]);

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
      {
        resend_email_id: "re_1",
        type: "email.delivered",
        at: "2026-10-15T04:10:04.343Z",
        data: {},
      },
      {
        resend_email_id: "re_1",
        type: "email.bounced",
        at: "2026-10-15T04:10:07.200Z",
        data: { bounce_type: "Permanent" },
      },
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

  it("keeps the bounce type when the opens fill PostgREST's row cap (W7 item 1 review)", async () => {
    const opens = Array.from({ length: 1001 }, (_, index) => ({
      resend_email_id: "re_1",
      type: "email.opened",
      // dated before the bounce, so one query of both kinds, oldest first, would fill the cap with opens alone
      at: `2026-10-15T03:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      data: {},
    }));
    const db = withTables(
      fakeDb(),
      {
        submissions: [{ id: REQUEST, submitter_email: ADDRESS }],
        email_messages: [message()],
        email_events: [
          ...opens,
          {
            resend_email_id: "re_1",
            type: "email.bounced",
            at: "2026-10-15T04:10:07.200Z",
            data: { bounce_type: "Permanent" },
          },
        ],
        email_suppressions: [],
      },
      { maxRows: 1000 },
    );
    const [item] = (await submissionEmails(editor, db, { id: REQUEST })).items;
    expect(item?.bounce_type).toBe("Permanent");
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
    const view = await listEmails(actor(["chief_editor"]), fairfield(), PAGE);
    expect(view.items).toHaveLength(2);
    expect(view.suppressions.map((row) => row.reason)).toEqual(["bounce"]);
    expect(await outcome(listEmails(commercial, fairfield(), PAGE))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });
});

// Three emails, newest first: ONE (bounced), TWO (delivered, opened twice) and THREE (skipped, another address).
const ONE = "00000000-0000-4000-8000-0000000000a1";
const TWO = "00000000-0000-4000-8000-0000000000a2";
const THREE = "00000000-0000-4000-8000-0000000000a3";

const log = () =>
  withTables(fakeDb(), {
    email_messages: [
      message({ id: ONE, resend_id: "re_a", created_at: "2026-10-15T12:00:00.000Z" }),
      message({
        id: TWO,
        resend_id: "re_b",
        status: "delivered",
        created_at: "2026-10-15T11:00:00.000Z",
      }),
      message({
        id: THREE,
        resend_id: null,
        to_email: "owner@example.com",
        status: "skipped",
        error: "suppressed",
        created_at: "2026-10-15T10:00:00.000Z",
      }),
    ],
    email_events: [
      {
        resend_email_id: "re_a",
        type: "email.bounced",
        at: "2026-10-15T12:00:05.000Z",
        data: { bounce_type: "Permanent" },
      },
      { resend_email_id: "re_b", type: "email.opened", at: "2026-10-15T11:30:00.000Z", data: {} },
      { resend_email_id: "re_b", type: "email.opened", at: "2026-10-15T11:05:00.000Z", data: {} },
      {
        resend_email_id: "re_b",
        type: "email.delivered",
        at: "2026-10-15T11:00:02.000Z",
        data: {},
      },
    ],
    email_suppressions: [{ email: ADDRESS, reason: "bounce", at: "2026-10-15T12:00:07.000Z" }],
  });

describe("the log of every email sent", () => {
  it("lists the newest first with each one's bounce, first open and do-not-send state", async () => {
    const { items } = await listEmails(reader, log(), PAGE);
    expect(items.map((item) => item.id)).toEqual([ONE, TWO, THREE]);
    expect(items.map((item) => [item.bounce_type, item.opened_at, item.suppressed])).toEqual([
      ["Permanent", null, true],
      [null, "2026-10-15T11:05:00.000Z", true],
      [null, null, false],
    ]);
  });

  it("pages with the cursor it gives, and ends with none", async () => {
    const first = await listEmails(reader, log(), { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([ONE, TWO]);
    expect(first.next_cursor).toBe(`2026-10-15T11:00:00.000Z~${TWO}`);
    const last = await listEmails(reader, log(), { limit: 2, cursor: first.next_cursor ?? "" });
    expect(last.items.map((item) => item.id)).toEqual([THREE]);
    expect(last.next_cursor).toBeNull();
  });

  it("goes on from an email created at the same instant as the last one of the page before", async () => {
    const [low, mid, high] = [ONE, TWO, THREE]; // their ids, smallest first
    const db = withTables(fakeDb(), {
      email_messages: [low, mid, high].map((id) => message({ id, resend_id: null })),
      email_events: [],
      email_suppressions: [],
    });
    const first = await listEmails(reader, db, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([high, mid]);
    const rest = await listEmails(reader, db, { limit: 2, cursor: first.next_cursor ?? "" });
    expect(rest.items.map((item) => item.id)).toEqual([low]);
  });

  it("keeps the state and the address asked for on the page after the cursor", async () => {
    const first = await listEmails(reader, log(), { limit: 1, status: "skipped" });
    expect(first.items.map((item) => item.id)).toEqual([THREE]);
    expect(first.next_cursor).toBeNull();
    const byAddress = await listEmails(reader, log(), {
      limit: 1,
      search: ADDRESS.toUpperCase(),
    });
    expect(byAddress.items.map((item) => item.id)).toEqual([ONE]);
    const rest = await listEmails(reader, log(), {
      limit: 1,
      search: ADDRESS,
      cursor: byAddress.next_cursor ?? "",
    });
    expect(rest.items.map((item) => item.id)).toEqual([TWO]);
    expect(rest.next_cursor).toBeNull();
  });

  it("refuses a cursor that is not one the list gave", async () => {
    expect(await outcome(listEmails(reader, log(), { ...PAGE, cursor: "tomorrow" }))).toEqual({
      status: 422,
      code: "validation",
    });
  });
});

describe("what became of an email, in one sentence", () => {
  it("says a delivered email was opened when an open came, and not before", async () => {
    const { items } = await listEmails(reader, log(), PAGE);
    const delivered = items.find((item) => item.id === TWO);
    if (delivered === undefined) throw new Error("no delivered email");
    expect(deliveryLine(delivered)).toBe("The confirmation was delivered and opened.");
    expect(deliveryLine({ ...delivered, opened_at: null })).toBe("The confirmation was delivered.");
  });

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
      opened_at: null,
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
