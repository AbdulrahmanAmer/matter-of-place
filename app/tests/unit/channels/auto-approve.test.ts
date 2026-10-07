// B10 step 6: automatic approval (invariants 4 and 4a). The database is the channel world of tests/fixtures/channel-db.ts
// with a pending asset; B8b's fan-out is replaced, so the cases see which event it is handed. The render steps' last
// line is driven with a stubbed database and a spy around the real `maybeAutoApprove`; the write_captions case is in
// tests/unit/assets/steps.test.ts, beside the caption fixtures it needs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeAutoApprove } from "../../../src/server/channels/auto-approve";
import { getStep } from "../../../src/server/jobs/steps/index";
import { ASSET_ID, assetRow, context, NOW as RENDER_NOW } from "../../fixtures/asset-rows";
import { ASSET, channelWorld, type WorldOptions } from "../../fixtures/channel-db";
import { fakeDb } from "../../fixtures/fake-db";

const fanout = vi.hoisted(() => vi.fn((_db: unknown, _eventId: string) => Promise.resolve(1)));
vi.mock("../../../src/server/automation/fanout", () => ({ fanoutEvent: fanout }));
vi.mock("../../../src/server/channels/auto-approve", async (importOriginal) => {
  const real = await importOriginal<{ maybeAutoApprove: typeof maybeAutoApprove }>();
  return { maybeAutoApprove: vi.fn(real.maybeAutoApprove) };
});

const NOW = new Date("2026-10-06T14:00:00.000Z");
const EVENT = "5e6f7a8b-0000-4000-8000-0000000000e1";

/**
 * A pending, complete carousel of a Feature property; instagram is in Feature `auto` since yesterday unless `options`
 * says otherwise. `auto_approve_asset` approves the row as B9's approve_asset would and answers the event id.
 */
function pending(options: WorldOptions = {}) {
  const made = channelWorld({
    approvalMode: { Feature: "auto", Reach: "manual", Campaign: "manual" },
    autoAfter: "2026-10-05",
    ...options,
    asset: { status: "pending", approved_by: null, ...options.asset },
    handlers: {
      auto_approve_asset: () => {
        const row = made.tables["assets"]?.[0];
        if (row !== undefined) row["status"] = "approved";
        return EVENT;
      },
    },
  });
  return made;
}

const rpcCalls = (db: ReturnType<typeof pending>["db"]) =>
  db.calls.filter((call) => call.kind === "rpc");

afterEach(() => {
  vi.mocked(maybeAutoApprove).mockClear();
  fanout.mockClear();
});

describe("maybeAutoApprove", () => {
  it("approves a Feature asset after auto_after on every auto target once, and a second call does nothing", async () => {
    const { db } = pending();
    expect(await maybeAutoApprove(db, ASSET, NOW)).toEqual({ status: "approved", eventId: EVENT });
    expect(await maybeAutoApprove(db, ASSET, NOW)).toEqual({
      status: "not_eligible",
      reason: "not_pending",
    });
    expect(rpcCalls(db).map((call) => call.name)).toEqual(["auto_approve_asset"]);
  });

  it("makes one auto_approve_asset call with its evidence, fans out the event it returns and emits nothing", async () => {
    const { db } = pending();
    await maybeAutoApprove(db, ASSET, NOW);
    expect(rpcCalls(db)).toEqual([
      {
        kind: "rpc",
        name: "auto_approve_asset",
        args: [
          {
            p_asset_id: ASSET,
            p_evidence: { tier: "Feature", channels: ["instagram"], auto_after: "2026-10-05" },
          },
        ],
      },
    ]);
    expect(fanout.mock.calls.map(([, eventId]) => eventId)).toEqual([EVENT]);
  });

  it.each([
    ["a Campaign asset", { tier: "Campaign" }, "tier_manual"],
    ["a Feature asset before auto_after", { autoAfter: "2026-10-07" }, "tier_manual"],
    [
      "an asset whose caption_lint failed",
      { asset: { meta: { caption_lint: "failed" } } },
      "lint_failed",
    ],
    ["an asset without alt text", { asset: { alt_text: null } }, "incomplete"],
    ["an asset whose only target is off", { enabled: { instagram: false } }, "no_target"],
  ] as const)("never approves %s", async (_label, options: WorldOptions, reason) => {
    const { db } = pending(options);
    expect(await maybeAutoApprove(db, ASSET, NOW)).toEqual({ status: "not_eligible", reason });
    expect(rpcCalls(db)).toEqual([]);
    expect(fanout).not.toHaveBeenCalled();
  });
});

describe("what starts an automatic approval (invariant 4a)", () => {
  it.each(["render_cover", "render_carousel", "render_story"])(
    "%s onResult asks maybeAutoApprove once about the asset it updated",
    async (type) => {
      const db = fakeDb({
        rpc: { set_asset_files: () => undefined },
        tables: { assets: [assetRow({ status: "approved" })] },
      });
      const ctx = context(db, type);
      const job = {
        ...ctx.job,
        result: { spec_hash: "h".repeat(64), revision: 1, asset_id: ASSET_ID },
      };
      const files = [
        {
          media_key: "assets/p/cover/r1/cover.aaaaaaaa.jpg",
          w: 1200,
          h: 630,
          bytes: 1,
          role: "main",
        },
      ];
      await getStep(type)?.onResult?.(ctx, job, { files });
      expect(vi.mocked(maybeAutoApprove).mock.calls).toEqual([[db, ASSET_ID, RENDER_NOW]]);
    },
  );
});
