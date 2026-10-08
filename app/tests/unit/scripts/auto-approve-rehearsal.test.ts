// B10 step 10: scripts/auto-approve-rehearsal.ts. The Supabase client is a small stateful stub, `maybeAutoApprove`, the
// production guard and the dev lock are stubs, so no connection is opened (R50); the cases prove what the script
// writes, in which order, and that the `instagram` row and the lock are given back on every path.
import { createClient } from "@supabase/supabase-js";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoApproveRehearsalMain } from "../../../scripts/auto-approve-rehearsal";
import { assertNotProduction } from "../../../scripts/lib/assert-not-production.mjs";
import { runScript } from "../../../scripts/lib/social-script";
import { maybeAutoApprove, type AutoApproval } from "../../../src/server/channels/auto-approve";
import { holdDevLock } from "../../fixtures/dev-lock";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(() => Promise.resolve()) }));
vi.mock("../../../scripts/lib/guard-env.mjs", () => ({ guardEnv: vi.fn() }));
vi.mock("../../../scripts/lib/assert-not-production.mjs", () => ({ assertNotProduction: vi.fn() }));
vi.mock("../../fixtures/dev-lock", () => ({ holdDevLock: vi.fn() }));
vi.mock("../../../src/server/channels/auto-approve", () => ({ maybeAutoApprove: vi.fn() }));

const NOW = new Date("2026-10-08T05:20:41.000Z");
const FEATURE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const FEATURE_ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMPAIGN_ASSET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

const BEFORE = {
  channel: "instagram",
  enabled: false,
  approval_mode: { Feature: "manual", Reach: "manual", Campaign: "manual" },
  auto_after: null,
};

let events: string[];
let tables: Record<string, Row[]>;
let inserted: Row[];
let lines: string[];
let socialPostAppears: boolean;

/** One query against the stub tables: the filters narrow the rows, the verb decides what is written or answered. */
class Query {
  private verb: "select" | "update" | "insert" = "select";
  private payload: Row = {};
  private filters: ((row: Row) => boolean)[] = [];
  private only = false;

  constructor(private readonly table: string) {}

