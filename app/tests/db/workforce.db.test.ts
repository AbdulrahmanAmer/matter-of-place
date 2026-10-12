// W1: the four write functions of the AI employees. A message wakes only colleagues who are not off; a hire announces
// itself and refuses a taken handle; an update changes only the fields it names; an approval holds only for the exact
// content the person saw, and a decided proposal stays decided.
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

const HASH = "a".repeat(64);

async function proposal(db: Db): Promise<string> {
  const read = await db.query<{ id: string }>(
    `insert into public.agent_approvals (agent_id, action, summary, content, content_hash)
     select id, 'post', 'A post for Pasadena', '{"body":"x"}'::jsonb, $1 from public.agents where slug = 'social'
     returning id`,
    [HASH],
  );
  const id = read.rows[0]?.id;
  if (id === undefined) throw new Error("no proposal");
  return id;
}

async function failure(db: Db, sql: string, args: unknown[]): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, args);
    return "no error";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await db.query("rollback to savepoint attempt");
  }
}

describe("workforce write functions", () => {
  it("a team message wakes the named colleagues who are not off, once each", async () => {
    const woke = await withRollback(async (db) => {
      await db.query("update public.agents set state = 'off' where slug = 'social'");
      const sent = await db.query<{ id: string }>(
        "select public.workforce_post_message('team', '@chief @social', 'u1', 'Staff', array['chief', 'social']) as id",
      );
      const runs = await db.query<{ slug: string }>(
        `select a.slug from public.agent_runs r join public.agents a on a.id = r.agent_id
         where r.message_id = $1 order by a.slug`,
        [sent.rows[0]?.id],
      );
      return runs.rows.map((row) => row.slug);
    });
    expect(woke).toEqual(["chief"]);
  });

  it("refuses a direct thread to a colleague who is not on the team", async () => {
    const message = await withRollback((db) =>
      failure(db, "select public.workforce_post_message('nobody', 'hi', 'u1', 'Staff', '{}')", []),
    );
    expect(message).toBe("not_found");
  });

  it("hires once, says so in the team chat, and refuses the same handle again", async () => {
    const outcome = await withRollback(async (db) => {
      const hire = `select public.workforce_hire('scout', 'Scout', 'Researcher', '', 'haiku', '{}', '{chat}',
        null, 'human', 'req-1')`;
      await db.query(hire);
      const said = await db.query<{ body: string }>(
        "select body from public.agent_messages where thread = 'team' order by created_at desc limit 1",
      );
      return { said: said.rows[0]?.body, again: await failure(db, hire, []) };
    });
    expect(outcome).toEqual({
      said: "Scout joined the team as Researcher.",
      again: expect.stringContaining("duplicate key") as unknown,
    });
  });

  it("an update changes only the fields it names", async () => {
    const row = await withRollback(async (db) => {
      await db.query(
        `select public.workforce_update_agent('editor', '{"state":"paused"}'::jsonb, null, 'human', 'req-2')`,
      );
      const read = await db.query<{ state: string; name: string }>(
        "select state, name from public.agents where slug = 'editor'",
      );
      return read.rows[0];
    });
    expect(row).toEqual({ state: "paused", name: "Editor" });
  });

  it("approves only the content the person saw, and a decided proposal stays decided", async () => {
    const outcome = await withRollback(async (db) => {
      const id = await proposal(db);
      const decide = "select public.workforce_decide($1, $2, $3, null, 'human', 'req-3')";
      const changed = await failure(db, decide, [id, "approved", "b".repeat(64)]);
      await db.query(decide, [id, "approved", HASH]);
      const again = await failure(db, decide, [id, "rejected", HASH]);
      const state = await db.query<{ state: string }>(
        "select state from public.agent_approvals where id = $1",
        [id],
      );
      return { changed, again, state: state.rows[0]?.state };
    });
    expect(outcome).toEqual({
      changed: "version_conflict",
      again: "wrong_state",
      state: "approved",
    });
  });
});
