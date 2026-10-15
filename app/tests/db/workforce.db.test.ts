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

  it("claims a person's message before an older event and the backlog (gap item 3)", async () => {
    const claimed = await withRollback(async (db) => {
      // Only this case's runs are waiting.
      await db.query(
        "update public.agent_runs set state = 'done' where state in ('queued', 'running')",
      );
      await db.query(
        `insert into public.agent_runs (agent_id, cause, created_at)
         select id, 'schedule', now() - interval '3 minutes' from public.agents where slug = 'editor'`,
      );
      await db.query(
        `insert into public.agent_runs (agent_id, cause, created_at)
         select id, 'event', now() - interval '2 minutes' from public.agents where slug = 'social'`,
      );
      const message = await db.query<{ id: string }>(
        `insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
         values ('chief', 'human', 'u1', 'Operator', 'Status?') returning id`,
      );
      await db.query(
        `insert into public.agent_runs (agent_id, cause, message_id)
         select id, 'message', $1 from public.agents where slug = 'chief'`,
        [message.rows[0]?.id],
      );
      const order: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const run = await db.query<{ cause: string }>(
          "select cause from public.claim_agent_run('test-worker', 60)",
        );
        order.push(run.rows[0]?.cause ?? "none");
      }
      return order;
    });
    expect(claimed).toEqual(["message", "event", "schedule"]);
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

// W2 step 6: the decision teaches the colleague who drafted it.
describe("learning from decisions", () => {
  const decide = `select public.workforce_decide($1, $2, $3, null, 'human', 'req-6', $4, $5)`;

  it("a decline with a reason writes one lesson for that colleague, and the same reason again writes none", async () => {
    const lessons = await withRollback(async (db) => {
      const first = await proposal(db);
      await db.query(decide, [first, "rejected", HASH, "Too long, three sentences at most.", null]);
      const second = await proposal(db);
      await db.query(decide, [
        second,
        "rejected",
        HASH,
        "Too long, three sentences at most.",
        null,
      ]);
      const read = await db.query<{ source: string; trigger: string; reason: string | null }>(
        `select l.source, l.trigger, p.reason from public.agent_lessons l
         join public.agent_approvals p on l.evidence_ref = 'approval:' || p.id::text
         where l.agent_id = (select id from public.agents where slug = 'social')`,
      );
      return read.rows;
    });
    expect(lessons).toEqual([
      {
        source: "decline",
        trigger: "When you draft a proposal (post)",
        reason: "Too long, three sentences at most.",
      },
    ]);
  });

  it("an edit approves the person's own version and teaches it; a decline cannot carry an edit", async () => {
    const outcome = await withRollback(async (db) => {
      const id = await proposal(db);
      await db.query(decide, [
        id,
        "approved",
        HASH,
        null,
        "Pasadena, in the light of late October.",
      ]);
      const row = await db.query<{ body: string; source: string }>(
        `select p.edited_content ->> 'body' as body, l.source from public.agent_approvals p
         join public.agent_lessons l on l.evidence_ref = 'approval:' || p.id::text where p.id = $1`,
        [id],
      );
      const other = await proposal(db);
      const refused = await failure(db, decide, [other, "rejected", HASH, null, "my version"]);
      return { ...row.rows[0], refused };
    });
    expect(outcome).toEqual({
      body: "Pasadena, in the light of late October.",
      source: "edit",
      refused: "validation",
    });
  });

  it("an approved instructions change takes effect, is versioned, and retires the lessons it promoted", async () => {
    const outcome = await withRollback(async (db) => {
      const lesson = await db.query<{ id: string }>(
        `insert into public.agent_lessons (agent_id, trigger, action, evidence_ref, source, uses)
         select id, 'When you post', 'Lead with the place.', 'approval:test', 'decline', 3
         from public.agents where slug = 'social' returning id`,
      );
      const lessonId = lesson.rows[0]?.id;
      const change = await db.query<{ id: string }>(
        `insert into public.agent_approvals (agent_id, action, summary, content, content_hash)
         select (select id from public.agents where slug = 'matter'), 'instructions_change', 'Promote 1 lesson',
           jsonb_build_object('agent_id', s.id, 'instructions', 'Lead with the place.', 'reason', 'Weekly review',
             'lessons', jsonb_build_array($1::text)),
           $2
         from public.agents s where s.slug = 'social' returning id`,
        [lessonId, HASH],
      );
      await db.query(decide, [change.rows[0]?.id, "approved", HASH, null, null]);
      const read = await db.query<{ instructions: string; version: number; status: string }>(
        `select a.instructions, v.version, l.status from public.agents a
         join public.agent_instruction_versions v on v.agent_id = a.id
         join public.agent_lessons l on l.id = $1
         where a.slug = 'social'`,
        [lessonId],
      );
      return read.rows;
    });
    expect(outcome).toEqual([
      { instructions: "Lead with the place.", version: 1, status: "promoted" },
    ]);
  });

  it("an approved hire joins the team without the hire tool, and a declined one does not (gap item 5)", async () => {
    const outcome = await withRollback(async (db) => {
      const propose = (slug: string) =>
        db.query<{ id: string }>(
          `insert into public.agent_approvals (agent_id, action, summary, content, content_hash)
           select id, 'hire', 'Hire a scout', jsonb_build_object('body', 'Scout.', 'hire', jsonb_build_object(
             'slug', $1::text, 'name', 'Scout', 'role', 'Finds listings', 'instructions', '', 'model', 'opus',
             'wake_on', '[]'::jsonb, 'tools', '["read_business", "chat", "hire"]'::jsonb)), $2
           from public.agents where slug = 'chief' returning id`,
          [slug, HASH],
        );
      const yes = await propose("test-scout-yes");
      const no = await propose("test-scout-no");
      await db.query(decide, [yes.rows[0]?.id, "approved", HASH, null, null]);
      await db.query(decide, [no.rows[0]?.id, "rejected", HASH, "Not now", null]);
      const read = await db.query<{ slug: string; model: string; tools: string[] }>(
        `select slug, model, tools from public.agents where slug like 'test-scout-%' order by slug`,
      );
      return read.rows;
    });
    expect(outcome).toEqual([
      { slug: "test-scout-yes", model: "opus", tools: ["read_business", "chat"] },
    ]);
  });

  it("records the week's Claude allowance as a vendor line without touching the catalog (W6 item 2)", async () => {
    const read = await withRollback(async (db) => {
      const version = "select (public.public_state() ->> 'catalog_version') as v";
      const before = await db.query<{ v: string }>(version);
      await db.query(
        "select public.record_vendor_usage('claude_week', 94, 100, '2026-10-21T16:00:00.000Z')",
      );
      const after = await db.query<{ v: string }>(version);
      const row = await db.query<{ used: string; limit_value: string; note: string }>(
        "select used, limit_value, note from public.vendor_usage where line = 'claude_week'",
      );
      return { row: row.rows[0], same: before.rows[0]?.v === after.rows[0]?.v };
    });
    expect(read).toEqual({
      row: { used: "94", limit_value: "100", note: "2026-10-21T16:00:00.000Z" },
      same: true,
    });
  });
});
