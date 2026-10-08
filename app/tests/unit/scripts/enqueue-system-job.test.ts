// B10 step 9: scripts/enqueue-system-job.ts. `devDb` and `holdDevLock` are stubs, so no connection is opened (R50);
// the cases prove what the script asks of them and in which order.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueSystemJobMain } from "../../../scripts/enqueue-system-job";
import { devDb, type DevDb } from "../../../scripts/lib/dev-db";
import { runScript } from "../../../scripts/lib/social-script";
import { holdDevLock } from "../../fixtures/dev-lock";

vi.mock("../../../scripts/lib/dev-db", () => ({ devDb: vi.fn() }));
vi.mock("../../../scripts/lib/guard-env.mjs", () => ({ guardEnv: vi.fn() }));
vi.mock("../../fixtures/dev-lock", () => ({ holdDevLock: vi.fn() }));

const NOW = new Date("2026-10-08T05:20:41.000Z");

let events: string[];
let rpcCalls: [string, Record<string, unknown>][];
let lines: string[];

/** The stub database: the schedule row it answers (none for null) and what `enqueue_job` answers. */
function database(enabled: boolean | null, enqueued: string | null = "job-1") {
  const fake: DevDb = {
    rpc: (name, args, answer) => {
      events.push("rpc");
      rpcCalls.push([name, args]);
      return Promise.resolve(answer.parse(enqueued));
    },
    select: (_table, _query, rows) =>
      Promise.resolve(rows.parse(enabled === null ? [] : [{ enabled }])),
  };
  vi.mocked(devDb).mockReturnValue(fake);
  vi.mocked(holdDevLock).mockImplementation(() => {
    events.push("lock");
    return Promise.resolve(() => {
      events.push("release");
      return Promise.resolve();
    });
  });
  return fake;
}

beforeEach(() => {
  events = [];
  rpcCalls = [];
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(devDb).mockReset();
  vi.mocked(holdDevLock).mockReset();
  process.exitCode = undefined;
});

describe("enqueue-system-job", () => {
  it("makes no RPC call and exits 0 when the type's schedule row is disabled", async () => {
    database(false);
    expect(await enqueueSystemJobMain(["--type", "reconcile"], NOW)).toBe(0);
    expect(lines).toEqual(["reconcile disabled"]);
    expect(events).toEqual([]);
  });

  it("takes the dev lock once, before the RPC, and releases it, with --target dev", async () => {
    database(true);
    expect(await enqueueSystemJobMain(["--type", "reconcile", "--target", "dev"], NOW)).toBe(0);
    expect(events).toEqual(["lock", "rpc", "release"]);
  });

  it("refuses --target prod with exit 1 before any connection or RPC", async () => {
    database(true);
    await runScript(() => enqueueSystemJobMain(["--type", "reconcile", "--target", "prod"], NOW));
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual(["refusing: one database (H35)"]);
    expect(devDb).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("enqueues reconcile once with the minute in its key and daily params", async () => {
    database(true);
    expect(await enqueueSystemJobMain(["--type", "reconcile"], NOW)).toBe(0);
    expect(rpcCalls).toEqual([
      [
        "enqueue_job",
        {
          p_type: "reconcile",
          p_payload: { params: { daily: true }, data: {} },
          p_idempotency_key: "reconcile:manual:2026-10-08T05:20",
          p_heavy: false,
        },
      ],
    ]);
    expect(lines).toEqual(["enqueued reconcile:manual:2026-10-08T05:20"]);
  });

  it("prints exists for a second call in the same minute", async () => {
    database(true, null);
    expect(await enqueueSystemJobMain(["--type", "reconcile"], NOW)).toBe(0);
    expect(lines).toEqual(["exists reconcile:manual:2026-10-08T05:20"]);
  });

  it("enqueues a type with no schedule row, empty params and the key it is given", async () => {
    database(null);
    await enqueueSystemJobMain(["--type", "prune", "--key", "prune:once"], NOW);
    expect(rpcCalls[0]?.[1]).toMatchObject({
      p_payload: { params: {}, data: {} },
      p_idempotency_key: "prune:once",
    });
  });

  it("refuses to run without --type", async () => {
    database(true);
    expect(await enqueueSystemJobMain([], NOW)).toBe(1);
    expect(events).toEqual([]);
  });

  it("releases the lock when the RPC fails", async () => {
    const fake = database(true);
    vi.mocked(devDb).mockReturnValue({
      ...fake,
      rpc: () => {
        events.push("rpc");
        return Promise.reject(new Error("database rpc/enqueue_job answered 500: boom"));
      },
    });
    await runScript(() => enqueueSystemJobMain(["--type", "reconcile"], NOW));
    expect(process.exitCode).toBe(1);
    expect(events).toEqual(["lock", "rpc", "release"]);
  });
});
