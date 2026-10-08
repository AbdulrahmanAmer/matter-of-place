// B8b step 6: the admin functions of `/api/admin/automation/*` (`src/server/automation/service.ts`). Each write is one
// RPC with the actor; the revision and audit rows are the function's and are asserted in tests/db/automation.db.test.ts.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Tables } from "../../../src/db";
import {
  getRecipes,
  listRevisions,
  putChannelSettings,
  putRecipe,
  putScheduleSettings,
  putTemplate,
  restoreRevision,
} from "../../../src/server/automation/service";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { fakeDb, type FakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

const USER = "00000000-0000-4000-8000-000000000001";
const REVISION = "3f2a9c1d-0000-4000-8000-0000000000a1";
const ROW = "3f2a9c1d-0000-4000-8000-0000000000b1";
const AT = "2026-10-05T09:00:00+00:00";

const actor = (
  roles: AdminActor["roles"],
  kind: AdminActor["kind"] = "human",
  scopes: string[] = [],
): AdminActor => ({ userId: USER, kind, roles, scopes, requestId: "req-auto" });

const chief = actor(["chief_editor"]);
const commercial = actor(["commercial"]);
const admin = actor(["admin"]);
const agent = actor(["admin"], "agent", ["automation"]);
const unscopedAgent = actor(["admin"], "agent", ["channels"]);

const step = (overrides: Record<string, unknown> = {}) => ({
  id: "send_received",
  step_type: "send_email",
  params: { template: "received" },
  ...overrides,
});

const manual = { Feature: "manual", Reach: "manual", Campaign: "manual" } as const;

const window = (overrides: Record<string, unknown> = {}) => ({
  days: [1, 2, 3, 4, 5],
  from: "09:00",
  to: "17:00",
  tz: "America/New_York",
  ...overrides,
});

const channelRow = (
  approval_mode: Record<string, string> = manual,
): Tables<"channel_settings"> => ({
  id: ROW,
  channel: "instagram",
  enabled: true,
  posting_window: window({ daily_cap: 2 }),
  approval_mode,
  auto_after: null,
  credentials_ref: null,
  created_at: AT,
  updated_at: AT,
});

const scheduleRow = (key: string, cron: string): Tables<"schedule_settings"> => ({
  id: ROW,
  key,
  cron,
  interval_days: null,
  enabled: true,
  last_run_at: AT,
  next_run_at: null,
  created_at: AT,
  updated_at: AT,
});

const revisionRow = (
  table_name: string,
  before: Tables<"automation_revisions">["before"],
): Tables<"automation_revisions"> => ({
  id: REVISION,
  table_name,
  row_id: ROW,
  before,
  after: null,
  actor_id: USER,
  actor_kind: "human",
  note: null,
  at: AT,
});

const answer = { ok: true };

function db(tables: FakeDbOptions["tables"] = {}): FakeDb {
  return fakeDb({
    rpc: {
      automation_put_recipe: () => answer,
      automation_put_template: () => answer,
      automation_put_channel: () => answer,
      automation_put_schedule: () => answer,
      automation_restore_revision: () => answer,
    },
    tables,
  });
}

const rpcs = (database: FakeDb) => database.calls.filter((call) => call.kind === "rpc");

const refusal = z.object({
  code: z.string(),
  status: z.number(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })).optional(),
});

/** The code, status and issue paths of the thrown error, each path written as the client shows it. */
async function refused(promise: Promise<unknown>) {
  const thrown: unknown = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  const { code, status, issues = [] } = refusal.parse(thrown);
  const paths = issues.map((issue) =>
    issue.path
      .map((part, index) =>
        typeof part === "number" ? `[${String(part)}]` : index === 0 ? part : `.${part}`,
      )
      .join(""),
  );
  return { code, status, paths };
}

