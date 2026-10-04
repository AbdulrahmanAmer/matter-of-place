import { describe, expect, it } from "vitest";
import {
  conditionsSchema,
  recipeSchema,
  stepSchema,
  channels,
  type Channel,
} from "../../../src/domain/automation";
import { eventPayloadSchemas, eventTypes } from "../../../src/domain/events";
import {
  getSpec,
  isImplemented,
  listStepSpecs,
  stepForChannel,
} from "../../../src/server/automation/catalog";
import { ogStaticPages, stepSpecs } from "../../../src/server/automation/step-specs";
import { catalogEventTypes } from "../../../src/server/lib/events";
import { eventPayloadExamples } from "./fixtures/event-payloads";

const ARCHITECTURE_5_TYPES = [
  "send_email",
  "notify_admin",
  "bump_catalog_version",
  "purge_cache",
  "render_variants",
  "render_cover",
  "render_carousel",
  "render_story",
  "render_reel",
  "write_captions",
  "build_newsletter_block",
  "post_meta",
  "post_x",
  "post_linkedin",
  "render_og_static",
  "queue_digest",
  "webhook_omnikom",
];

const step = (overrides: Record<string, unknown>) => ({
  id: "send_received",
  step_type: "send_email",
  ...overrides,
});

describe("step catalog", () => {
  it("lists the 17 step types of architecture 5 and no other", () => {
    expect(listStepSpecs().map((spec) => spec.type)).toEqual(ARCHITECTURE_5_TYPES);
    expect(getSpec("send_email")?.label).toBe("Send email");
    expect(getSpec("workflow_engine")).toBeUndefined();
  });

  it("gives every schema key a fields entry and every field a key", () => {
    for (const spec of listStepSpecs()) {
      const schemaKeys = Object.keys(spec.paramsSchema.shape).sort();
      const fieldKeys = spec.fields.map((field) => field.key).sort();
      expect({ type: spec.type, keys: fieldKeys }).toEqual({ type: spec.type, keys: schemaKeys });
    }
  });

  it("parses every spec's defaults", () => {
    const required: Record<string, Record<string, string>> = {
      send_email: { template: "received" },
    };
    for (const spec of listStepSpecs()) {
      const defaults = Object.fromEntries(
        spec.fields.flatMap((field) =>
          field.default === undefined ? [] : [[field.key, field.default]],
        ),
      );
      const parsed = spec.paramsSchema.safeParse({ ...required[spec.type], ...defaults });
      expect({ type: spec.type, ok: parsed.success }).toEqual({ type: spec.type, ok: true });
    }
    expect(stepSpecs.render_carousel.paramsSchema.parse({})).toEqual({ max_slides: 8 });
    expect(stepSpecs.render_og_static.paramsSchema.parse({})).toEqual({
      pages: [...ogStaticPages],
    });
  });

  it("limits queue_digest mode to add and assemble", () => {
    const { paramsSchema } = stepSpecs.queue_digest;
    expect(paramsSchema.safeParse({ mode: "add" }).success).toBe(true);
    expect(paramsSchema.safeParse({ mode: "assemble" }).success).toBe(true);
    expect(paramsSchema.safeParse({ mode: "send" }).success).toBe(false);
    expect(paramsSchema.parse({})).toEqual({ mode: "add" });
  });

  it("limits render_og_static pages to the seven static keys", () => {
    const { paramsSchema } = stepSpecs.render_og_static;
    expect(paramsSchema.safeParse({ pages: ["home", "market-florida"] }).success).toBe(true);
    expect(paramsSchema.safeParse({ pages: ["home", "property"] }).success).toBe(false);
    expect(ogStaticPages).toHaveLength(7);
  });

  it("accepts requester as the recipient of send_email", () => {
    const { paramsSchema } = stepSpecs.send_email;
    expect(paramsSchema.safeParse({ template: "subject_ack", to: "requester" }).success).toBe(true);
    expect(paramsSchema.safeParse({ template: "subject_ack", to: "everyone" }).success).toBe(false);
    expect(paramsSchema.safeParse({ to: "requester" }).success).toBe(false);
  });

  it("refuses a params key the spec does not name", () => {
    expect(
      stepSpecs.post_x.paramsSchema.safeParse({ respect_window: true, channel: "x" }).success,
    ).toBe(false);
    expect(stepSpecs.render_carousel.paramsSchema.safeParse({ max_slides: 9 }).success).toBe(false);
  });

  it("keeps the 18 event types in step with the database check list", () => {
    expect(eventTypes).toHaveLength(18);
    expect([...eventTypes].sort()).toEqual([...catalogEventTypes].sort());
    expect(Object.keys(eventPayloadSchemas).sort()).toEqual([...eventTypes].sort());
  });

  it("parses the example payload of every event type", () => {
    for (const type of eventTypes) {
      const parsed = eventPayloadSchemas[type].safeParse(eventPayloadExamples[type]);
      expect({ type, ok: parsed.success }).toEqual({ type, ok: true });
    }
  });

  it("refuses an awaiting_assets payload without a note", () => {
    const { note: _note, ...withoutNote } = eventPayloadExamples["submission.awaiting_assets"];
    expect(eventPayloadSchemas["submission.awaiting_assets"].safeParse(withoutNote).success).toBe(
      false,
    );
    expect(
      eventPayloadSchemas["submission.awaiting_assets"].safeParse({ ...withoutNote, note: "" })
        .success,
    ).toBe(false);
  });

  it("keeps fields a producer adds to a payload", () => {
    const parsed = eventPayloadSchemas["inquiry.received"].parse({
      ...eventPayloadExamples["inquiry.received"],
      source: "form",
    });
    expect(parsed).toHaveProperty("source", "form");
  });

  it("says no module for a step the registry does not return", () => {
    expect(isImplemented("send_email", () => undefined)).toBe(false);
    expect(isImplemented("send_email", (type) => (type === "send_email" ? {} : undefined))).toBe(
      true,
    );
    expect(isImplemented("bump_catalog_version", () => undefined)).toBe(false);
    expect(isImplemented("bump_catalog_version", () => ({}))).toBe(true);
  });

  it("maps each channel to its post step and YouTube to none", () => {
    const mapped: Record<Channel, string | null> = {
      instagram: "post_meta",
      facebook: "post_meta",
      x: "post_x",
      linkedin: "post_linkedin",
      newsletter: "queue_digest",
      youtube: null,
    };
    for (const channel of channels) {
      expect({ channel, type: stepForChannel(channel) }).toEqual({
        channel,
        type: mapped[channel],
      });
    }
  });
});

