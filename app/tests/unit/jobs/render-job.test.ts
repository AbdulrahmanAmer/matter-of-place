import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkJob, runJob, scriptFor, settleRun } from "../../../scripts/render-job.mjs";

const RENDER_YML = readFileSync(
  resolve(import.meta.dirname, "../../../../.github/workflows/render.yml"),
  "utf8",
);
const DEV_CALLBACK =
  "https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback";

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "3f2a9c1d-0000-4000-8000-000000000001",
    claim: "7d1e0c52-0000-4000-8000-000000000002",
    type: "test.selftest_heavy",
    payload: { params: {}, data: {} },
    env: "preview",
    callback_url: DEV_CALLBACK,
    ...overrides,
  };
}

function refusal(value: unknown): string | null {
  try {
    checkJob(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const occurrences = (needle: string) => RENDER_YML.split(needle).length - 1;

describe("scriptFor", () => {
  it.each([
    ["render_variants", "scripts/render-variants.mjs"],
    ["render_cover", "scripts/render-cover.mjs"],
    ["render_carousel", "scripts/render-carousel.mjs"],
    ["render_story", "scripts/render-story.mjs"],
    ["render_og_static", "scripts/render-og-static.mjs"],
  ])("maps %s to its B9 script", (type, script) => {
    expect(scriptFor(type)).toBe(script);
  });

  it("runs the heavy self-test inline and knows no other type", () => {
    expect([scriptFor("test.selftest_heavy"), scriptFor("social_post")]).toEqual(["inline", null]);
  });
});

describe("runJob", () => {
  it.each([
    ["a type outside the catalog", "social_post"],
    ["a render type with no script", "render_nothing_here"],
  ])("settles %s as not_implemented, not retryable", async (_name, type) => {
    expect(await settleRun(runJob, JSON.stringify(job({ type })))).toEqual({
      status: "failed",
      error: "not_implemented",
      retryable: false,
    });
  });

  it("runs the self-test inline, and its nonretryable failure is final", async () => {
    const done = await settleRun(runJob, JSON.stringify(job()));
    const failed = await settleRun(
      runJob,
      JSON.stringify(job({ payload: { params: { fail: "nonretryable" }, data: {} } })),
    );
    expect([done.status, failed]).toEqual([
      "done",
      { status: "failed", error: "selftest_nonretryable", retryable: false },
    ]);
  });

  it("settles unreadable job JSON as job_unreadable, not retryable", async () => {
    expect(await settleRun(runJob, "{")).toEqual({
      status: "failed",
      error: "job_unreadable",
      retryable: false,
    });
  });
});

describe("checkJob", () => {
  it("accepts preview and production with the dev Worker or the site as callback", () => {
    expect([
      refusal(job()),
      refusal(job({ env: "production" })),
      refusal(job({ callback_url: "https://matterofplace.com/api/hooks/render/callback" })),
    ]).toEqual([null, null, null]);
  });

  it("refuses an env other than preview or production (H35 (8))", () => {
    expect([refusal(job({ env: "development" })), refusal(job({ env: undefined }))]).toEqual([
      "env_refused",
      "env_refused",
    ]);
  });

  it.each([
    ["another host", "https://example.com/api/hooks/render/callback"],
    [
      "a look-alike host",
      "https://holy-meadow-4327.workers.dev.example.com/api/hooks/render/callback",
    ],
    [
      "plain http",
      "http://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback",
    ],
    ["no URL", "callback"],
  ])("refuses a callback_url on %s", (_name, url) => {
    expect(refusal(job({ callback_url: url }))).toBe("callback_refused");
  });
});

describe("settleRun", () => {
  it("gives done with the value run resolves", async () => {
    expect(await settleRun(() => Promise.resolve({ files: [] }), job())).toEqual({
      status: "done",
      result: { files: [] },
    });
  });

  it("keeps a storage_unavailable throw retryable", async () => {
    const outcome = await settleRun(() => Promise.reject(new Error("storage_unavailable")), job());
    expect(outcome).toEqual({ status: "failed", error: "storage_unavailable", retryable: true });
  });

  it("makes an error that carries retryable false final", async () => {
    const final = Object.assign(new Error("bad_spec"), { retryable: false });
    const outcome = await settleRun(() => Promise.reject(final), job());
    expect(outcome).toEqual({ status: "failed", error: "bad_spec", retryable: false });
  });
});

describe("render.yml", () => {
  it("runs the render job for every type but render_reel, once", () => {
    expect(occurrences("if: fromJSON(inputs.job).type != 'render_reel'")).toBe(1);
  });

  it("gives the scripts MOP_ENV and the one project's Storage keys (H33 (5))", () => {
    expect(
      [
        "MOP_ENV: ${{ fromJSON(inputs.job).env }}",
        "SUPABASE_URL: https://${{ secrets.DEV_SUPABASE_PROJECT_REF }}.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}",
      ].map(occurrences),
    ).toEqual([1, 1, 1]);
  });

  it("names no R2 key, no variable and no repository_dispatch (H33 (1), JOB-01)", () => {
    expect(["R2_", "vars.", "repository_dispatch"].map(occurrences)).toEqual([0, 0, 0]);
  });
});
