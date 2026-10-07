// B9 step 10: the screen 10 service functions against the real SQL functions. Every case runs in one rolled-back
// transaction (F22): the supabase-js client of `src/server/lib/db.ts` is a second connection and cannot see it, so the
// service gets an adapter that answers the few query builder calls it makes over the test's own `pg` client.
import "../fixtures/worker-env";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  approveAsset,
  listAssets,
  rejectAsset,
  rerenderAsset,
} from "../../src/server/assets/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import type { Db as AppDb } from "../../src/server/lib/db";
import { createStaffUser, withRollback, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

type Answer = { data: unknown; error: { message: string; code: string; details: string } | null };

/** PostgREST answers a time as ISO text, where `pg` gives a `Date`. */
const asJson = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

/** `payload->data->>property_id` as SQL: the column quoted, each key a literal. */
function sqlPath(column: string): string {
  const [head = "", ...rest] = column.split(/(->>?)/);
  let path = `"${head}"`;
  for (let index = 0; index < rest.length; index += 2) {
    path += `${rest[index] ?? ""}'${rest[index + 1] ?? ""}'`;
  }
  return path;
}

/** One statement under a savepoint, so a refused call leaves the test transaction usable (G-102). */
async function attempt(
  client: Db,
  text: string,
  values: unknown[],
): Promise<Answer & { rows: Record<string, unknown>[] }> {
  await client.query("savepoint adapter");
  try {
    const result = await client.query<Record<string, unknown>>(text, values);
    await client.query("release savepoint adapter");
    const rows = result.rows.map(asJson);
    return { data: rows, error: null, rows };
  } catch (error) {
    await client.query("rollback to savepoint adapter");
    if (!(error instanceof pg.DatabaseError)) throw error;
    return {
      data: null,
      error: { message: error.message, code: error.code ?? "", details: error.detail ?? "" },
      rows: [],
    };
  }
}

function tableQuery(client: Db, table: string, columns: string, counted: boolean) {
  const filters: { column: string; values: unknown[] }[] = [];
  const orders: string[] = [];
  let window = "";
  const run = async (): Promise<Answer & { count: number | null }> => {
    const params = filters.map((filter) => filter.values.map(String));
    const where =
      filters.length === 0
        ? ""
        : ` where ${filters.map((filter, index) => `${sqlPath(filter.column)}::text = any($${String(index + 1)}::text[])`).join(" and ")}`;
    const order = orders.length === 0 ? "" : ` order by ${orders.join(", ")}`;
    const read = await attempt(
      client,
      `select ${columns} from public.${table}${where}${order}${window}`,
      params,
    );
    if (read.error !== null || !counted) return { data: read.data, error: read.error, count: null };
    const total = await attempt(
      client,
      `select count(*)::int as n from public.${table}${where}`,
      params,
    );
    return { data: read.data, error: total.error, count: Number(total.rows[0]?.["n"]) };
  };
  const builder = {
    eq: (column: string, value: unknown) => {
      filters.push({ column, values: [value] });
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push({ column, values });
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push(`${sqlPath(column)}${options?.ascending === false ? " desc" : ""}`);
      return builder;
    },
    range: (from: number, to: number) => {
      window = ` limit ${String(to - from + 1)} offset ${String(from)}`;
      return builder;
    },
    then: (resolve: (answer: Answer) => unknown, reject: (reason: unknown) => unknown) =>
      run().then(resolve, reject),
  };
  return builder;
}

/** The client the service takes: `from` and `rpc` over the test's `pg` client, as the service role. */
function pgDb(client: Db): AppDb {
  const rpc = async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const names = Object.keys(args);
    const values = names.map((key) => {
      const value = args[key];
      return typeof value === "object" && value !== null ? JSON.stringify(value) : value;
    });
    const list = names.map((key, index) => `${key} => $${String(index + 1)}`).join(", ");
    const call = await attempt(client, `select public.${name}(${list}) as v`, values);
    return { data: call.rows[0]?.["v"] ?? null, error: call.error };
  };
  const from = (table: string) => ({
    select: (columns: string, options?: { count?: string }) =>
      tableQuery(client, table, columns, options?.count !== undefined),
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the adapter: only `from` and `rpc` are read
  return { rpc, from } as unknown as AppDb;
}

const KINDS = "array['cover', 'carousel', 'story', 'reel', 'newsletter_block', 'standalone_email']";
const MAIN_FILE = `[{"media_key":"assets/p/cover/r1/cover.0a1b2c3d.jpg","w":1200,"h":630,"bytes":1,"role":"main"}]`;

async function one<T>(client: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await client.query<{ v: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.v;
}

/** A media_ops person and a published property of its own. */
async function world(client: Db, n: number) {
  const userId = await createStaffUser(client, ["media_ops"]);
  const property = await publishedProperty(client, { n });
  const actor: AdminActor = {
    userId,
    kind: "human",
    roles: ["media_ops"],
    scopes: [],
    requestId: "req-assets-db",
  };
  return { actor, propertyId: property.id };
}

/** `world` with a complete pending cover at revision 1. */
async function withCover(client: Db, n: number) {
  const { actor, propertyId } = await world(client, n);
  const assetId = await one<string>(
    client,
    "select (public.upsert_asset_stub($1, 'cover', 1, null)).id as v",
    [propertyId],
  );
  await client.query(
    `update public.assets set files = '${MAIN_FILE}', caption = 'A caption.', alt_text = 'A house.' where id = $1`,
    [assetId],
  );
  return { actor, propertyId, assetId };
}

async function eventsOf(client: Db, type: string, assetId: string) {
  const read = await client.query<{ id: string; payload: Record<string, unknown> }>(
    "select id, payload from public.events where type = $1 and entity_id = $2",
    [type, assetId],
  );
  return read.rows;
}

describe("the assets service on the database", () => {
  it("listAssets returns at most 50 items and total = 60 for 60 seeded stubs", async () => {
    const page = await withRollback(async (client) => {
      const { actor, propertyId } = await world(client, 9101);
      await client.query(
        `select public.upsert_asset_stub($1, k, r, null)
         from unnest(${KINDS}::public.asset_kind[]) k cross join generate_series(1, 10) r`,
        [propertyId],
      );
      const first = await listAssets(actor, pgDb(client), { page: 1, property_id: propertyId });
      const second = await listAssets(actor, pgDb(client), { page: 2, property_id: propertyId });
      return {
        first: first.items.length,
        second: second.items.length,
        totals: [first.total, second.total],
        distinct: new Set([...first.items, ...second.items].map((item) => item.id)).size,
      };
    });
    expect(page).toEqual({ first: 50, second: 10, totals: [60, 60], distinct: 60 });
  });

  it("media_ops approves: one asset.approved event row and one audit row exist", async () => {
    const seen = await withRollback(async (client) => {
      const { actor, assetId, propertyId } = await withCover(client, 9102);
      const answer = await approveAsset(actor, pgDb(client), { id: assetId });
      const audit = await one<number>(
        client,
        "select count(*)::int as v from public.audit_log where action = 'assets.approve' and entity_id = $1",
        [assetId],
      );
      const status = await one<string>(
        client,
        "select status::text as v from public.assets where id = $1",
        [assetId],
      );
      return {
        answer,
        events: await eventsOf(client, "asset.approved", assetId),
        audit,
        status,
        propertyId,
      };
    });
    expect(seen.events.map((event) => event.id)).toEqual([seen.answer.event_id]);
    expect(seen.events.map((event) => event.payload)).toEqual([
      {
        asset_id: seen.answer.asset_id,
        property_id: seen.propertyId,
        kind: "cover",
        tier: "Editorial",
        market: "california",
      },
    ]);
    expect({ audit: seen.audit, status: seen.status }).toEqual({ audit: 1, status: "approved" });
  });

  it("rejectAsset with a note writes one asset.rejected event { asset_id, property_id, kind, tier, market, note }", async () => {
    const seen = await withRollback(async (client) => {
      const { actor, assetId, propertyId } = await withCover(client, 9103);
      await rejectAsset(actor, pgDb(client), { id: assetId, note: "The light is flat." });
      return { assetId, propertyId, events: await eventsOf(client, "asset.rejected", assetId) };
    });
    expect(seen.events.map((event) => event.payload)).toEqual([
      {
        asset_id: seen.assetId,
        property_id: seen.propertyId,
        kind: "cover",
        tier: "Editorial",
        market: "california",
        note: "The light is flat.",
      },
    ]);
  });

  it("rerenderAsset twice returns the same pending revision and job", async () => {
    const seen = await withRollback(async (client) => {
      const { actor, assetId } = await withCover(client, 9104);
      const first = await rerenderAsset(actor, pgDb(client), { id: assetId });
      const second = await rerenderAsset(actor, pgDb(client), { id: assetId });
      const revisions = await client.query<{ revision: number; status: string }>(
        "select revision, status::text as status from public.assets where kind = 'cover' and property_id = (select property_id from public.assets where id = $1) order by revision",
        [assetId],
      );
      return { first, second, revisions: revisions.rows };
    });
    expect(seen.second).toEqual(seen.first);
    expect(seen.first.job_id).not.toBeNull();
    expect(seen.revisions).toEqual([
      { revision: 1, status: "rejected" },
      { revision: 2, status: "pending" },
    ]);
  });
});
