import type { Database } from "../../src/db";
import type { Db } from "../../src/server/lib/db";

type PublicSchema = Database["public"];

export interface FakeDbOptions {
  rpc?: {
    [F in keyof PublicSchema["Functions"]]?: (
      args: PublicSchema["Functions"][F]["Args"],
    ) =>
      | PublicSchema["Functions"][F]["Returns"]
      | Error
      | Promise<PublicSchema["Functions"][F]["Returns"] | Error>;
  };
  tables?: { [T in keyof PublicSchema["Tables"]]?: PublicSchema["Tables"][T]["Row"][] } & {
    [V in keyof PublicSchema["Views"]]?: PublicSchema["Views"][V]["Row"][];
  };
  storage?: Record<string, Record<string, (...args: unknown[]) => unknown>>;
}

export interface FakeCall {
  kind: "rpc" | "from" | "storage";
  name: string;
  args: unknown[];
}

export type FakeDb = Db & { calls: FakeCall[] };

interface FakeQuery extends Promise<{ data: unknown[]; error: null }> {
  is: () => FakeQuery;
  gt: () => FakeQuery;
  eq: () => FakeQuery;
  in: () => FakeQuery;
  lte: () => FakeQuery;
  lt: () => FakeQuery;
  or: () => FakeQuery;
  order: () => FakeQuery;
  limit: () => FakeQuery;
}

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
    return Promise.resolve(result).then((answer) =>
      answer instanceof Error ? { data: null, error: answer } : { data: answer, error: null },
    );
  };

  const from = (name: string) => {
    calls.push({ kind: "from", name, args: [] });
    const rows = registered(options.tables, name);
    if (!Array.isArray(rows)) throw new Error(`unexpected table ${name}`);
    // Filters are the database's work: a registered table answers the rows the query is meant to return.
    const query = (): FakeQuery =>
      Object.assign(Promise.resolve({ data: rows, error: null }), {
        is: query,
        gt: query,
        eq: query,
        in: query,
        lte: query,
        lt: query,
        or: query,
        order: query,
        limit: query,
      });
    return { select: query };
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
