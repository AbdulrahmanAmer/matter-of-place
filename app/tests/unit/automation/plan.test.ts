import { describe, expect, it } from "vitest";
import type { Step } from "../../../src/domain/automation";
import type { StepRegistry } from "../../../src/server/automation/catalog";
import type { JsonObject } from "../../../src/server/jobs/types";
import {
  matchesConditions,
  planEvent,
  type PlannedJob,
  type PlanRecipe,
  type SkipReason,
} from "../../../src/server/automation/plan";
import { eventPayloadExamples } from "./fixtures/event-payloads";

const EVENT_ID = "9d2f4a52-0000-4000-8000-000000000001";
const RECIPE_ID = "9d2f4a52-0000-4000-8000-000000000002";

const everything: StepRegistry = () => ({});
const without =
  (...types: string[]): StepRegistry =>
  (type) =>
    types.includes(type) ? undefined : {};

function step(id: string, step_type: string, overrides: Partial<Step> = {}): Step {
  return {
    id,
    step_type,
    params: {},
    enabled: true,
    requires_approval: false,
    conditions: {},
    ...overrides,
  };
}

function recipe(trigger: string, steps: Step[], enabled = true): PlanRecipe {
  return { id: RECIPE_ID, trigger, enabled, steps };
}

const campaign = { tiers: ["Campaign" as const] };

const propertyPublished = recipe("property.published", [
  step("bump_catalog_version", "bump_catalog_version"),
  step("purge_cache", "purge_cache"),
  step("render_variants", "render_variants"),
  step("render_cover", "render_cover"),
  step("render_carousel", "render_carousel"),
  step("render_story", "render_story"),
  step("write_captions", "write_captions"),
  step("build_newsletter_block", "build_newsletter_block"),
  step("render_reel", "render_reel", { conditions: campaign }),
  step("send_standalone", "send_email", {
    params: { template: "standalone" },
    requires_approval: true,
    conditions: campaign,
  }),
]);

const postKinds = {
  kinds: ["cover" as const, "carousel" as const, "story" as const, "reel" as const],
};
const assetApproved = recipe("asset.approved", [
  step("post_meta", "post_meta", { params: { channels: "from_settings" }, conditions: postKinds }),
  step("post_x", "post_x", { conditions: postKinds }),
  step("post_linkedin", "post_linkedin", { conditions: postKinds }),
  step("queue_digest", "queue_digest", {
    params: { mode: "add" },
    conditions: { kinds: ["newsletter_block"] },
  }),
]);

// The one step of the seeded subscriber.created row (B8b seed, G12).
const subscriberCreated = recipe("subscriber.created", [
  step("send_confirm", "send_email", { params: { template: "interest_confirm" } }),
]);

const published = (tier: string) => ({ ...eventPayloadExamples["property.published"], tier });
const approved = (kind: string) => ({ ...eventPayloadExamples["asset.approved"], kind });
const plannedIds = (recipeToPlan: PlanRecipe, payload: JsonObject, registry = everything) =>
  planEvent(recipeToPlan, { id: EVENT_ID, payload }, { registry }).planned.map(
    (job) => job.step_id,
  );