describe("putRecipe", () => {
  it("commercial gets 403 and no database call", async () => {
    const database = db();
    expect(
      await refused(putRecipe(commercial, database, { trigger: "submission.received", name: "x" })),
    ).toMatchObject({ code: "forbidden", status: 403 });
    expect(database.calls).toEqual([]);
  });

  it("chief_editor makes one automation_put_recipe call with its actor and no other call", async () => {
    const database = db();
    expect(
      await putRecipe(chief, database, {
        trigger: "submission.received",
        enabled: false,
        steps: [step()],
      }),
    ).toEqual(answer);
    expect(database.calls).toEqual([
      {
        kind: "rpc",
        name: "automation_put_recipe",
        args: [
          {
            p_trigger: "submission.received",
            p_patch: {
              enabled: false,
              steps: [
                {
                  id: "send_received",
                  step_type: "send_email",
                  params: { template: "received" },
                  enabled: true,
                  requires_approval: false,
                  conditions: {},
                },
              ],
            },
            p_actor: USER,
            p_actor_kind: "human",
            p_request_id: "req-auto",
          },
        ],
      },
    ]);
  });

  it("an agent key with the automation scope passes with actor_kind agent", async () => {
    const database = db();
    await putRecipe(agent, database, { trigger: "submission.received", name: "Edited" });
    expect(rpcs(database).map((call) => call.args[0])).toMatchObject([{ p_actor_kind: "agent" }]);
  });

  it("an agent key without the automation scope gets 403", async () => {
    const database = db();
    expect(
      await refused(putRecipe(unscopedAgent, database, { trigger: "submission.received" })),
    ).toMatchObject({ code: "out_of_scope", status: 403 });
    expect(database.calls).toEqual([]);
  });

  it.each([
    ["a duplicate step id", [step(), step()], "steps[1].id"],
    [
      "21 steps",
      Array.from({ length: 21 }, (_, index) => step({ id: `s${String(index)}` })),
      "steps",
    ],
    [
      "a market outside the three",
      [step({ conditions: { markets: ["texas"] } })],
      "steps[0].conditions.markets[0]",
    ],
    ["an unknown template", [step({ params: { template: "nope" } })], "steps[0].params.template"],
    [
      "a param its step does not take",
      [step({ params: { template: "received", attach: "zip" } })],
      "steps[0].params.attach",
    ],
    ["an unknown step type", [step({ step_type: "post_tiktok" })], "steps[0].step_type"],
  ])("refuses %s with 422 and its path", async (_label, steps, path) => {
    const database = db();
    const result = await refused(
      putRecipe(chief, database, { trigger: "submission.received", steps }),
    );
    expect(result).toMatchObject({ code: "validation", status: 422 });
    expect(result.paths).toContain(path);
    expect(database.calls).toEqual([]);
  });
});

describe("putTemplate", () => {
  it("commercial gets 403 and no database call", async () => {
    const database = db();
    expect(
      await refused(putTemplate(commercial, database, { key: "received", subject: "Hello" })),
    ).toMatchObject({ code: "forbidden", status: 403 });
    expect(database.calls).toEqual([]);
  });

  it("chief_editor makes one automation_put_template call", async () => {
    const database = db();
    await putTemplate(chief, database, { key: "received", subject: "Hello" });
    expect(database.calls).toEqual([
      {
        kind: "rpc",
        name: "automation_put_template",
        args: [
          {
            p_key: "received",
            p_patch: { subject: "Hello" },
            p_actor: USER,
            p_actor_kind: "human",
            p_request_id: "req-auto",
          },
        ],
      },
    ]);
  });
});

