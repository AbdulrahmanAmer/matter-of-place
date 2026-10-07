import { describe, expect, it } from "vitest";
import { stepSpecs } from "../../../src/server/automation/step-specs";
import { queueDigest } from "../../../src/server/jobs/steps/queue-digest";
import { stepCtx } from "../../fixtures/email-send";
import {
  assetRow,
  newsletterDb,
  propertyRow,
  uuid,
  type Handler,
  type Row,
} from "../../fixtures/newsletter-world";

// Step `queue_digest` (B11 Contract): `add` queues one approved newsletter block, `assemble` builds the draft. The
// one-block-per-asset rule is the SQL function's (step 4's `queue_digest_add`), proved by tests/db/newsletter.db.test.ts.

const PROPERTY = uuid(1);
const ASSET = uuid(11);

function setup(rpc: Record<string, Handler> = {}, tables: Record<string, Row[]> = {}) {
  const world = newsletterDb(tables, { queue_digest_add: () => null, ...rpc });
  const ctx = stepCtx(world.db, { type: "queue_digest" });
  return {
    ...world,
    run: (params: unknown, data: Record<string, string>) => queueDigest.run(ctx, params, data),
  };
}

describe("queue_digest", () => {
  it("adds the block of an approved newsletter asset through queue_digest_add", async () => {
    const { run, rpcCalls } = setup();
    const data = { kind: "newsletter_block", property_id: PROPERTY, asset_id: ASSET };
    expect(await run({ mode: "add" }, data)).toEqual({ status: "done" });
    expect(rpcCalls("queue_digest_add").map((call) => call.args[0])).toEqual([
      { p_property: PROPERTY, p_asset: ASSET },
    ]);
  });

  it("sends the same asset the same way twice, so the function can keep one block", async () => {
    const { run, rpcCalls } = setup();
    const data = { kind: "newsletter_block", property_id: PROPERTY, asset_id: ASSET };
    await run({}, data);
    await run({}, data);
    const [first, second] = rpcCalls("queue_digest_add").map((call) => call.args[0]);
    expect(rpcCalls("queue_digest_add")).toHaveLength(2);
    expect(second).toEqual(first);
  });

  it("skips a cover and adds nothing", async () => {
    const { run, calls } = setup();
    const data = { kind: "cover", property_id: PROPERTY, asset_id: ASSET };
    expect(await run({ mode: "add" }, data)).toEqual({
      status: "done",
      result: { skipped: "not_newsletter_block" },
    });
    expect(calls).toEqual([]);
  });

  it("throws when queue_digest_add fails, so the runner backs off", async () => {
    const { run } = setup({ queue_digest_add: () => new Error("down") });
    await expect(
      run({}, { kind: "newsletter_block", property_id: PROPERTY, asset_id: ASSET }),
    ).rejects.toThrow("queue_digest_add_failed");
  });

  it("answers a null issue in assemble mode when nothing is eligible", async () => {
    const { run, rpcCalls } = setup();
    expect(await run({ mode: "assemble" }, {})).toEqual({
      status: "done",
      result: { issue_id: null },
    });
    expect(rpcCalls("newsletter_save_draft")).toEqual([]);
  });

  it("answers the saved issue in assemble mode", async () => {
    const { run } = setup(
      { newsletter_save_draft: () => ({ id: uuid(900), number: 2 }) },
      { assets: [assetRow(1, 1)], properties: [propertyRow(1)] },
    );
    expect(await run({ mode: "assemble" }, {})).toEqual({
      status: "done",
      result: { issue_id: uuid(900), number: 2 },
    });
  });
});

describe("queue_digest params", () => {
  const schema = stepSpecs.queue_digest.paramsSchema;

  it("accepts add and assemble, and add by default", () => {
    expect(schema.parse({ mode: "add" })).toEqual({ mode: "add" });
    expect(schema.parse({ mode: "assemble" })).toEqual({ mode: "assemble" });
    expect(schema.parse({})).toEqual({ mode: "add" });
  });

  it("refuses any other mode and any other key", () => {
    expect(schema.safeParse({ mode: "send" }).success).toBe(false);
    expect(schema.safeParse({ mode: "add", extra: 1 }).success).toBe(false);
  });
});
