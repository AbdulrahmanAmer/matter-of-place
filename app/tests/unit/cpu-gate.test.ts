import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryWorkersInvocations, runCpuGate } from "../../scripts/cpu-gate.mjs";

// T-11: the gate over recorded GraphQL answers, never a call to Cloudflare. The shape of the answer is the one the
// GraphQL Analytics API documents; its first live answer is UNPROVEN until `CF_ANALYTICS_TOKEN` exists.

const ENV = {
  CF_ANALYTICS_TOKEN: "token-for-the-test",
  CLOUDFLARE_ACCOUNT_ID: "account-for-the-test",
};
const LIMIT = z
  .object({ cpuMs: z.object({ p50: z.number() }) })
  .parse(JSON.parse(readFileSync(new URL("../../budget.json", import.meta.url), "utf8"))).cpuMs.p50;

const answer = (rows: unknown[]) => ({
  data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } },
  errors: null,
});
const quantiles = (p50Ms: number, p99Ms: number) => [
  { quantiles: { cpuTimeP50: p50Ms * 1000, cpuTimeP99: p99Ms * 1000 } },
];

function harness(rows: () => unknown[]) {
  const sent: { url: string; body: string }[] = [];
  const lines: string[] = [];
  let clock = Date.parse("2026-10-04T12:00:00Z");
  return {
    sent,
    lines,
    options: {
      env: ENV,
      limit: LIMIT,
      fetchFn: (url: string, init: RequestInit) => {
        sent.push({ url, body: typeof init.body === "string" ? init.body : "" });
        return Promise.resolve(Response.json(answer(rows())));
      },
      sleep: (ms: number) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      print: (line: string) => lines.push(line),
    },
  };
}

describe("runCpuGate", () => {
  it("exits 0 and prints the quantiles when P50 is under the budget", async () => {
    const run = harness(() => quantiles(LIMIT - 1, 90));
    expect(await runCpuGate("pr-1", run.options)).toBe(0);
    expect(run.lines).toEqual([`cpu p50 ${(LIMIT - 1).toFixed(1)} p99 90.0`]);
  });

  it("exits 1 when P50 is over the budget", async () => {
    const run = harness(() => quantiles(LIMIT + 1, 90));
    expect(await runCpuGate("pr-1", run.options)).toBe(1);
    expect(run.lines.join("\n")).toContain(`above the budget of ${String(LIMIT)} ms`);
  });

  it("waits for the data and reads it when it arrives", async () => {
    let asked = 0;
    const run = harness(() => {
      asked += 1;
      return asked < 3 ? [] : quantiles(LIMIT - 1, 90);
    });
    expect(await runCpuGate("pr-1", run.options)).toBe(0);
    expect(asked).toBe(3);
  });

  it("exits 1 when the answer stays empty for the whole poll window", async () => {
    const run = harness(() => []);
    expect(await runCpuGate("pr-1", run.options)).toBe(1);
    expect(run.sent.length).toBeGreaterThanOrEqual(9);
    expect(run.lines.join("\n")).toContain("no invocation of pr-1");
  });

  it("exits 2 naming the token when it is unset, and asks Cloudflare nothing", async () => {
    const run = harness(() => quantiles(1, 2));
    expect(
      await runCpuGate("pr-1", { ...run.options, env: { ...ENV, CF_ANALYTICS_TOKEN: "" } }),
    ).toBe(2);
    expect(run.lines).toEqual(["BLOCKED CF_ANALYTICS_TOKEN"]);
    expect(run.sent).toEqual([]);
  });
});

describe("queryWorkersInvocations", () => {
  const base = {
    accountId: "account-for-the-test",
    token: "token-for-the-test",
    scriptName: "pr-1",
    since: new Date("2026-10-04T11:45:00Z"),
    until: new Date("2026-10-04T12:00:00Z"),
  };

  it("sends one query naming workersInvocationsAdaptive and the fields it is given", async () => {
    const run = harness(() => []);
    await queryWorkersInvocations({
      ...base,
      fields: "sum { requests cpuTimeUs }",
      fetchFn: run.options.fetchFn,
    });
    expect(run.sent).toHaveLength(1);
    const body = z.object({ query: z.string() }).parse(JSON.parse(run.sent[0]?.body ?? "{}"));
    expect(body.query).toContain("workersInvocationsAdaptive");
    expect(body.query).toContain("sum { requests cpuTimeUs }");
    expect(body.query).not.toContain("cpuTimeP50");
  });

  it("throws the message of a GraphQL error", async () => {
    const failing = () =>
      Promise.resolve(Response.json({ data: null, errors: [{ message: "not authorized" }] }));
    await expect(queryWorkersInvocations({ ...base, fetchFn: failing })).rejects.toThrow(
      "not authorized",
    );
  });
});
