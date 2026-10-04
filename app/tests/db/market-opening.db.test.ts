// F3: a market opened by a direct `update markets set coming_soon = false` shows its published property and reads
// `comingSoon: false` in the public payload, and moves catalog_version once. The proof through the recipe step is B8b's.
// The state and the catalog are read in process through B3's own functions, over the one `pg` client of
// `withRollback`: the supabase-js client of `src/server/lib/db.ts` is a second connection and cannot see the
// uncommitted update.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db as AppDb } from "../../src/server/lib/db";
import { withRollback, type Db } from "../fixtures/db";

/** The client `getPublicState` and `getCatalog` take, answering each RPC with `select public.<name>()` on `pg`. */
function pgRpc(client: Db): AppDb {
  const rpc = async (name: string) => {
    const result = await client.query<{ v: unknown }>(`select public.${name}() as v`);
    return { data: result.rows[0]?.v ?? null, error: null };
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the adapter: only `rpc` is read
  return { rpc } as unknown as AppDb;
}

async function catalogVersion(client: Db): Promise<number> {
  const read = await client.query<{ value: string }>(
    "select value #>> '{}' as value from public.settings where key = 'catalog_version'",
  );
  const value = read.rows[0]?.value;
  if (value === undefined) throw new Error("no catalog_version row");
  return Number(value);
}

/** A fresh state module per test: the memos live in module state and a rolled-back version can repeat. */
async function load() {
  vi.resetModules();
  return import("../../src/server/public/state");
}

beforeEach(() => {
  vi.stubEnv("CATALOG_VERSION_TTL_MS", "0");
  vi.stubEnv("MOP_ENV", "local");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a market opened by hand", () => {
  it("shows its published property, reads open, and moves catalog_version by one", async () => {
    const { getCatalog, getPublicState } = await load();
    const outcome = await withRollback(async (client) => {
      await client.query("select public.set_environment('development')");
      await client.query("update public.markets set coming_soon = true where slug = 'california'");
      const closed = await getCatalog(pgRpc(client));
      const state = await getPublicState(pgRpc(client));
      const before = await catalogVersion(client);
      await client.query("update public.markets set coming_soon = false where slug = 'california'");
      const after = await catalogVersion(client);
      const open = await getCatalog(pgRpc(client));
      const market = (catalog: typeof open) =>
        catalog.markets.find((row) => row.slug === "california")?.comingSoon;
      const inCalifornia = (catalog: typeof open) =>
        catalog.properties.filter((row) => row.market === "california").length;
      return {
        closed: { market: market(closed), properties: inCalifornia(closed) },
        stateClosed: state.comingSoonMarkets["california"],
        open: { market: market(open), properties: inCalifornia(open) },
        bumps: after - before,
      };
    });
    expect(outcome.closed).toEqual({ market: true, properties: 0 });
    expect(outcome.stateClosed).toBe(true);
    expect(outcome.open.market).toBe(false);
    expect(outcome.open.properties).toBeGreaterThan(0);
    expect(outcome.bumps).toBe(1);
  });
});
