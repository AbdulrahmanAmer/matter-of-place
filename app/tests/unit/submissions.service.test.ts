import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { startReview } from "../../src/server/submissions/service";
import { fakeDb } from "../fixtures/fake-db";

// The admin service of a request (B7 steps 4 and 5): who may move it, and what a refused move answers.

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-sr",
});

const ids = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

describe("startReview", () => {
  it("moves a whole selection in one start_review call and answers how many started", async () => {
    const db = fakeDb({ rpc: { start_review: (args) => args.p_submission_ids.length } });
    const answer = await startReview(actor(["managing_editor"]), db, { ids });
    expect({ answer, rpc: db.calls.map((call) => call.name) }).toEqual({
      answer: { started: 2 },
      rpc: ["start_review"],
    });
  });

  it("refuses a visual editor with 403 before any database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(startReview(actor(["visual_editor"]), db, { ids })),
      calls: db.calls.length,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: 0 });
  });

  it("answers 409 wrong_state when a request of the selection has moved on", async () => {
    const db = fakeDb({
      rpc: { start_review: () => Object.assign(new Error("wrong_state"), { code: "P0001" }) },
    });
    expect(await outcome(startReview(actor(["chief_editor"]), db, { ids }))).toEqual({
      status: 409,
      code: "wrong_state",
    });
  });
});
