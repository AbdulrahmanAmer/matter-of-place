import { describe, expect, it } from "vitest";
import { pushMigrations } from "../../scripts/db-push.mjs";
import {
  findBranchMigrations,
  findChecksumDrift,
  findForeignMigrations,
  findOutOfOrder,
  migrationFiles,
  shouldCheckBranch,
} from "../../scripts/lib/push-guard.mjs";

const REF = "hbokkmpgpqhrnemgsqra";
const A = "20261001090000_extensions_enums.sql";
const B = "20261001090100_people_audit.sql";
const C = "20261001090200_role_helpers.sql";

interface Checksum {
  version: string;
  sha256: string;
}

interface FakeState {
  env?: Record<string, string | undefined>;
  environment?: string | null;
  versions?: string[];
  checksums?: Checksum[];
  local?: { file: string; sha256: string }[];
  mainFiles?: string[];
}

/** Runs pushMigrations on a fake database and CLI; returns what it did, in order, and the refusal if any. */
async function push(state: FakeState) {
  const calls: string[] = [];
  const local = state.local ?? [
    { file: A, sha256: "a1" },
    { file: B, sha256: "b1" },
  ];
  let versions = state.versions ?? [];
  const env = state.env ?? { DEV_SUPABASE_PROJECT_REF: REF, DEV_SUPABASE_DB_PASSWORD: "pw" };
  const outcome = await pushMigrations({
    env,
    linkedRef: REF,
    local,
    mainFiles: () => {
      calls.push("branch check");
      return state.mainFiles ?? local.map(({ file }) => file);
    },
    connect: (dbUrl) => {
      calls.push(`connect ${new URL(dbUrl).username}`);
      return Promise.resolve({
        environment: () => Promise.resolve(state.environment ?? null),
        lock: () => {
          calls.push("lock");
          return Promise.resolve();
        },
        history: () => Promise.resolve({ versions, checksums: state.checksums ?? [] }),
        record: (rows) => {
          calls.push(`record ${rows.map((row) => `${row.version}=${row.sha256}`).join(" ")}`);
          return Promise.resolve();
        },
        end: () => {
          calls.push("end");
          return Promise.resolve();
        },
      });
    },
    supabase: (args, cliEnv) => {
      calls.push(`supabase ${args.join(" ")} password=${cliEnv["SUPABASE_DB_PASSWORD"] ?? "none"}`);
      if (!args.includes("--dry-run")) versions = local.map(({ file }) => file.slice(0, 14));
      return 0;
    },
  }).then(
    () => "pushed",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  return { calls, outcome };
}

describe("push-guard (invariant 17)", () => {
  it("findBranchMigrations names files in one list and not the other", () => {
    expect(findBranchMigrations([A, B, C], [A, B])).toEqual([C]);
    expect(findBranchMigrations([A], [A, B])).toEqual([B]);
    expect(findBranchMigrations([A, B], [A, B])).toEqual([]);
  });

  it("findOutOfOrder names an unapplied file older than the newest applied one", () => {
    expect(findOutOfOrder(["20261001090000", "20261001090200"], [A, B, C])).toEqual([B]);
    expect(findOutOfOrder(["20261001090000"], [A, B, C])).toEqual([]);
    expect(findOutOfOrder([], [A, B])).toEqual([]);
  });

  it("findChecksumDrift names an applied version whose file hash changed", () => {
    expect(
      findChecksumDrift(
        [
          { version: "20261001090000", sha256: "a1" },
          { version: "20261001090100", sha256: "b1" },
        ],
        [
          { file: A, sha256: "a1" },
          { file: B, sha256: "b2" },
        ],
      ),
    ).toEqual(["20261001090100"]);
  });

  it("findForeignMigrations is the reset guard's, re-exported", () => {
    expect(findForeignMigrations(["20261001090000", "20261001100000"], [A])).toEqual([
      "20261001100000",
    ]);
  });

  it("migrationFiles keeps the sorted .sql names of git ls-tree lines", () => {
    expect(
      migrationFiles([
        `supabase/migrations/${B}`,
        "supabase/migrations/README.md",
        `supabase/migrations/${A}`,
        "",
      ]),
    ).toEqual([A, B]);
  });

  it.each([
    { singleLane: true, environment: "development", check: false },
    { singleLane: true, environment: null, check: false },
    { singleLane: true, environment: "production", check: true },
    { singleLane: false, environment: "development", check: true },
    { singleLane: false, environment: "production", check: true },
  ])(
    "shouldCheckBranch singleLane $singleLane, stage $environment: $check",
    ({ singleLane, environment, check }) => {
      expect(shouldCheckBranch({ singleLane, environment })).toBe(check);
    },
  );
});

describe("db:push refuses before the CLI runs (invariant 17, ruling H35)", () => {
  it("refuses a remote-only version, naming it", async () => {
    const { calls, outcome } = await push({ versions: ["20261001090000", "20261001090050"] });
    expect({ outcome, cli: calls.filter((call) => call.startsWith("supabase")) }).toEqual({
      outcome: "refusing: remote-only migrations 20261001090050 (rebase onto origin/main first)",
      cli: [],
    });
  });

  it("refuses an older local version not yet applied, naming it", async () => {
    const { calls, outcome } = await push({
      versions: ["20261001090000", "20261001090200"],
      local: [
        { file: A, sha256: "a1" },
        { file: B, sha256: "b1" },
        { file: C, sha256: "c1" },
      ],
    });
    expect({ outcome, cli: calls.filter((call) => call.startsWith("supabase")) }).toEqual({
      outcome: `refusing: out-of-order migration ${B} (regenerate the timestamp with supabase migration new)`,
      cli: [],
    });
  });

  it("refuses an applied file whose hash changed, naming the version", async () => {
    const { calls, outcome } = await push({
      versions: ["20261001090000"],
      checksums: [{ version: "20261001090000", sha256: "a0" }],
    });
    expect({ outcome, cli: calls.filter((call) => call.startsWith("supabase")) }).toEqual({
      outcome:
        "refusing: edited migration 20261001090000 (an applied migration is never edited; add a new one)",
      cli: [],
    });
  });

  it("refuses branch migrations, naming the files, outside the single-lane exception", async () => {
    const { calls, outcome } = await push({ mainFiles: [A] });
    expect({ outcome, calls }).toEqual({
      outcome: `refusing: branch migrations ${B}`,
      calls: [`connect postgres.${REF}`, "branch check", "end"],
    });
  });

  it("checks the branch with MOP_SINGLE_LANE=1 once the stage is production", async () => {
    const { outcome } = await push({
      env: { DEV_SUPABASE_PROJECT_REF: REF, DEV_SUPABASE_DB_PASSWORD: "pw", MOP_SINGLE_LANE: "1" },
      environment: "production",
      mainFiles: [A],
    });
    expect(outcome).toBe(`refusing: branch migrations ${B}`);
  });

  it("skips the branch check with MOP_SINGLE_LANE=1 before the launch switch", async () => {
    const { calls, outcome } = await push({
      env: { DEV_SUPABASE_PROJECT_REF: REF, DEV_SUPABASE_DB_PASSWORD: "pw", MOP_SINGLE_LANE: "1" },
      environment: "development",
      mainFiles: [A],
    });
    expect({ outcome, branchChecked: calls.includes("branch check") }).toEqual({
      outcome: "pushed",
      branchChecked: false,
    });
  });

  it("refuses a target whose ref differs from the linked project", async () => {
    const { calls, outcome } = await push({
      env: { DEV_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", DEV_SUPABASE_DB_PASSWORD: "pw" },
    });
    expect({ outcome: outcome.startsWith("refusing: ref mismatch"), calls }).toEqual({
      outcome: true,
      calls: [],
    });
  });

  it("a clean state takes the lock, dry-runs, pushes and records every applied hash", async () => {
    const { calls, outcome } = await push({});
    expect({ outcome, calls }).toEqual({
      outcome: "pushed",
      calls: [
        `connect postgres.${REF}`,
        "branch check",
        "lock",
        "supabase db push --linked --dry-run password=pw",
        "supabase db push --linked --yes password=pw",
        "record 20261001090000=a1 20261001090100=b1",
        "end",
      ],
    });
  });

  it("leaves the lock to its holder when MOP_DEV_LOCK_HELD=1", async () => {
    const { calls } = await push({
      env: {
        DEV_SUPABASE_PROJECT_REF: REF,
        DEV_SUPABASE_DB_PASSWORD: "pw",
        MOP_DEV_LOCK_HELD: "1",
      },
    });
    expect(calls.includes("lock")).toBe(false);
  });
});