  select(): this {
    return this;
  }
  update(payload: Row): this {
    this.verb = "update";
    this.payload = payload;
    return this;
  }
  insert(payload: Row): this {
    this.verb = "insert";
    this.payload = payload;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  single(): this {
    this.only = true;
    return this;
  }

  private run(): { data: unknown; error: null } {
    const rows = (tables[this.table] ?? []).filter((row) =>
      this.filters.every((keep) => keep(row)),
    );
    if (this.verb === "update") {
      events.push(`update ${this.table} ${JSON.stringify(this.payload)}`);
      for (const row of rows) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    if (this.verb === "insert") {
      const row = { ...this.payload, id: inserted.length === 0 ? FEATURE_ASSET : CAMPAIGN_ASSET };
      inserted.push(row);
      events.push(`insert ${this.table}`);
      return { data: row, error: null };
    }
    const answer = this.table === "social_posts" && !socialPostAppears ? [] : rows;
    return { data: this.only ? answer[0] : answer, error: null };
  }

  // The supabase-js builder is awaited, so the stub is too.
  then<T>(onFulfilled: (value: { data: unknown; error: null }) => T): Promise<T> {
    return Promise.resolve(this.run()).then(onFulfilled);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the stub client (CS-12)
const client = (stub: object) => stub as unknown as ReturnType<typeof createClient>;

function approvals(feature: AutoApproval, campaign: AutoApproval) {
  vi.mocked(maybeAutoApprove).mockImplementation((_db, id) => {
    events.push(`approve ${id}`);
    return Promise.resolve(id === FEATURE_ASSET ? feature : campaign);
  });
}

const APPROVED: AutoApproval = { status: "approved", eventId: "event-1" };
const MANUAL: AutoApproval = { status: "not_eligible", reason: "tier_manual" };

beforeEach(() => {
  events = [];
  lines = [];
  inserted = [];
  socialPostAppears = true;
  tables = {
    channel_settings: [{ ...BEFORE }],
    properties: [
      { id: FEATURE, campaign_tier: "Feature", editorial_state: "published" },
      { id: CAMPAIGN, campaign_tier: "Campaign", editorial_state: "published" },
    ],
    assets: [],
    social_posts: [{ asset_id: FEATURE_ASSET, channel: "instagram", status: "scheduled" }],
  };
  vi.stubEnv("DEV_SUPABASE_PROJECT_REF", "projectref");
  vi.stubEnv("DEV_SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.mocked(createClient).mockReturnValue(client({ from: (table: string) => new Query(table) }));
  vi.mocked(assertNotProduction).mockImplementation(() => {
    events.push("guard");
    return Promise.resolve();
  });
  vi.mocked(holdDevLock).mockImplementation(() => {
    events.push("lock");
    return Promise.resolve(() => {
      events.push("release");
      return Promise.resolve();
    });
  });
  approvals(APPROVED, MANUAL);
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    lines.push(line);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(createClient).mockReset();
  vi.mocked(assertNotProduction).mockReset();
  vi.mocked(holdDevLock).mockReset();
  vi.mocked(maybeAutoApprove).mockReset();
  vi.mocked(sleep).mockClear();
  process.exitCode = undefined;
});

describe("auto-approve-rehearsal", () => {
  it("guards, takes the lock, switches instagram to Feature auto, approves, restores it and releases", async () => {
    expect(await autoApproveRehearsalMain(["--target", "dev"], NOW)).toBe(0);
    expect(events).toEqual([
      "guard",
      "lock",
      'update channel_settings {"enabled":true,"approval_mode":{"Feature":"auto","Reach":"manual","Campaign":"manual"},"auto_after":"2026-10-07"}',
      "insert assets",
      "insert assets",
      `approve ${FEATURE_ASSET}`,
      `approve ${CAMPAIGN_ASSET}`,
      'update channel_settings {"enabled":false,"approval_mode":{"Feature":"manual","Reach":"manual","Campaign":"manual"},"auto_after":null}',
      "release",
    ]);
    expect(lines).toEqual([
      `approved ${FEATURE_ASSET}`,
      `not_eligible ${CAMPAIGN_ASSET} tier_manual`,
      "social_posts instagram scheduled",
    ]);
    expect(tables["channel_settings"]?.[0]).toMatchObject(BEFORE);
  });

  it("inserts two pending fixture carousels with files, caption, alt text and the fixture mark", async () => {
    await autoApproveRehearsalMain([], NOW);
    expect(inserted).toHaveLength(2);
    expect(inserted.map((row) => row["property_id"])).toEqual([FEATURE, CAMPAIGN]);
    for (const row of inserted) {
      expect(row).toMatchObject({
        kind: "carousel",
        revision: 1,
        meta: { fixture: "rehearsal" },
        caption: expect.stringMatching(/\S/) as unknown,
        alt_text: expect.stringMatching(/\S/) as unknown,
      });
      expect(row["files"]).toHaveLength(2);
      expect(row).not.toHaveProperty("status");
    }
  });

  it("takes the next free revision of a property that already has a carousel", async () => {
    tables["assets"] = [
      { property_id: FEATURE, kind: "carousel", revision: 3 },
      { property_id: CAMPAIGN, kind: "carousel", revision: 1 },
    ];
    await autoApproveRehearsalMain([], NOW);
    expect(inserted.map((row) => row["revision"])).toEqual([4, 2]);
  });

  it("refuses after the launch switch before the lock, the client or any write", async () => {
    vi.mocked(assertNotProduction).mockRejectedValue(new Error("refusing: production database"));
    await runScript(() => autoApproveRehearsalMain(["--target", "dev"], NOW));
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual(["refusing: production database"]);
    expect(events).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
    expect(holdDevLock).not.toHaveBeenCalled();
  });

  it("refuses --target prod before the guard", async () => {
    await runScript(() => autoApproveRehearsalMain(["--target", "prod"], NOW));
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual(["refusing: one database (H35)"]);
    expect(assertNotProduction).not.toHaveBeenCalled();
  });

  it("restores the instagram row and releases the lock when the approval throws", async () => {
    vi.mocked(maybeAutoApprove).mockRejectedValue(new Error("database did not answer (assets)"));
    await runScript(() => autoApproveRehearsalMain([], NOW));
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual(["database did not answer (assets)"]);
    expect(tables["channel_settings"]?.[0]).toMatchObject(BEFORE);
    expect(events.at(-1)).toBe("release");
    expect(events.at(-2)).toMatch(/^update channel_settings .*"enabled":false/);
  });

  it("exits 1 and does not wait for a post when the Feature asset is not approved", async () => {
    approvals({ status: "not_eligible", reason: "no_target" }, MANUAL);
    expect(await autoApproveRehearsalMain([], NOW)).toBe(1);
    expect(lines).toEqual([
      `not_eligible ${FEATURE_ASSET} no_target`,
      `not_eligible ${CAMPAIGN_ASSET} tier_manual`,
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("exits 1 when the Campaign asset is approved", async () => {
    approvals(APPROVED, APPROVED);
    expect(await autoApproveRehearsalMain([], NOW)).toBe(1);
  });

  it("polls for the post row for 150 seconds, then exits 1 and still restores the row", async () => {
    socialPostAppears = false;
    expect(await autoApproveRehearsalMain([], NOW)).toBe(1);
    expect(lines.at(-1)).toBe("social_posts instagram none after 150 seconds");
    expect(sleep).toHaveBeenCalledTimes(31);
    expect(tables["channel_settings"]?.[0]).toMatchObject(BEFORE);
  });

  it("stops BLOCKED, with the row restored, when the seed has no published Campaign property", async () => {
    tables["properties"] = [
      { id: FEATURE, campaign_tier: "Feature", editorial_state: "published" },
    ];
    await runScript(() => autoApproveRehearsalMain([], NOW));
    expect(process.exitCode).toBe(1);
    expect(lines).toEqual(["BLOCKED: no published Feature and Campaign property (B2 seed)"]);
    expect(tables["channel_settings"]?.[0]).toMatchObject(BEFORE);
    expect(inserted).toEqual([]);
  });
});
