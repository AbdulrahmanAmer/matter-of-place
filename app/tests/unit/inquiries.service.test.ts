import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import {
  assign,
  close,
  forward,
  getInquiry,
  listAssignees,
  listInquiries,
} from "../../src/server/inquiries/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// Screen 11 (B7 step 11): one database call per function after `authorize`; commercial reads and never acts (S26).

const INQUIRY = "00000000-0000-4000-8000-0000000000f1";
const EDITOR = "00000000-0000-4000-8000-0000000000f2";
const JOB = "00000000-0000-4000-8000-0000000000f3";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-inquiries",
});

const editor = actor(["managing_editor"]);
const commercial = actor(["commercial"]);
const audit = {
  p_actor: editor.userId,
  p_actor_kind: "human",
  p_request_id: "req-inquiries",
};

/** No step module for anything: what the registry answers before B15 registers `webhook_omnikom`. */
const noSteps = () => undefined;
const allSteps = () => ({});

// The shape `list_inquiries` returns and `inquiries` holds.
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  intent: "showing" as const,
  topic: null,
  subject_kind: "property",
  subject_slug: "montecito-1a2b3c4d",
  subject_title: "A House on the Hill",
  name: "Ana Fixture",
  email: "ana@example.test",
  phone: null,
  location: null,
  message: "May we see it on Saturday?",
  details: {},
  source_path: "/property/montecito-1a2b3c4d",
  state: "new" as const,
  received_at: `2026-10-0${String(n)}T12:00:00.123456+00:00`,
  forwarded_at: null,
  assigned_to: null,
  anonymised_at: null,
  forwarded_payload: null,
  ip_hash: "hash",
  turnstile_ok: true,
  attribution: {},
});

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("listInquiries", () => {
  it("lists one page for commercial in one list_inquiries call and says whether Forward works", async () => {
    const db = fakeDb({ rpc: { list_inquiries: () => [row(1)] } });
    const answer = await listInquiries(commercial, db, { limit: 50, state: "new" }, noSteps);
    expect({ answer, calls: db.calls }).toEqual({
      answer: {
        items: [expect.not.objectContaining({ ip_hash: "hash" })],
        next_cursor: null,
        forward_available: false,
      },
      calls: [{ kind: "rpc", name: "list_inquiries", args: [{ p_limit: 51, p_state: "new" }] }],
    });
  });

  it("gives a full page the cursor of its last row and hands it back as id and received_at", async () => {
    const first = fakeDb({ rpc: { list_inquiries: () => [row(1), row(2), row(3)] } });
    const page = await listInquiries(editor, first, { limit: 2 }, allSteps);
    const second = fakeDb({ rpc: { list_inquiries: () => [] } });
    await listInquiries(editor, second, {
      limit: 2,
      ...(page.next_cursor === null ? {} : { cursor: page.next_cursor }),
    });
    expect({ ids: page.items.map((item) => item.id), args: second.calls[0]?.args }).toEqual({
      ids: [row(1).id, row(2).id],
      args: [{ p_limit: 3, p_after_id: row(2).id, p_after_received_at: row(2).received_at }],
    });
  });

  it("refuses a cursor it did not make with 422 and no database call", async () => {
    const db = fakeDb();
    const answer = await outcome(listInquiries(editor, db, { limit: 50, cursor: "x' or 1=1" }));
    expect({ answer, calls: db.calls }).toEqual({
      answer: { status: 422, code: "validation" },
      calls: [],
    });
  });
});

describe("getInquiry", () => {
  it("answers forward_available false with a registry that lacks webhook_omnikom, true with one that has it", async () => {
    const db = withTables(fakeDb(), { inquiries: [row(1), row(2)] });
    const off = await getInquiry(commercial, db, row(2).id, noSteps);
    const on = await getInquiry(commercial, db, row(2).id, allSteps);
    expect([off.id, off.forward_available, on.forward_available]).toEqual([row(2).id, false, true]);
  });

  it("answers 404 for an id with no row", async () => {
    const db = withTables(fakeDb(), { inquiries: [row(1)] });
    expect(await outcome(getInquiry(editor, db, INQUIRY))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});

describe("listAssignees", () => {
  it("lists each enabled human editor once, by name, and no other role", async () => {
    const db = withTables(fakeDb(), {
      user_roles: [
        {
          user_id: "u-b",
          role: "chief_editor",
          actor_kind: "human",
          display_name: "Bea",
          disabled_at: null,
        },
        {
          user_id: "u-b",
          role: "managing_editor",
          actor_kind: "human",
          display_name: "Bea",
          disabled_at: null,
        },
        {
          user_id: "u-a",
          role: "managing_editor",
          actor_kind: "human",
          display_name: "Al",
          disabled_at: null,
        },
        {
          user_id: "u-c",
          role: "managing_editor",
          actor_kind: "human",
          display_name: "Cy",
          disabled_at: "2026-10-01T00:00:00Z",
        },
        {
          user_id: "u-d",
          role: "chief_editor",
          actor_kind: "agent",
          display_name: "Bot",
          disabled_at: null,
        },
        {
          user_id: "u-e",
          role: "commercial",
          actor_kind: "human",
          display_name: "Ed",
          disabled_at: null,
        },
      ],
    });
    expect(await listAssignees(commercial, db)).toEqual({
      items: [
        { id: "u-a", name: "Al" },
        { id: "u-b", name: "Bea" },
      ],
    });
  });
});

describe("assign, forward and close", () => {
  it("assign answers in_progress from assign_inquiry, called with the inquiry, the editor and the actor", async () => {
    const db = fakeDb({ rpc: { assign_inquiry: () => "in_progress" } });
    const answer = await assign(editor, db, INQUIRY, EDITOR);
    expect({ answer, calls: db.calls }).toEqual({
      answer: { state: "in_progress" },
      calls: [
        {
          kind: "rpc",
          name: "assign_inquiry",
          args: [{ p_inquiry_id: INQUIRY, p_assignee: EDITOR, ...audit }],
        },
      ],
    });
  });

  it("close answers closed from close_inquiry", async () => {
    const db = fakeDb({ rpc: { close_inquiry: () => "closed" } });
    const answer = await close(editor, db, INQUIRY);
    expect({ answer, args: db.calls[0]?.args }).toEqual({
      answer: { state: "closed" },
      args: [{ p_inquiry_id: INQUIRY, ...audit }],
    });
  });

  it("forward answers the job forward_inquiry queued, and enqueue_failed as 503", async () => {
    const queued = fakeDb({ rpc: { forward_inquiry: () => JOB } });
    const refused = fakeDb({ rpc: { forward_inquiry: () => new Error("enqueue_failed") } });
    expect([
      await forward(editor, queued, INQUIRY),
      await outcome(forward(editor, refused, INQUIRY)),
    ]).toEqual([{ job_id: JOB }, { status: 503, code: "enqueue_failed" }]);
  });

  it("commercial gets 403 on assign, forward and close, and no database call", async () => {
    const db = fakeDb();
    expect({
      answers: [
        await outcome(assign(commercial, db, INQUIRY, EDITOR)),
        await outcome(forward(commercial, db, INQUIRY)),
        await outcome(close(commercial, db, INQUIRY)),
      ],
      calls: db.calls,
    }).toEqual({
      answers: [
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
      ],
      calls: [],
    });
  });
});
