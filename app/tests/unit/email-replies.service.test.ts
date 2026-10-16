import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { replyMarkInputSchema } from "../../src/domain/admin-emails";
import { listReplies, markReply } from "../../src/server/email/replies/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W7 item 2: the replies people wrote back to our email, each beside the email it answers, and the mark that settles it.

const REPLY = "5e1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f60";
const OLDER = "5e1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f61";
const ORPHAN = "5e1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f62";
const SENT = "c92fcbb1-f62e-4fb8-b186-744307f18dc2";
const ADDRESS = "agent@brokerage.example";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-replies",
});

const PAGE = { limit: 50 };

const reader = actor(["chief_editor"]);
const editor = actor(["managing_editor"]);

const reply = (over: Record<string, unknown> = {}) => ({
  id: REPLY,
  provider_id: "zoho-1",
  from_email: ADDRESS,
  from_name: "Dana Reyes",
  subject: "Re: About 12 Ocean Avenue",
  body: "Thursday works for the photographer.",
  received_at: "2026-10-15T09:00:00.000Z",
  send_id: SENT,
  entity: "submission",
  entity_id: "4a3c2563-c07a-481d-839b-ad0523827f69",
  owner_slug: "editor",
  state: "new",
  created_at: "2026-10-15T09:00:05.000Z",
  ...over,
});

const inbox = () =>
  withTables(fakeDb(), {
    email_replies: [
      reply({ id: OLDER, received_at: "2026-10-14T09:00:00.000Z", state: "answered" }),
      reply(),
      reply({
        id: ORPHAN,
        received_at: "2026-10-15T10:00:00.000Z",
        send_id: null,
        owner_slug: null,
        state: "seen",
      }),
    ],
    email_messages: [
      {
        id: SENT,
        template_key: "accepted",
        to_email: ADDRESS,
        created_at: "2026-10-13T08:00:00.000Z",
        sent_at: "2026-10-13T08:00:03.000Z",
      },
    ],
  });

async function outcome(promise: Promise<unknown>) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("the replies list", () => {
  it("lists the newest first, each beside the email it answers, and its owner and state", async () => {
    const { items } = await listReplies(reader, inbox(), PAGE);
    expect(items.map((item) => item.id)).toEqual([ORPHAN, REPLY, OLDER]);
    const [, answered] = items;
    expect(answered).toMatchObject({
      from_email: ADDRESS,
      subject: "Re: About 12 Ocean Avenue",
      body: "Thursday works for the photographer.",
      owner_slug: "editor",
      state: "new",
      sent: { id: SENT, template_key: "accepted", to_email: ADDRESS },
    });
  });

  it("shows a reply whose email is gone, with no email beside it and no owner", async () => {
    const { items } = await listReplies(reader, inbox(), PAGE);
    expect(items[0]).toMatchObject({ id: ORPHAN, sent: null, owner_slug: null });
  });

  it("keeps only the replies in the state asked for", async () => {
    const { items } = await listReplies(reader, inbox(), { ...PAGE, state: "answered" });
    expect(items.map((item) => item.id)).toEqual([OLDER]);
  });

  it("pages the newest first: a page of two, then the page after its cursor, and no cursor on the last page", async () => {
    const first = await listReplies(reader, inbox(), { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([ORPHAN, REPLY]);
    expect(first.next_cursor).toBe(`2026-10-15T09:00:00.000Z~${REPLY}`);
    const last = await listReplies(reader, inbox(), { limit: 2, cursor: first.next_cursor ?? "" });
    expect(last.items.map((item) => item.id)).toEqual([OLDER]);
    expect(last.next_cursor).toBeNull();
  });

  it("goes on from a reply that came in at the same instant as the last one of the page before", async () => {
    const [low, mid, high] = [REPLY, OLDER, ORPHAN]; // their ids, smallest first
    const db = withTables(fakeDb(), {
      email_replies: [low, mid, high].map((id) => reply({ id, send_id: null })),
      email_messages: [],
    });
    const first = await listReplies(reader, db, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([high, mid]);
    const rest = await listReplies(reader, db, { limit: 2, cursor: first.next_cursor ?? "" });
    expect(rest.items.map((item) => item.id)).toEqual([low]);
  });

  it("keeps the state asked for on the page after the cursor", async () => {
    const db = withTables(fakeDb(), {
      email_replies: [
        reply({ id: ORPHAN, received_at: "2026-10-15T10:00:00.000Z", send_id: null }),
        reply({ id: REPLY, state: "seen", send_id: null }),
        reply({ id: OLDER, received_at: "2026-10-14T09:00:00.000Z", send_id: null }),
      ],
      email_messages: [],
    });
    const first = await listReplies(reader, db, { limit: 1, state: "new" });
    expect(first.items.map((item) => item.id)).toEqual([ORPHAN]);
    const rest = await listReplies(reader, db, {
      limit: 1,
      state: "new",
      cursor: first.next_cursor ?? "",
    });
    expect(rest.items.map((item) => item.id)).toEqual([OLDER]);
    expect(rest.next_cursor).toBeNull();
  });

  it("refuses a cursor that is not one the list gave", async () => {
    expect(await outcome(listReplies(reader, inbox(), { ...PAGE, cursor: "tomorrow" }))).toEqual({
      status: 422,
      code: "validation",
    });
  });

  it("refuses a role that cannot read the replies, before any call", async () => {
    const db = fakeDb();
    expect(await outcome(listReplies(editor, db, PAGE))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(db.calls).toEqual([]);
  });
});

describe("marking a reply", () => {
  it("passes the reply, the mark and the actor to email_reply_mark and answers the state it is in", async () => {
    const asked: unknown[] = [];
    const db = fakeDb({
      rpc: {
        email_reply_mark: (args) => {
          asked.push(args);
          return "answered";
        },
      },
    });
    expect(await markReply(reader, db, { id: REPLY, state: "answered" })).toEqual({
      id: REPLY,
      state: "answered",
    });
    expect(asked).toEqual([
      {
        p_reply_id: REPLY,
        p_state: "answered",
        p_actor: reader.userId,
        p_actor_kind: "human",
        p_request_id: "req-replies",
      },
    ]);
  });

  it("refuses a role that cannot mark a reply, before any call", async () => {
    const db = fakeDb();
    expect(await outcome(markReply(editor, db, { id: REPLY, state: "ignored" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(db.calls).toEqual([]);
  });

  it("answers 404 for a reply that is not there", async () => {
    const missing = Object.assign(new Error("not_found"), {
      code: "P0002",
      details: null,
      hint: null,
    });
    const db = fakeDb({ rpc: { email_reply_mark: () => missing } });
    expect(await outcome(markReply(reader, db, { id: REPLY, state: "seen" }))).toEqual({
      status: 404,
      code: "not_found",
    });
  });

  it("takes only seen, answered or ignored: a reply never goes back to new", () => {
    expect(replyMarkInputSchema.safeParse({ id: REPLY, state: "new" }).success).toBe(false);
    expect(replyMarkInputSchema.safeParse({ id: REPLY, state: "spam" }).success).toBe(false);
    expect(
      ["seen", "answered", "ignored"].map(
        (state) => replyMarkInputSchema.safeParse({ id: REPLY, state }).success,
      ),
    ).toEqual([true, true, true]);
  });
});
