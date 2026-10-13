import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { decideApproval, postMessage } from "../../src/server/workforce/service";
import { fakeDb } from "../fixtures/fake-db";

// H101 (operator, 2026-10-13: "no one can some how figure out a way to talk to my ai employees and cause issues"):
// only a signed-in person's line counts as a person's, and only a person decides an approval.

const person: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-post",
};
const key: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000002",
  kind: "agent",
  roles: ["admin"],
  scopes: ["workforce"],
  requestId: "req-post-key",
};

function world() {
  const db = fakeDb({
    rpc: { workforce_post_message: () => "11111111-1111-4111-8111-111111111111" },
    tables: {
      agents: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "matter",
          name: "Matter",
          role: "Owner-level agent",
          state: "idle",
          model: "opus",
          instructions: "",
          tools: [],
          wake_on: [],
          created_at: "2026-10-12T00:00:00Z",
          created_by: null,
          current_task: null,
          last_seen_at: null,
        },
      ],
    },
  });
  return Object.assign(db, {
    auth: {
      admin: {
        getUserById: () =>
          Promise.resolve({ data: { user: { email: "owner@example.com" } }, error: null }),
      },
    },
  });
}

const kindPosted = (db: ReturnType<typeof world>) => {
  const call = db.calls.find((entry) => entry.name === "workforce_post_message");
  const args: unknown = call?.args[0];
  return typeof args === "object" && args !== null && "p_author_kind" in args
    ? args.p_author_kind
    : undefined;
};

describe("a line in the team chat", () => {
  it("counts as a person's only when a signed-in person wrote it; an agent key's line is an agent's", async () => {
    const byPerson = world();
    const byKey = world();
    await postMessage(person, byPerson, { thread: "matter", body: "Hello" });
    await postMessage(key, byKey, { thread: "matter", body: "Hello" });
    expect([kindPosted(byPerson), kindPosted(byKey)]).toEqual(["human", "agent"]);
  });
});

describe("an approval", () => {
  it("is never decided by an agent key, Matter's included", async () => {
    const db = world();
    const decided = decideApproval(key, db, "33333333-3333-4333-8333-333333333333", {
      decision: "approved",
      content_hash: "0".repeat(64),
    });
    await expect(decided).rejects.toMatchObject({ code: "human_only", status: 403 });
    expect(db.calls.filter((entry) => entry.kind === "rpc")).toEqual([]);
  });
});