describe("planEvent", () => {
  it("keeps the recipe order and keys every job event_id:step_id", () => {
    const plan = planEvent(
      propertyPublished,
      { id: EVENT_ID, payload: published("Campaign") },
      { registry: everything },
    );
    expect(plan.planned.map((job) => job.step_id)).toEqual(
      propertyPublished.steps.map((s) => s.id),
    );
    expect(plan.planned.map((job) => job.idempotency_key)).toEqual(
      propertyPublished.steps.map((s) => `${EVENT_ID}:${s.id}`),
    );
    expect(plan.skipped).toEqual([]);
  });

  it("plans the reel and the standalone email for Campaign only", () => {
    const feature = planEvent(
      propertyPublished,
      { id: EVENT_ID, payload: published("Feature") },
      { registry: everything },
    );
    expect(feature.planned.map((job) => job.step_id)).not.toContain("render_reel");
    expect(feature.skipped).toEqual([
      { step_id: "render_reel", type: "render_reel", reason: "condition" },
      { step_id: "send_standalone", type: "send_email", reason: "condition" },
    ]);
    expect(plannedIds(propertyPublished, published("Campaign"))).toContain("render_reel");
  });

  it("matches a market condition on market and on markets", () => {
    const florida = { markets: ["florida" as const] };
    expect(matchesConditions(florida, { market: "florida" })).toBe(true);
    expect(matchesConditions(florida, { market: "california" })).toBe(false);
    expect(matchesConditions(florida, { markets: ["california", "florida"] })).toBe(true);
    expect(matchesConditions(florida, {})).toBe(false);
    expect(matchesConditions({}, {})).toBe(true);
  });

  it("matches a tier condition against payload.tier and not an absent one", () => {
    expect(matchesConditions(campaign, { tier: "Campaign" })).toBe(true);
    expect(matchesConditions(campaign, { tier: "Feature" })).toBe(false);
    expect(matchesConditions(campaign, {})).toBe(false);
  });

  it("plans only queue_digest for a newsletter_block approval", () => {
    expect(plannedIds(assetApproved, approved("newsletter_block"))).toEqual(["queue_digest"]);
  });

  it("plans only the three post steps for a cover approval", () => {
    expect(plannedIds(assetApproved, approved("cover"))).toEqual([
      "post_meta",
      "post_x",
      "post_linkedin",
    ]);
    expect(plannedIds(assetApproved, {})).toEqual([]);
  });

  it("plans exactly one confirm job for a new subscriber", () => {
    const payload = {
      subscriber_id: "6f0a7a5e-1c1f-4b0e-9d0b-3c3b1a1f0a05",
      sealed_token: "sealed.token",
    };
    const plan = planEvent(subscriberCreated, { id: EVENT_ID, payload }, { registry: everything });
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]).toMatchObject({
      step_id: "send_confirm",
      type: "send_email",
      idempotency_key: `${EVENT_ID}:send_confirm`,
      payload: { params: { template: "interest_confirm" }, data: payload },
    });
  });

  it("waits for approval when the step requires it, else queues", () => {
    const plan = planEvent(
      propertyPublished,
      { id: EVENT_ID, payload: published("Campaign") },
      { registry: everything },
    );
    const status = Object.fromEntries(plan.planned.map((job) => [job.step_id, job.status]));
    expect(status["send_standalone"]).toBe("waiting_approval");
    expect(status["render_cover"]).toBe("queued");
  });

  it("skips a disabled step and every step of a disabled recipe", () => {
    const off = recipe("property.unpublished", [
      step("a", "purge_cache", { enabled: false }),
      step("b", "purge_cache"),
    ]);
    const plan = planEvent(off, { id: EVENT_ID, payload: {} }, { registry: everything });
    expect(plan.skipped).toEqual([{ step_id: "a", type: "purge_cache", reason: "step_disabled" }]);
    expect(plan.planned.map((job) => job.step_id)).toEqual(["b"]);
    const disabled = planEvent(
      { ...off, enabled: false },
      { id: EVENT_ID, payload: {} },
      { registry: everything },
    );
    expect(disabled.planned).toEqual([]);
    expect(disabled.skipped.map((s) => s.reason)).toEqual(["recipe_disabled", "recipe_disabled"]);
    expect(disabled.recipe_enabled).toBe(false);
  });

  it("skips a step the registry does not implement", () => {
    const plan = planEvent(
      propertyPublished,
      { id: EVENT_ID, payload: published("Feature") },
      { registry: without("render_cover") },
    );
    expect(plan.skipped).toContainEqual({
      step_id: "render_cover",
      type: "render_cover",
      reason: "not_implemented",
    });
    expect(plan.planned.map((job) => job.step_id)).not.toContain("render_cover");
    const unknown = recipe("digest.due", [step("fly", "fly_to_moon")]);
    expect(
      planEvent(unknown, { id: EVENT_ID, payload: {} }, { registry: everything }).skipped,
    ).toEqual([{ step_id: "fly", type: "fly_to_moon", reason: "not_implemented" }]);
  });

  it("skips a step whose params do not parse", () => {
    const bad = recipe("submission.received", [
      step("no_template", "send_email"),
      step("too_many", "render_carousel", { params: { max_slides: 9 } }),
      step("typo", "post_x", { params: { respect_windows: true } }),
    ]);
    const plan = planEvent(bad, { id: EVENT_ID, payload: {} }, { registry: everything });
    expect(plan.planned).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "invalid_params",
      "invalid_params",
      "invalid_params",
    ]);
  });

  it("reports the first skip reason in the fixed order", () => {
    const stub = without("send_email");
    const badAll = (overrides: Partial<Step>) =>
      step("s", "send_email", { params: {}, conditions: { tiers: ["Campaign"] }, ...overrides });
    const reason = (
      steps: Step[],
      payload = { tier: "Feature" },
      enabled = true,
    ): SkipReason | undefined =>
      planEvent(
        recipe("invoice.issued", steps, enabled),
        { id: EVENT_ID, payload },
        { registry: stub },
      ).skipped[0]?.reason;
    expect(reason([badAll({ enabled: false })])).toBe("step_disabled");
    expect(reason([badAll({ enabled: false })], { tier: "Feature" }, false)).toBe(
      "recipe_disabled",
    );
    expect(reason([badAll({})])).toBe("condition");
    expect(reason([badAll({})], { tier: "Campaign" })).toBe("not_implemented");
    const notImplementedAndInvalid = step("s", "send_email", { params: {} });
    expect(reason([notImplementedAndInvalid])).toBe("not_implemented");
    expect(
      planEvent(
        recipe("invoice.issued", [notImplementedAndInvalid]),
        { id: EVENT_ID, payload: {} },
        { registry: everything },
      ).skipped[0]?.reason,
    ).toBe("invalid_params");
  });

  it("snapshots parsed params and the event payload into the envelope", () => {
    const payload = published("Feature");
    const plan = planEvent(propertyPublished, { id: EVENT_ID, payload }, { registry: everything });
    const bump: PlannedJob | undefined = plan.planned.find(
      (job) => job.step_id === "bump_catalog_version",
    );
    expect(bump).toEqual({
      recipe_id: RECIPE_ID,
      step_id: "bump_catalog_version",
      type: "bump_catalog_version",
      heavy: false,
      run_local: false,
      status: "queued",
      payload: { params: { flip_coming_soon: true }, data: payload },
      idempotency_key: `${EVENT_ID}:bump_catalog_version`,
      max_attempts: 5,
    });
    expect(plan.trigger).toBe("property.published");
    expect(plan.recipe_enabled).toBe(true);
  });

  it("takes max_attempts from the spec, 12 for a provider step", () => {
    const plan = planEvent(
      recipe("submission.received", [
        step("send_received", "send_email", { params: { template: "received" } }),
      ]),
      { id: EVENT_ID, payload: {} },
      { registry: everything },
    );
    expect(plan.planned[0]?.max_attempts).toBe(12);
  });

  it("plans write_captions for the laptop runner and render_cover for the job runner", () => {
    const plan = planEvent(
      propertyPublished,
      { id: EVENT_ID, payload: published("Feature") },
      { registry: everything },
    );
    const flags = Object.fromEntries(
      plan.planned.map((job) => [job.step_id, [job.heavy, job.run_local]]),
    );
    expect(flags["write_captions"]).toEqual([false, true]);
    expect(flags["render_cover"]).toEqual([true, false]);
  });
});
