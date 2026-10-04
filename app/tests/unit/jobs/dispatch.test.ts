import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatchRefusals, dispatchRender } from "../../../src/server/jobs/dispatch";
import { dispatchHeavy } from "../../../src/server/jobs/steps/heavy";
import type { RunnerEnv, StepContext } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const CALLBACK =
  "https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback";
const ENV: RunnerEnv = {
  MOP_ENV: "preview",
  GITHUB_DISPATCH_TOKEN: "test-dispatch-token",
  GITHUB_REPO: "AbdulrahmanAmer/matter-of-place",
  RENDER_CALLBACK_URL: CALLBACK,
};

const fetchSpy = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function context(env: RunnerEnv = ENV): StepContext {
  return {
    db: fakeDb(),
    env,
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "render_variants",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

const bodySchema = z.object({ ref: z.string(), inputs: z.object({ job: z.string() }) });

function sentBody(): z.infer<typeof bodySchema> {
  const raw = fetchSpy.mock.calls[0]?.[1].body;
  return bodySchema.parse(JSON.parse(typeof raw === "string" ? raw : "null"));
}

// B9's largest dispatch: 40 photographs, each with a two-hour signed address of the staged original.
const fortyMedia = Array.from({ length: 40 }, (_, n) => ({
  media_id: `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`,
  staging_path: `staging/3f2a9c1d-0000-4000-8000-000000000001/${String(n).padStart(2, "0")}-original.jpg`,
  staged_url: `https://hbokkmpgpqhrnemgsqra.supabase.co/storage/v1/object/sign/submissions/staging/3f2a9c1d-0000-4000-8000-000000000001/${String(n).padStart(2, "0")}-original.jpg?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${"x".repeat(220)}.${"y".repeat(43)}`,
  mime: "image/jpeg",
  owner: "a-house-on-the-bluff-malibu",
  n,
}));

beforeEach(() => {
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchSpy.mockReset();
});

describe("dispatchRender", () => {
  it("posts one workflow_dispatch of render.yml with the payload as its job input", async () => {
    const payload = { job_id: "j", claim: "c", type: "render_variants" };
    expect(await dispatchRender(context(), payload)).toEqual({ status: "dispatched" });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.github.com/repos/AbdulrahmanAmer/matter-of-place/actions/workflows/render.yml/dispatches",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-dispatch-token");
    expect(new Headers(init?.headers).get("x-github-api-version")).toBe("2022-11-28");
    const body = sentBody();
    expect(body.ref).toBe("main");
    expect(JSON.parse(body.inputs.job)).toEqual(payload);
  });

  it("passes the step's signal to fetch", async () => {
    const ctx = context();
    await dispatchRender(ctx, {});
    expect(fetchSpy.mock.calls[0]?.[1].signal).toBe(ctx.signal);
  });

  it("waits an hour with dispatch_not_configured and no call when the token or repo is unset", async () => {
    for (const env of [
      { ...ENV, GITHUB_DISPATCH_TOKEN: undefined },
      { ...ENV, GITHUB_REPO: undefined },
    ]) {
      expect(await dispatchRender(context(env), {})).toEqual({
        status: "retry_at",
        at: new Date("2026-10-04T13:00:00.000Z"),
        reason: "dispatch_not_configured",
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 422])(
    "refuses %i with NonRetryableError dispatch_<status>",
    async (status) => {
      fetchSpy.mockResolvedValue(new Response("{}", { status }));
      const outcome = dispatchRender(context(), {});
      await expect(outcome).rejects.toBeInstanceOf(NonRetryableError);
      await expect(outcome).rejects.toThrow(`dispatch_${String(status)}`);
    },
  );

  it("throws a retryable error on a 502", async () => {
    fetchSpy.mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const outcome = dispatchRender(context(), {});
    await expect(outcome).rejects.toThrow("dispatch_502");
    await expect(outcome).rejects.not.toBeInstanceOf(NonRetryableError);
  });

  it("classifies exactly 401, 403, 404 and 422 as refusals", () => {
    expect(Object.keys(dispatchRefusals)).toEqual(["401", "403", "404", "422"]);
  });
});

describe("dispatchHeavy", () => {
  it("sends claim, env and callback_url with the envelope and extra merged into data", async () => {
    const outcome = await dispatchHeavy(
      context(),
      { params: { size: "full" }, data: { property_id: "p1", spec_hash: "old" } },
      { spec_hash: "new", revision: 2 },
    );
    expect(outcome).toEqual({ status: "dispatched", result: { spec_hash: "new", revision: 2 } });
    expect(JSON.parse(sentBody().inputs.job)).toEqual({
      job_id: "3f2a9c1d-0000-4000-8000-000000000001",
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      type: "render_variants",
      payload: {
        params: { size: "full" },
        data: { property_id: "p1", spec_hash: "new", revision: 2 },
      },
      env: "preview",
      callback_url: CALLBACK,
    });
  });

  it("serialises the largest fixture payload (40 media rows) under 65,535 characters", async () => {
    await dispatchHeavy(
      context(),
      { params: {}, data: { property_id: "p1" } },
      { media: fortyMedia },
    );
    const job = sentBody().inputs.job;
    expect(job.length).toBeLessThan(65_535);
    expect(job).toContain(fortyMedia[39]?.staged_url ?? "missing");
  });

  it("refuses a client_payload over 65,535 characters with payload_too_large and no call", async () => {
    const outcome = dispatchHeavy(context(), { params: {}, data: { blob: "x".repeat(65_535) } });
    await expect(outcome).rejects.toBeInstanceOf(NonRetryableError);
    await expect(outcome).rejects.toThrow("payload_too_large");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
