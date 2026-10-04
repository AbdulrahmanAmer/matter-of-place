// B15 Data changes: `mark_inquiry_forwarded`, the one write of the `webhook_omnikom` step (G43), and the attribution
// that `create_inquiry` now stores. Every case runs in a rolled-back transaction; times are compared inside SQL (G-700).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

const PAYLOAD = { id: "8d0e6a52-3f53-5c55-8a43-0c1f6a2b9e10", version: 1 };

interface Seen {
  state: string;
  forwarded_now: boolean;
  forwarded_payload: unknown;
}

async function inquiry(db: Db, state: string, anonymised = false): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.inquiries (intent, name, email, message, source_path, state, anonymised_at)
     values ('ask', 'Test Visitor', 'forwarded@example.invalid', 'x', '/__test', $1::public.inquiry_state,
       case when $2::boolean then now() end)
     returning id`,
    [state, anonymised],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no inquiry row");
  return id;
}

async function mark(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query<{ matched: boolean }>(
    "select public.mark_inquiry_forwarded($1, $2::jsonb) as matched",
    [id, JSON.stringify(PAYLOAD)],
  );
  const matched = rows[0]?.matched;
  if (matched === undefined) throw new Error("no answer from mark_inquiry_forwarded");
  return matched;
}

async function seen(db: Db, id: string): Promise<Seen | undefined> {
  const { rows } = await db.query<Seen>(
    `select state::text, forwarded_at is not distinct from now() as forwarded_now, forwarded_payload
     from public.inquiries where id = $1`,
    [id],
  );
  return rows[0];
}

describe("mark_inquiry_forwarded", () => {
  it("on a new inquiry returns true and sets forwarded, forwarded_at and forwarded_payload", async () => {
    const { matched, after } = await withRollback(async (db) => {
      const id = await inquiry(db, "new");
      return { matched: await mark(db, id), after: await seen(db, id) };
    });
    expect(matched).toBe(true);
    expect(after).toEqual({ state: "forwarded", forwarded_now: true, forwarded_payload: PAYLOAD });
  });

  it("on a closed inquiry returns true, keeps closed and sets forwarded_at", async () => {
    const { matched, after } = await withRollback(async (db) => {
      const id = await inquiry(db, "closed");
      return { matched: await mark(db, id), after: await seen(db, id) };
    });
    expect(matched).toBe(true);
    expect(after).toEqual({ state: "closed", forwarded_now: true, forwarded_payload: PAYLOAD });
  });

  it("on an anonymised inquiry or an unknown id returns false and changes nothing", async () => {
    const { anonymised, after, unknown } = await withRollback(async (db) => {
      const id = await inquiry(db, "new", true);
      return {
        anonymised: await mark(db, id),
        after: await seen(db, id),
        unknown: await mark(db, randomUUID()),
      };
    });
    expect(anonymised).toBe(false);
    expect(after).toEqual({ state: "new", forwarded_now: false, forwarded_payload: null });
    expect(unknown).toBe(false);
  });

  it("create_inquiry stores the attribution object of p, and '{}' when p has none", async () => {
    const stored = await withRollback(async (db) => {
      const base = { intent: "ask", name: "Test Visitor", message: "x", source_path: "/__test" };
      const ids: string[] = [];
      for (const p of [
        {
          ...base,
          email: "with@example.invalid",
          attribution: { first_touch: { utm_source: "test" } },
        },
        { ...base, email: "without@example.invalid" },
      ]) {
        const { rows } = await db.query<{ id: string }>(
          "select id from public.create_inquiry($1::jsonb)",
          [JSON.stringify(p)],
        );
        ids.push(rows[0]?.id ?? "");
      }
      const { rows } = await db.query<{ attribution: unknown }>(
        "select attribution from public.inquiries where id = any ($1::uuid[]) order by email",
        [ids],
      );
      return rows.map((row) => row.attribution);
    });
    expect(stored).toEqual([{ first_touch: { utm_source: "test" } }, {}]);
  });

  it("only service_role may execute it", async () => {
    const granted = await withRollback(async (db) => {
      const { rows } = await db.query<{ role: string; allowed: boolean }>(
        `select role, has_function_privilege(role, 'public.mark_inquiry_forwarded(uuid, jsonb)', 'execute') as allowed
         from unnest(array['anon', 'authenticated', 'service_role']) as role`,
      );
      return rows;
    });
    expect(granted).toEqual([
      { role: "anon", allowed: false },
      { role: "authenticated", allowed: false },
      { role: "service_role", allowed: true },
    ]);
  });
});
