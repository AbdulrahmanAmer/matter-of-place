// The one call counter of the repository (S52, F24, JOB-03): a test that asserts "this path makes N database calls"
// wraps its client in `countingDb` and reads `counts`. It counts what the code asks of the client, so it sees an RPC, a
// table read and a Storage call alike, whether the client is real (supabase-js) or `fakeDb`.
import type { Db } from "../../src/server/lib/db";

export interface Counts {
  rpc: Record<string, number>;
  from: Record<string, number>;
  /** Keyed `<bucket>.<method>`. */
  storage: Record<string, number>;
  total: number;
}

export type CountingDb = Db & { counts: Counts; reset: () => void };

const emptyCounts = (): Counts => ({ rpc: {}, from: {}, storage: {}, total: 0 });

export function countingDb(db: Db): CountingDb {
  const counts = emptyCounts();
  const note = (group: "rpc" | "from" | "storage", name: string): void => {
    counts[group][name] = (counts[group][name] ?? 0) + 1;
    counts.total += 1;
  };
  const reset = (): void => {
    Object.assign(counts, emptyCounts());
  };

  const countedBucket = (bucket: string): unknown => {
    const client: unknown = db.storage.from(bucket);
    if (typeof client !== "object" || client === null) return client;
    return new Proxy(client, {
      get: (target, method) => {
        const member: unknown = Reflect.get(target, method);
        if (typeof method !== "string" || typeof member !== "function") return member;
        return (...args: unknown[]): unknown => {
          note("storage", `${bucket}.${method}`);
          return Reflect.apply(member, target, args);
        };
      },
    });
  };
  const countedStorage = new Proxy(db.storage, {
    get: (target, name) =>
      name === "from" ? countedBucket : bind(Reflect.get(target, name), target),
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the counter: a proxy over a Db that also answers `counts` and `reset`
  return new Proxy(db, {
    get: (target, name) => {
      if (name === "counts") return counts;
      if (name === "reset") return reset;
      if (name === "storage") return countedStorage;
      const member: unknown = Reflect.get(target, name);
      if ((name === "rpc" || name === "from") && typeof member === "function") {
        return (called: string, ...rest: unknown[]): unknown => {
          note(name, called);
          return Reflect.apply(member, target, [called, ...rest]);
        };
      }
      return bind(member, target);
    },
  }) as CountingDb;
}

/** A method is called on its owner, so supabase-js finds its own fields. */
function bind(member: unknown, owner: object): unknown {
  return typeof member === "function" ? member.bind(owner) : member;
}
