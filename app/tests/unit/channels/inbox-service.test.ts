// W8 item 4: the admin read of Instagram comments and messages (`listInbox`, `GET /api/admin/channels/inbox`). The
// database is tableDb of tests/fixtures/channel-db.ts, whose tables keep only the rows a query's filters keep. Nothing
// here calls a platform.
import { describe, expect, it } from "vitest";
import { listInbox } from "../../../src/server/channels/service";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { tableDb } from "../../fixtures/channel-db";

const POST = "3f2a9c1d-0000-4000-8000-0000000000a1";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: ["channels"],
  requestId: "req-inbox",
});

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `3f2a9c1d-0000-4000-8000-00000000010${String(n)}`,
  kind: "comment",
  social_post_id: POST,
  author_handle: "reader",
  body: "Which architect?",
  received_at: `2026-10-27T1${String(n)}:00:00Z`,
  state: "new",
  reply_state: null,
  reply_error: null,
  replied_at: null,
  ...over,
});

describe("listInbox", () => {
  it("answers every staff role, newest first", async () => {
    const db = tableDb({
      social_inbox: [row(1), row(3), row(2, { kind: "message", social_post_id: null })],
    });
    const result = await listInbox(actor(["commercial"]), db, {});
    expect(result.items.map((item) => item.received_at)).toEqual([
      "2026-10-27T13:00:00Z",
      "2026-10-27T12:00:00Z",
      "2026-10-27T11:00:00Z",
    ]);
  });

  it("narrows to one post's comments", async () => {
    const db = tableDb({
      social_inbox: [row(1), row(2, { kind: "message", social_post_id: null })],
    });
    const result = await listInbox(actor(["media_ops"]), db, { post_id: POST });
    expect(result.items.map((item) => item.kind)).toEqual(["comment"]);
  });

  it("gives an agent's key the rows without the words, a person the words (round 2)", async () => {
    const db = tableDb({ social_inbox: [row(1)] });
    const agent: AdminActor = { ...actor(["admin"]), kind: "agent" };
    const [forAgent, forPerson] = await Promise.all([
      listInbox(agent, db, {}),
      listInbox(actor(["admin"]), db, {}),
    ]);
    expect(forAgent.items.map((item) => [item.author_handle, item.body])).toEqual([["reader", ""]]);
    expect(forPerson.items.map((item) => item.body)).toEqual(["Which architect?"]);
  });

  it("refuses an actor with no staff role before any database call", async () => {
    const db = tableDb({ social_inbox: [row(1)] });
    await expect(listInbox(actor([]), db, {})).rejects.toMatchObject({ code: "forbidden" });
    expect(db.calls).toEqual([]);
  });
});
