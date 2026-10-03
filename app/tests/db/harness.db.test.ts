import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asRole,
  committed,
  createAuthUser,
  createStaffUser,
  dbNow,
  withMutation,
  withRollback,
  type Db,
} from "../fixtures/db";
import setup from "./global-setup";

const POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";
const REF = "abcdefghijklmnopqrst";
const TRY_LOCK = "select pg_try_advisory_lock(hashtext('mop-dev-tests')) as locked";

async function tryLock(db: Db): Promise<boolean | undefined> {
  const result = await db.query<{ locked: boolean }>(TRY_LOCK);
  return result.rows[0]?.locked;
}

async function countAuthUsers(db: Db, id: string): Promise<number | undefined> {
  const result = await db.query<{ count: number }>(
    "select count(*)::int as count from auth.users where id = $1",
    [id],
  );
  return result.rows[0]?.count;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withRollback", () => {
  it("leaves no row behind: a user made inside is gone from a second connection", async () => {
    const { id, inside } = await withRollback(async (db) => {
      const created = await createAuthUser(db);
      return { id: created, inside: await countAuthUsers(db, created) };
    });
    const after = await withRollback((db) => countAuthUsers(db, id));
    expect({ inside, after }).toEqual({ inside: 1, after: 0 });
  });

  it("withMutation: a probe function is callable inside and absent afterwards (T-07)", async () => {
    const inside = await withMutation(
      "create function public.__wf_probe() returns int language sql as 'select 1'",
      async (db) =>
        (await db.query<{ value: number }>("select public.__wf_probe() as value")).rows[0],
    );
    const after = await withRollback(
      async (db) =>
        (
          await db.query<{ count: number }>(
            "select count(*)::int as count from pg_proc where proname = '__wf_probe'",
          )
        ).rows[0],
    );
    expect({ inside, after }).toEqual({ inside: { value: 1 }, after: { count: 0 } });
  });

  it("dbNow equals now() read in the same transaction (T-08)", async () => {
    const { helper, direct } = await withRollback(async (db) => ({
      helper: await dbNow(db),
      direct: (await db.query<{ now: Date }>("select now() as now")).rows[0]?.now,
    }));
    expect(helper.getTime()).toBe(direct?.getTime());
  });
});

const ROLE_ANSWERS =
  "select app.role_in('admin') as admin, app.role_in('chief_editor') as editor, app.is_staff() as staff";

describe("roles", () => {
  it("an admin made by createStaffUser holds admin through role_in, and only admin", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin"]);
      await asRole(db, "authenticated", id);
      return (await db.query<{ admin: boolean; editor: boolean; staff: boolean }>(ROLE_ANSWERS))
        .rows[0];
    });
    expect(answers).toEqual({ admin: true, editor: false, staff: true });
  });

  it("a disabled admin holds no role and is not staff", async () => {
    const answers = await withRollback(async (db) => {
      const id = await createStaffUser(db, ["admin"]);
      await db.query("update public.user_roles set disabled_at = now() where user_id = $1", [id]);
      await asRole(db, "authenticated", id);
      return (await db.query<{ admin: boolean; editor: boolean; staff: boolean }>(ROLE_ANSWERS))
        .rows[0];
    });
    expect(answers).toEqual({ admin: false, editor: false, staff: false });
  });

  it("anon gets an error on user_roles", async () => {
    await expect(
      withRollback(async (db) => {
        await asRole(db, "anon");
        return db.query("select * from public.user_roles");
      }),
    ).rejects.toThrow("permission denied for table user_roles");
  });
});

describe("committed", () => {
  it("throws without a cleanup before touching the database", async () => {
    // Any connection attempt would fail with ECONNREFUSED instead of the message below.
    vi.stubEnv("DEV_DB_URL", "postgresql://nobody:none@127.0.0.1:1/none");
    // @ts-expect-error -- a call without a cleanup is refused by the type and at run time
    await expect(committed(() => Promise.resolve())).rejects.toThrow("committed() needs a cleanup");
  });

  it("holds the mop-dev-tests lock while fn runs and releases it after (G34)", async () => {
    const during = await committed(
      () => withRollback(tryLock),
      () => Promise.resolve(),
    );
    const after = await withRollback(async (db) => {
      const locked = await tryLock(db);
      await db.query("select pg_advisory_unlock(hashtext('mop-dev-tests'))");
      return locked;
    });
    expect({ during, after }).toEqual({ during: false, after: true });
  });
});

describe("global setup", () => {
  it("refuses to start without DEV_DB_URL", async () => {
    vi.stubEnv("DEV_DB_URL", undefined);
    await expect(setup()).rejects.toThrow("refusing: DEV_DB_URL is not set");
  });

  it("aborts naming PROD_TURNSTILE_SECRET (SEC-08)", async () => {
    vi.stubEnv("PROD_TURNSTILE_SECRET", "x");
    await expect(setup()).rejects.toThrow("PROD_TURNSTILE_SECRET");
  });

  // Each row breaks one half of the target rule, so dropping either half turns its row red.
  it.each([
    {
      name: "the project's user on another host",
      url: `postgresql://postgres.${REF}:pw@db.example.com/postgres`,
    },
    {
      name: "another user on the pooler",
      url: `postgresql://postgres.other:pw@${POOLER_HOST}/postgres`,
    },
  ])("refuses $name (T-01)", async ({ url }) => {
    vi.stubEnv("DEV_SUPABASE_PROJECT_REF", REF);
    vi.stubEnv("DEV_DB_URL", url);
    await expect(setup()).rejects.toThrow("refusing: DEV_DB_URL is neither 127.0.0.1");
  });
});
