import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as cloudflare from "../../../../workspace/audits/tools/collectors/cloudflare.mjs";
import * as github from "../../../../workspace/audits/tools/collectors/github.mjs";
import { agentTarget } from "../../../../workspace/audits/tools/collectors/ours.mjs";
import * as sentry from "../../../../workspace/audits/tools/collectors/sentry.mjs";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import * as kpis from "../../../../workspace/audits/tools/kpis.mjs";
import * as notfound from "../../../../workspace/audits/tools/notfound.mjs";
import { ourRows, vendorRows } from "../../../../workspace/audits/tools/usage.mjs";

// B14 step 4: the usage collectors, `notfound.mjs` and `kpis.mjs` against recorded answers (fixtures/*.json). No test
// reaches a network or a real `gh`: every outside call goes through a stub that records it.

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../../workspace/audits/tools/fixtures/${name}`, import.meta.url),
    "utf8",
  );

/** A recorded answer, parsed. */
const recordedJson = (name: string): unknown => JSON.parse(fixture(name));

interface Ran {
  command: string;
  args: string[];
}

function world(
  env: Record<string, string>,
  answer: (url: string) => Response,
  run: (command: string, args: string[]) => { status: number; stdout: string } = () => ({
    status: 1,
    stdout: "",
  }),
) {
  const requests: { url: string; body: string; authorization: string | null }[] = [];
  const ran: Ran[] = [];
  const ctx = makeContext({
    env,
    siteUrl: "http://127.0.0.1:8788",
    now: () => new Date("2026-10-10T16:00:00Z"),
    fetchImpl: (url, init) => {
      requests.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(answer(url));
    },
    run: (command, args) => {
      ran.push({ command, args });
      return run(command, args);
    },
  });
  return { ctx, requests, ran };
}

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

const rowOf = (rows: { line: string }[], line: string) => rows.find((row) => row.line === line);

/** The recorded runs as `gh api --jq '... | @json'` prints them, one JSON line per run. */
const ghLines = () =>
  z
    .object({ workflow_runs: z.array(z.record(z.unknown())) })
    .parse(JSON.parse(fixture("github-runs.json")))
    .workflow_runs.map(({ run_started_at, updated_at, status }) =>
      JSON.stringify({ run_started_at, updated_at, status }),
    )
    .join("\n");

describe("cloudflare.mjs", () => {
  it("uses CLOUDFLARE_ACCOUNT_ID when only that name is set and sums both Workers per window", async () => {
    const { ctx, requests } = world(
      { CF_ANALYTICS_TOKEN: "cf-test-token", CLOUDFLARE_ACCOUNT_ID: "acc-laptop" },
      () => json(fixture("cloudflare-invocations.json")),
    );
    expect(await cloudflare.collect(ctx)).toEqual([
      { line: "workers_requests_day", used: 620 },
      { line: "workers_requests_month", used: 620 },
    ]);
    const tags = requests.map(
      (request) =>
        z
          .object({ variables: z.object({ accountTag: z.string() }) })
          .parse(JSON.parse(request.body)).variables.accountTag,
    );
    expect(tags).toEqual(["acc-laptop", "acc-laptop", "acc-laptop", "acc-laptop"]);
  });

  it("makes no call without CF_ANALYTICS_TOKEN", async () => {
    const { ctx, requests } = world({ CLOUDFLARE_ACCOUNT_ID: "acc" }, () => json("{}"));
    expect(await cloudflare.collect(ctx)).toEqual([
      { line: "workers_requests_day", error: "not_measured: CF_ANALYTICS_TOKEN unset" },
      { line: "workers_requests_month", error: "not_measured: CF_ANALYTICS_TOKEN unset" },
    ]);
    expect(requests).toEqual([]);
  });
});

describe("github.mjs", () => {
  it("makes no call with GITHUB_ACTIONS unset and a gh that is not signed in", async () => {
    const { ctx, requests, ran } = world({}, () => json("{}"));
    expect(await github.collect(ctx)).toEqual([
      { line: "actions_minutes", error: "not_measured: no Actions token and no signed-in gh" },
    ]);
    expect(requests).toEqual([]);
    expect(ran).toEqual([{ command: "gh", args: ["auth", "status"] }]);
  });

  it("reads the recorded runs through a signed-in gh, path without a leading slash", async () => {
    const { ctx, ran } = world(
      {},
      () => json("{}"),
      (_command, args) =>
        args[0] === "auth" ? { status: 0, stdout: "" } : { status: 0, stdout: ghLines() },
    );
    expect(await github.collect(ctx)).toEqual([
      { line: "actions_minutes", used: 8, detail: { runs: 3 } },
    ]);
    const path = ran[1]?.args[1] ?? "";
    expect(path).toBe(
      "repos/AbdulrahmanAmer/matter-of-place/actions/runs?created=>=2026-10-01&per_page=100",
    );
  });

  it("sums the recorded runs to actions_minutes with GITHUB_ACTIONS=true and the workflow's token", async () => {
    const { ctx, requests, ran } = world(
      { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "gh-test-token" },
      () => json(fixture("github-runs.json")),
    );
    expect(await github.collect(ctx)).toEqual([
      { line: "actions_minutes", used: 8, detail: { runs: 3 } },
    ]);
    expect(requests.map((request) => request.authorization)).toEqual(["Bearer gh-test-token"]);
    expect(requests[0]?.url).toMatch(/^https:\/\/api\.github\.com\/repos\/AbdulrahmanAmer\//);
    expect(ran).toEqual([]);
  });

  it("rounds each completed run up to whole minutes and skips a run still going", () => {
    expect(
      github.minutesThisMonth([
        {
          run_started_at: "2026-10-10T10:00:00Z",
          updated_at: "2026-10-10T10:00:01Z",
          status: "completed",
        },
        {
          run_started_at: "2026-10-10T10:00:00Z",
          updated_at: "2026-10-10T10:02:00Z",
          status: "completed",
        },
        {
          run_started_at: "2026-10-10T10:00:00Z",
          updated_at: "2026-10-10T11:00:00Z",
          status: "in_progress",
        },
      ]),
    ).toBe(3);
  });
});

describe("sentry.mjs", () => {
  it("makes no call with SENTRY_AUTH_TOKEN unset", async () => {
    const { ctx, requests } = world({ SENTRY_ORG: "matter-of-place" }, () => json("{}"));
    expect(await sentry.collect(ctx)).toEqual([
      { line: "sentry_errors", error: "not_measured: SENTRY_AUTH_TOKEN unset" },
    ]);
    expect(requests).toEqual([]);
  });

  it("sums the recorded stats_v2 totals", async () => {
    const { ctx } = world({ SENTRY_AUTH_TOKEN: "s", SENTRY_ORG: "matter-of-place" }, () =>
      json(fixture("sentry-stats.json")),
    );
    expect(await sentry.collect(ctx)).toEqual([{ line: "sentry_errors", used: 565 }]);
  });
});

describe("ours.mjs through usage.mjs", () => {
  const recorded = () =>
    world({ AUDIT_AGENT_KEY_DEV: "mopk_dev_test" }, () => json(fixture("audit-usage.json")));

  it("writes caption_tokens as summed tokens per model with no price and status info", async () => {
    const { ctx, requests } = recorded();
    const caption = rowOf(await ourRows(ctx, agentTarget(ctx, "dev")), "caption_tokens");
    expect(caption).toEqual({
      line: "caption_tokens",
      limit: null,
      unit: "tokens a month",
      source: "ours.mjs",
      kind: "info",
      used: 10780,
      percent: null,
      status: "info",
      detail: [
        { model: "claude-sonnet", input_tokens: 9000, output_tokens: 1200, jobs: 3 },
        { model: "claude-haiku", input_tokens: 500, output_tokens: 80, jobs: 1 },
      ],
    });
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8788/api/admin/audit/usage",
        body: "",
        authorization: "Bearer mopk_dev_test",
      },
    ]);
  });

  it("gives storage_bytes of 800,000,000 the status DECISION, above 70 percent of 1 GB", async () => {
    const { ctx } = recorded();
    expect(rowOf(await ourRows(ctx, agentTarget(ctx, "dev")), "storage_bytes")).toMatchObject({
      used: 800_000_000,
      limit: 1_073_741_824,
      percent: 74.5,
      status: "DECISION",
    });
  });

  it("prints Not measured with the reason AUDIT_AGENT_KEY_DEV unset and makes no call", async () => {
    const { ctx, requests } = world({}, () => json("{}"));
    const rows = await ourRows(ctx, agentTarget(ctx, "dev"));
    expect(new Set(rows.map((row) => `${row.status}: ${row.reason ?? ""}`))).toEqual(
      new Set(["Not measured: AUDIT_AGENT_KEY_DEV unset"]),
    );
    expect(requests).toEqual([]);
  });
});

describe("usage.mjs vendor rows", () => {
  it("never calls a line without a source ok, and turns a collector that throws into Not measured", async () => {
    const { ctx } = world({}, () => json("{}"));
    const rows = await vendorRows(ctx, [
      {
        lines: ["sentry_errors"],
        collect: () => Promise.reject(new Error("socket hang up")),
      },
    ]);
    expect(rowOf(rows, "storage_egress")).toMatchObject({
      status: "Not measured",
      reason: "Supabase usage report needs the account token",
    });
    expect(rowOf(rows, "sentry_errors")).toMatchObject({
      status: "Not measured",
      reason: "collector failed: socket hang up",
    });
    expect(rows.filter((row) => row.used === null && row.status === "ok")).toEqual([]);
  });
});

describe("notfound.mjs and kpis.mjs", () => {
  it("store the recorded answers under not_found and kpis", async () => {
    const { ctx, requests } = world({ AUDIT_AGENT_KEY: "mopk_test" }, (url) =>
      json(fixture(url.includes("notfound") ? "audit-notfound.json" : "audit-kpis.json")),
    );
    expect(await notfound.collect(ctx)).toEqual({
      not_found: { value: recordedJson("audit-notfound.json") },
    });
    expect(await kpis.collect(ctx)).toEqual({
      kpis: { value: recordedJson("audit-kpis.json") },
    });
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8788/api/admin/audit/notfound?days=7",
      "http://127.0.0.1:8788/api/admin/audit/kpis",
    ]);
  });

  it("record a non-200 answer under not_measured, never as zeros", async () => {
    const { ctx } = world({ AUDIT_AGENT_KEY: "mopk_test" }, () => json("{}", 500));
    expect(await kpis.collect(ctx)).toEqual({ kpis: { notMeasured: "HTTP 500" } });
    expect(await notfound.collect(ctx)).toEqual({ not_found: { notMeasured: "HTTP 500" } });
  });
});
