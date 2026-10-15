// W7 item 2: a person marks a reply (read from the mailbox, W4) seen, answered or ignored. The change is audited with
// the reply's id and its two states, never its words or its sender; a mark to the state it already has changes nothing.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";

async function reply(db: Db, state = "new"): Promise<string> {
  const read = await db.query<{ id: string }>(
    `insert into public.email_replies (provider_id, from_email, from_name, subject, body, received_at, state)
     values ($1, 'dana.w7@example.com', 'Dana Reyes', 'Re: About 12 Ocean Avenue', 'PRIVATE WORDS', now(), $2)
     returning id`,
    [`zoho-w7-${randomUUID()}`, state],
  );
  const id = read.rows[0]?.id;
  if (id === undefined) throw new Error("no reply");
  return id;
}

async function mark(db: Db, id: string, state: string, actor: string | null): Promise<string> {
  const read = await db.query<{ state: string }>(
    "select public.email_reply_mark($1, $2, $3, 'human', 'req-w7-2') as state",
    [id, state, actor],
  );
  return read.rows[0]?.state ?? "";
}

async function audited(db: Db, id: string) {
  const read = await db.query<{ action: string; before: unknown; after: unknown }>(
    "select action, before, after from public.audit_log where entity = 'email_replies' and entity_id = $1 order by id",
    [id],
  );
  return read.rows;
}

async function refusal(db: Db, run: () => Promise<unknown>): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await run();
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return error.message;
    throw error;
  }
}

describe("email_reply_mark", () => {
  it("marks a reply answered and audits its two states without the reply's words or sender", async () => {
    const seen = await withRollback(async (db) => {
      const staff = await createStaffUser(db, ["chief_editor"]);
      const id = await reply(db);
      const state = await mark(db, id, "answered", staff);
      const row = await db.query<{ state: string }>(
        "select state from public.email_replies where id = $1",
        [id],
      );
      return { id, state, stored: row.rows[0]?.state, log: await audited(db, id) };
    });
    expect([seen.state, seen.stored]).toEqual(["answered", "answered"]);
    expect(seen.log).toEqual([
      {
        action: "audit.reply_mark",
        before: { id: seen.id, state: "new" },
        after: { id: seen.id, state: "answered" },
      },
    ]);
    expect(JSON.stringify(seen.log)).not.toMatch(/PRIVATE|dana/);
  });

  it("marks seen only a reply that is new, and a mark to the state it already has writes no audit row", async () => {
    const seen = await withRollback(async (db) => {
      const staff = await createStaffUser(db, ["admin"]);
      const fresh = await reply(db);
      const done = await reply(db, "answered");
      return {
        opened: await mark(db, fresh, "seen", staff),
        again: await mark(db, fresh, "seen", staff),
        kept: await mark(db, done, "seen", staff),
        ignored: await mark(db, done, "ignored", staff),
        same: await mark(db, done, "ignored", staff),
        freshLog: await audited(db, fresh),
        doneLog: await audited(db, done),
      };
    });
    expect([seen.opened, seen.again, seen.kept, seen.ignored, seen.same]).toEqual([
      "seen",
      "seen",
      "answered",
      "ignored",
      "ignored",
    ]);
    expect(seen.freshLog).toHaveLength(1);
    expect(seen.doneLog).toHaveLength(1);
  });

  it("refuses a state that is not a mark, a reply that is not there, and a role without the right", async () => {
    const seen = await withRollback(async (db) => {
      const reader = await createStaffUser(db, ["chief_editor"]);
      const editor = await createStaffUser(db, ["managing_editor"]);
      const id = await reply(db);
      return {
        toNew: await refusal(db, () => mark(db, id, "new", reader)),
        missing: await refusal(db, () => mark(db, randomUUID(), "seen", reader)),
        wrongRole: await refusal(db, () => mark(db, id, "answered", editor)),
        state: (
          await db.query<{ state: string }>("select state from public.email_replies where id = $1", [
            id,
          ])
        ).rows[0]?.state,
      };
    });
    expect(seen).toEqual({
      toNew: "validation",
      missing: "not_found",
      wrongRole: "forbidden",
      state: "new",
    });
  });
});