describe("recipe shapes", () => {
  it("fills a step's defaults and keeps a condition", () => {
    const parsed = stepSchema.parse(step({ conditions: { tiers: ["Campaign"] } }));
    expect(parsed).toEqual({
      id: "send_received",
      step_type: "send_email",
      params: {},
      enabled: true,
      requires_approval: false,
      conditions: { tiers: ["Campaign"] },
    });
  });

  it("refuses a condition outside tiers, markets and kinds", () => {
    expect(conditionsSchema.safeParse({ tiers: ["Editorial"] }).success).toBe(false);
    expect(conditionsSchema.safeParse({ markets: ["texas"] }).success).toBe(false);
    expect(conditionsSchema.safeParse({ kinds: ["poster"] }).success).toBe(false);
    expect(conditionsSchema.safeParse({ kinds: ["variants", "reel"] }).success).toBe(true);
    expect(conditionsSchema.safeParse({ cities: ["Miami"] }).success).toBe(false);
  });

  it("refuses a repeated step id with the path of the second", () => {
    const result = recipeSchema.safeParse({
      name: "Property published",
      enabled: true,
      steps: [step({}), step({})],
    });
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path)).toEqual([
      ["steps", 1, "id"],
    ]);
  });

  it("refuses a 21st step and an id that is not a slug", () => {
    const many = Array.from({ length: 21 }, (_, index) => step({ id: `step_${String(index)}` }));
    expect(recipeSchema.safeParse({ name: "R", enabled: true, steps: many }).success).toBe(false);
    expect(stepSchema.safeParse(step({ id: "Send Email" })).success).toBe(false);
    expect(stepSchema.safeParse(step({ id: "a".repeat(41) })).success).toBe(false);
  });
});
