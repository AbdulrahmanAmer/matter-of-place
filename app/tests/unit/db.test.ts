import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../fixtures/fake-db";

// env.ts parses `process.env` when it is first imported, so each test sets the environment and loads a fresh module.
async function load(values: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  return import("../../src/server/lib/db");
}

const LOCAL = { MOP_ENV: "local", RATE_LIMIT_SALT: "salt" };
const WITH_DB = {
  ...LOCAL,
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getDb", () => {
  it("throws 503 unavailable when the Worker holds no Supabase key", async () => {
    const { getDb } = await load(LOCAL);
    expect(() => getDb()).toThrow(expect.objectContaining({ code: "unavailable", status: 503 }));
  });

  it("returns one client for the isolate", async () => {
    const { getDb } = await load(WITH_DB);
    expect(getDb()).toBe(getDb());
  });

  it("gives back the fake that setDbForTests installed, and the real client after undefined", async () => {
    const { getDb, setDbForTests } = await load(WITH_DB);
    const fake = fakeDb();
    setDbForTests(fake);
    expect(getDb()).toBe(fake);
    setDbForTests(undefined);
    expect(getDb()).not.toBe(fake);
  });
});

describe("the request counter", () => {
  it("counts every request to Supabase and resets to zero", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json(true)));
    const { dbCallCount, getDb, resetDbCallCount } = await load(WITH_DB);
    await getDb().rpc("is_staff");
    await getDb().rpc("is_staff");
    expect(dbCallCount()).toBe(2);
    resetDbCallCount();
    expect(dbCallCount()).toBe(0);
  });
});

describe("the read timeout", () => {
  // A fetch that answers only when its signal aborts, like a database that never replies.
  const hangsUntilAborted = (_url: unknown, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });

  it("abandons public_state after 2 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangsUntilAborted);
    const { getDb } = await load(WITH_DB);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- public_state joins the generated types when B2 migration 9 reaches mop-dev
    const pending = getDb().rpc("public_state" as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.stringify(await pending)).toContain("aborted");
  });

  it("leaves a write function without the 2 second limit", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", (_url: unknown, init: RequestInit) => {
      signal = init.signal;
      return Promise.resolve(Response.json(true));
    });
    const { getDb } = await load(WITH_DB);
    await getDb().rpc("is_staff");
    expect(signal ?? null).toBeNull();
  });
});