describe("putChannelSettings", () => {
  it.each([
    ["a daily_cap of 0", window({ daily_cap: 0 }), "posting_window.daily_cap"],
    ["no tz", window({ tz: undefined }), "posting_window.tz"],
    ["an unknown zone", window({ tz: "Mars/Base" }), "posting_window.tz"],
    ["from after to", window({ from: "18:00" }), "posting_window.from"],
  ])(
    "refuses a posting window with %s with 422 and its path",
    async (_label, posting_window, path) => {
      const database = db();
      expect(
        await refused(putChannelSettings(chief, database, { channel: "x", posting_window })),
      ).toEqual({ code: "validation", status: 422, paths: [path] });
      expect(database.calls).toEqual([]);
    },
  );

  it("an agent that sets a tier to auto gets 403 human_only and no write", async () => {
    const database = db({ channel_settings: [channelRow()] });
    expect(
      await refused(
        putChannelSettings(agent, database, {
          channel: "instagram",
          approval_mode: { ...manual, Feature: "auto" },
        }),
      ),
    ).toMatchObject({ code: "human_only", status: 403 });
    expect(rpcs(database)).toEqual([]);
  });

  it("a person may set a tier to auto, with one automation_put_channel call", async () => {
    const database = db();
    await putChannelSettings(admin, database, {
      channel: "instagram",
      approval_mode: { ...manual, Feature: "auto" },
    });
    expect(rpcs(database).map((call) => call.name)).toEqual(["automation_put_channel"]);
  });
});

describe("putScheduleSettings", () => {
  it("a PUT of last_run_at alone on digest makes one call whose p_patch is exactly that key", async () => {
    const database = db();
    await putScheduleSettings(chief, database, {
      key: "digest",
      last_run_at: "2026-10-20T14:00:00Z",
    });
    expect(database.calls).toEqual([
      {
        kind: "rpc",
        name: "automation_put_schedule",
        args: [
          {
            p_key: "digest",
            p_patch: { last_run_at: "2026-10-20T14:00:00Z" },
            p_actor: USER,
            p_actor_kind: "human",
            p_request_id: "req-auto",
          },
        ],
      },
    ]);
  });

  it("refuses a key outside the four with 422 and no call", async () => {
    const database = db();
    expect(
      await refused(putScheduleSettings(chief, database, { key: "digest", next_run_at: AT })),
    ).toMatchObject({ code: "validation", status: 422 });
    expect(database.calls).toEqual([]);
  });

  it.each(["audit", "backup", "keepwarm"])(
    "answers the function's external_clock for a cron change of %s with 422",
    async (key) => {
      const database = fakeDb({
        rpc: { automation_put_schedule: () => new Error("external_clock") },
      });
      expect(
        await refused(putScheduleSettings(chief, database, { key, cron: "*/5 * * * *" })),
      ).toMatchObject({ code: "external_clock", status: 422 });
    },
  );

  it.each([
    ["switches backup off", "backup", { enabled: false }],
    ["re-times reconcile", "reconcile", { cron: "*/30 * * * *" }],
  ])(
    "an agent that %s gets 403 human_only, a person passes (PROTECTED_SCHEDULES)",
    async (_label, key, patch) => {
      const forAgent = db({ schedule_settings: [scheduleRow(key, "*/15 * * * *")] });
      expect(await refused(putScheduleSettings(agent, forAgent, { key, ...patch }))).toMatchObject({
        code: "human_only",
        status: 403,
      });
      expect(rpcs(forAgent)).toEqual([]);
      const forPerson = db();
      await putScheduleSettings(admin, forPerson, { key, ...patch });
      expect(rpcs(forPerson).map((call) => call.name)).toEqual(["automation_put_schedule"]);
    },
  );
});

describe("restoreRevision", () => {
  it("an agent restore whose before sets approval_mode.Feature to auto gets 403 human_only", async () => {
    const before = { ...channelRow({ ...manual, Feature: "auto" }) };
    const database = db({
      automation_revisions: [revisionRow("channel_settings", before)],
      channel_settings: [channelRow()],
    });
    expect(await refused(restoreRevision(agent, database, { id: REVISION }))).toMatchObject({
      code: "human_only",
      status: 403,
    });
    expect(rpcs(database)).toEqual([]);
  });

  it("refuses a before that no longer parses with 422 and its path", async () => {
    const database = db({
      automation_revisions: [
        revisionRow("schedule_settings", { ...scheduleRow("digest", "0 14 * * 2"), cron: "soon" }),
      ],
    });
    expect(await refused(restoreRevision(admin, database, { id: REVISION }))).toEqual({
      code: "validation",
      status: 422,
      paths: ["cron"],
    });
    expect(rpcs(database)).toEqual([]);
  });

  it("a person's restore makes one automation_restore_revision call", async () => {
    const database = db({
      automation_revisions: [
        revisionRow("channel_settings", channelRow({ ...manual, Reach: "auto" })),
      ],
    });
    await restoreRevision(chief, database, { id: REVISION });
    expect(rpcs(database).map((call) => call.args[0])).toEqual([
      { p_revision_id: REVISION, p_actor: USER, p_actor_kind: "human", p_request_id: "req-auto" },
    ]);
  });
});

