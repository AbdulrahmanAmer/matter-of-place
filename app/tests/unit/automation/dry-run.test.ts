import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json, Tables } from "../../../src/db";
import { dryRun } from "../../../src/server/automation/dry-run";
import type { StepDefinition } from "../../../src/server/jobs/types";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";
import { submissionRow, SUBMISSION_ID } from "./fixtures/entity-rows";

// The step types B8's registry answers for, so the planner sees them implemented.
const implemented = vi.hoisted(
  () => new Set(["send_email", "notify_admin", "bump_catalog_version"]),
);

vi.mock(import("../../../src/server/jobs/steps/index.ts"), () => ({
  getStep: (type: string): StepDefinition | undefined =>
    implemented.has(type)
      ? {
          type,
          heavy: false,
          paramsSchema: z.unknown(),
          run: () => Promise.resolve({ status: "done" }),
        }
      : undefined,
}));

const STAMP = "2026-10-04T12:00:00.000Z";
const RECIPE_ID = "7a1b2c3d-0000-4000-8000-000000000001";
const received = { submission_id: SUBMISSION_ID };

type JsonStep = {
  id: string;
  step_type: string;
  params: { [key: string]: Json };
  enabled: boolean;
  requires_approval: boolean;
  conditions: { tiers?: string[] };
};

function step(id: string, step_type: string, overrides: Partial<JsonStep> = {}): JsonStep {
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

const sendReceived = step("send_received", "send_email", { params: { template: "received" } });

function recipe(steps: JsonStep[], enabled = true): Tables<"automation_recipes"> {
  return {
    id: RECIPE_ID,
    trigger: "submission.received",
    name: "Received",
    enabled,
    version: 1,
    steps,
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function template(key: string, enabled = true): Tables<"email_templates"> {
  return {
    id: `7a1b2c3d-0000-4000-8000-0000000000${key.length.toString().padStart(2, "0")}`,
    key,
    subject: "Subject",
    preheader: "",
    body: [],
    class: "transactional",
    variables: [],
    enabled,
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function dbFor(
  steps: JsonStep[],
  { enabled = true, templates = [template("received")] } = {},
): FakeDb {
  return fakeDb({
    tables: {
      automation_recipes: [recipe(steps, enabled)],
      email_templates: templates,
      submissions: [submissionRow()],
    },
  });
}

const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe("dryRun (invariant 3)", () => {
  it("lists the planned job with its params and the skipped step with its reason", async () => {
    const off = step("notify_admin_received", "notify_admin", { enabled: false });
    const result = await dryRun(dbFor([sendReceived, off]), {
      trigger: "submission.received",
      payload: received,
    });
    expect(result).toEqual({
      trigger: "submission.received",
      recipe_enabled: true,
      planned: [
        {
          step_id: "send_received",
          type: "send_email",
          heavy: false,
          run_local: false,
          status: "queued",
          params: { template: "received" },
          idempotency_key: "dry-run:send_received",
          max_attempts: 12,
        },
      ],
      skipped: [
        { step_id: "notify_admin_received", type: "notify_admin", reason: "step_disabled" },
      ],
      warnings: [],
    });
  });

  it("writes nothing: it reads tables and calls no RPC", async () => {
    const db = dbFor([sendReceived]);
    await dryRun(db, { trigger: "submission.received", payload: received });
    expect(db.calls.filter((call) => call.kind !== "from")).toEqual([]);
    expect(db.calls.map((call) => call.name)).toEqual(["automation_recipes", "email_templates"]);
  });

  it("builds the payload from the row named by entity_id", async () => {
    const db = dbFor([sendReceived]);
    const result = await dryRun(db, { trigger: "submission.received", entity_id: SUBMISSION_ID });
    expect(result.planned.map((job) => job.step_id)).toEqual(["send_received"]);
    expect(db.calls.map((call) => call.name)).toContain("submissions");
  });

  it("warns once when the recipe is off, and every step is skipped", async () => {
    const result = await dryRun(dbFor([sendReceived], { enabled: false }), {
      trigger: "submission.received",
      payload: received,
    });
    expect(codes(result.warnings)).toEqual(["recipe_disabled"]);
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["recipe_disabled"]);
  });

  it("warns once for a step that has no module yet", async () => {
    const result = await dryRun(dbFor([sendReceived, step("render_variants", "render_variants")]), {
      trigger: "submission.received",
      payload: received,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "step_not_implemented", step_id: "render_variants" }),
    ]);
  });

  it("warns once when a planned step names a template that does not exist", async () => {
    const result = await dryRun(dbFor([sendReceived], { templates: [] }), {
      trigger: "submission.received",
      payload: received,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "template_missing", step_id: "send_received" }),
    ]);
  });

  it("warns once when a planned step names a template that is off", async () => {
    const result = await dryRun(
      dbFor([sendReceived], { templates: [template("received", false)] }),
      {
        trigger: "submission.received",
        payload: received,
      },
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "template_disabled", step_id: "send_received" }),
    ]);
  });

  it("does not look for the template of a step that is switched off", async () => {
    const off = step("send_received", "send_email", {
      params: { template: "received" },
      enabled: false,
    });
    const db = dbFor([off], { templates: [] });
    const result = await dryRun(db, { trigger: "submission.received", payload: received });
    expect(result.warnings).toEqual([]);
    expect(db.calls.map((call) => call.name)).not.toContain("email_templates");
  });

  it("warns once when the payload does not match the event's schema", async () => {
    const result = await dryRun(dbFor([sendReceived]), {
      trigger: "submission.received",
      payload: { submission_id: "not-a-uuid" },
    });
    expect(codes(result.warnings)).toEqual(["payload_invalid"]);
  });
});
