import type { Database } from "../../src/db";
import type { Db } from "../../src/server/lib/db";

type PublicSchema = Database["public"];

export interface FakeDbOptions {
  rpc?: {
    [F in keyof PublicSchema["Functions"]]?: (
      args: PublicSchema["Functions"][F]["Args"],
    ) => PublicSchema["Functions"][F]["Returns"] | Error;
  };
  tables?: { [T in keyof PublicSchema["Tables"]]?: PublicSchema["Tables"][T]["Row"][] };
  storage?: Record<string, Record<string, (...args: unknown[]) => unknown>>;
}

export interface FakeCall {
  kind: "rpc" | "from" | "storage";
  name: string;
  args: unknown[];
}

export type FakeDb = Db & { calls: FakeCall[] };

const registered = (table: object | undefined, name: string): unknown =>
  table === undefined ? undefined : Reflect.get(table, name);

/**
 * A database client for unit tests (CS-12, R50): it answers only what the test registers and throws
 * `unexpected rpc <name>` (or table, or storage method) for anything else, so a service that makes a
 * call the test did not expect fails at that call. Every call is recorded in `calls`.
 */
export function fakeDb(options: FakeDbOptions = {}): FakeDb {
  const calls: FakeCall[] = [];

  const rpc = (name: string, args?: unknown) => {
    calls.push({ kind: "rpc", name, args: [args] });
    const handler = registered(options.rpc, name);
    if (typeof handler !== "function") throw new Error(`unexpected rpc ${name}`);
    const result: unknown = Reflect.apply(handler, undefined, [args]);
    return Promise.resolve(
      result instanceof Error ? { data: null, error: result } : { data: result, error: null },
    );
  };

  const from = (name: string) => {
    calls.push({ kind: "from", name, args: [] });
    const rows = registered(options.tables, name);
    if (!Array.isArray(rows)) throw new Error(`unexpected table ${name}`);
    return { select: () => Promise.resolve({ data: rows, error: null }) };
  };

  const storage = {
    from: (bucket: string) =>
      new Proxy(
        {},
        {
          get: (_target, method) => {
            if (typeof method !== "string") return undefined;
            return (...args: unknown[]) => {
              calls.push({ kind: "storage", name: `${bucket}.${method}`, args });
              const handler = registered(options.storage?.[bucket], method);
              if (typeof handler !== "function") {
                throw new Error(`unexpected storage ${bucket}.${method}`);
              }
              const result: unknown = Reflect.apply(handler, undefined, args);
              return result;
            };
          },
        },
      ),
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the fake client (CS-12)
  return { rpc, from, storage, calls } as unknown as FakeDb;
}