describe("listRevisions", () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    ...revisionRow("automation_recipes", null),
    id: `3f2a9c1d-0000-4000-8000-${String(index).padStart(12, "0")}`,
  }));

  it("answers one page of at most 50 with the cursor of its last row", async () => {
    const page = await listRevisions(commercial, db({ automation_revisions: many }), {});
    expect(page.items).toHaveLength(50);
    expect(page.next_cursor).toBe(`${AT}~3f2a9c1d-0000-4000-8000-000000000049`);
  });

  it("continues from a cursor with the rest of that instant, then older rows, and shows no row twice", async () => {
    const stamped = (n: number, minute: number) => ({
      ...revisionRow("automation_recipes", null),
      id: `3f2a9c1d-0000-4000-8000-00000000000${String(n)}`,
      at: `2026-10-07T10:0${String(minute)}:00+00:00`,
    });
    const [r9, r8, r7, r5, r4] = [
      stamped(9, 2),
      stamped(8, 2),
      stamped(7, 2),
      stamped(5, 1),
      stamped(4, 1),
    ];
    // The database filters, orders and limits (fake-db.ts); each list is what it would answer to one query of the page.
    const scripted = (...answers: (typeof r9)[][]) => {
      const queue = [...answers];
      return db({
        get automation_revisions() {
          return queue.shift() ?? [];
        },
      });
    };
    const first = await listRevisions(chief, scripted([r9, r8, r7]), { limit: "2" });
    const second = await listRevisions(chief, scripted([r7], [r5, r4]), {
      limit: "2",
      cursor: first.next_cursor,
    });
    const third = await listRevisions(chief, scripted([r4], []), {
      limit: "2",
      cursor: second.next_cursor,
    });
    const ids = [first, second, third].map((page) => page.items.map((item) => item.id.slice(-1)));
    expect({
      ids,
      cursors: [first.next_cursor, second.next_cursor, third.next_cursor],
    }).toEqual({
      ids: [["9", "8"], ["7", "5"], ["4"]],
      cursors: [`${r8.at}~${r8.id}`, `${r5.at}~${r5.id}`, null],
    });
  });

  it("refuses a limit over 50 and a cursor that is not <at>~<id> with 422", async () => {
    const database = db({ automation_revisions: many });
    expect(await refused(listRevisions(chief, database, { limit: "51" }))).toMatchObject({
      code: "validation",
      status: 422,
    });
    expect(await refused(listRevisions(chief, database, { cursor: "soon~x" }))).toMatchObject({
      code: "validation",
      status: 422,
    });
    expect(database.calls).toEqual([]);
  });
});

describe("getRecipes", () => {
  const recipe: Tables<"automation_recipes"> = {
    id: ROW,
    trigger: "submission.received",
    name: "Submission received",
    enabled: true,
    steps: [],
    version: 1,
    created_at: AT,
    updated_at: AT,
  };

  it("answers the recipes with the step catalog the editor draws from, without any Zod schema", async () => {
    const { items, steps } = await getRecipes(commercial, db({ automation_recipes: [recipe] }));
    expect(items).toEqual([recipe]);
    expect(steps).toHaveLength(17);
    expect(steps.find((spec) => spec.type === "purge_cache")).toMatchObject({
      label: "Purge cache",
      local: false,
      implemented: true,
      fields: [
        { key: "scope", kind: "select" },
        { key: "indexnow", kind: "boolean" },
      ],
    });
    expect(JSON.stringify(steps)).not.toContain("paramsSchema");
  });
});
