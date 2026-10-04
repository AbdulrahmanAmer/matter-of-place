import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import {
  COLLECTORS,
  OPTIONAL,
  REQUIRED,
  SECRET_NAMES,
  runAll,
} from "../../../../workspace/audits/tools/run-all.mjs";

const NOW = new Date("2026-10-03T08:00:00Z");
const SIDECAR = "workspace/audits/data/2026-10-03.json";
const SCHEDULE = "https://matterofplace.com/api/admin/automation/schedule-settings/audit";
const RECORD_RUN = "https://matterofplace.com/api/admin/audit/record-run";
const KEY = "agent-key-for-test";

type Answer = Response | Error;

interface World {
  schedule?: Answer;
  recordRun?: Answer;
}

function setup(world: World = {}, env: Record<string, string | undefined> = {}) {
  const root = mkdtempSync(join(tmpdir(), "run-all-"));
  const requests: { url: string; method: string; authorization: string | null }[] = [];
  const lines: string[] = [];
  const answers: Record<string, Answer> = {
    [SCHEDULE]: world.schedule ?? Response.json({ enabled: true }),
    [RECORD_RUN]: world.recordRun ?? Response.json({ last_run_at: "2026-10-03T08:00:00Z" }),
  };
  const ctx = makeContext({
    env: { AUDIT_AGENT_KEY: KEY, SITE_URL: "https://matterofplace.com", ...env },
    siteUrl: "https://matterofplace.com",
    now: () => NOW,
    fetchImpl: (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const answer = answers[url];
      if (answer === undefined) return Promise.reject(new Error(`unexpected ${url}`));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone());
    },
  });
  const run = (argv: string[], extra: Partial<Parameters<typeof runAll>[0]> = {}) =>
    runAll({ argv, ctx, root, log: (line) => lines.push(line), collectors: [], ...extra });
  const sidecar = (): unknown => JSON.parse(readFileSync(join(root, SIDECAR), "utf8"));
  return { run, requests, lines, sidecar, written: () => existsSync(join(root, SIDECAR)) };
}

const collector = (name: string, vendor: boolean, outcome: "value" | "missing" | "throws") => {
  const calls: string[] = [];
  return {
    calls,
    entry: {
      name,
      keys: [name],
      vendor,
      collect: () => {
        calls.push(name);
        if (outcome === "throws") return Promise.reject(new Error("connection refused"));
        return Promise.resolve({
          [name]:
            outcome === "value" ? { value: { from: "collector" } } : { notMeasured: "no key" },
        });
      },
    },
  };
};

describe("the schedule switch", () => {
  it("prints skipped, disabled, writes no file, calls no record-run and exits 0", async () => {
    const world = setup({ schedule: Response.json({ enabled: false }) });
    expect(await world.run([])).toBe(0);
    expect(world.lines).toEqual(["skipped, disabled"]);
    expect(world.written()).toBe(false);
    expect(world.requests.map((request) => request.url)).toEqual([SCHEDULE]);
  });

  it("runs on with --manual against the same disabled row and records schedule: manual", async () => {
    const world = setup({ schedule: Response.json({ enabled: false }) });
    expect(await world.run(["--manual"])).toBe(0);
    expect(world.sidecar()).toMatchObject({ front: { schedule: "manual", date: "2026-10-03" } });
    expect(world.requests.map((request) => request.url)).toEqual([RECORD_RUN]);
  });

  it("reads the row with the agent key and records a scheduled run", async () => {
    const world = setup();
    await world.run([]);
    expect(world.requests).toEqual([
      { url: SCHEDULE, method: "GET", authorization: `Bearer ${KEY}` },
      { url: RECORD_RUN, method: "POST", authorization: `Bearer ${KEY}` },
    ]);
    expect(world.sidecar()).toMatchObject({
      front: { schedule: "scheduled" },
      record_run: { status: 200 },
      not_measured: {},
    });
  });

  it("goes on and records the schedule under not_measured when the read fails", async () => {
    const refused = setup({ schedule: new Response("no", { status: 401 }) });
    expect(await refused.run([])).toBe(0);
    expect(refused.sidecar()).toMatchObject({
      not_measured: { schedule: "schedule read HTTP 401" },
    });
    const down = setup({ schedule: new Error("offline") });
    await down.run([]);
    expect(down.sidecar()).toMatchObject({
      not_measured: { schedule: "schedule read request failed: offline" },
    });
  });
});

describe("failed sources", () => {
  it("records a collector that throws under not_measured and still writes the sidecar", async () => {
    const world = setup();
    const fine = collector("ours", false, "value");
    const broken = collector("psi", true, "throws");
    expect(await world.run([], { collectors: [broken.entry, fine.entry] })).toBe(0);
    expect(world.sidecar()).toMatchObject({
      ours: { from: "collector" },
      not_measured: { psi: "collector psi failed: connection refused" },
    });
  });

  it("records a 500 from record-run under not_measured and still writes the sidecar", async () => {
    const world = setup({ recordRun: new Response("boom", { status: 500 }) });
    expect(await world.run([])).toBe(0);
    expect(world.sidecar()).toMatchObject({ not_measured: { record_run: "HTTP 500" } });
    expect(world.requests.filter((request) => request.url === RECORD_RUN)).toHaveLength(1);
  });

  it("makes no record-run call under --collect-only", async () => {
    const world = setup();
    await world.run(["--collect-only"]);
    expect(world.requests.map((request) => request.url)).toEqual([SCHEDULE]);
    expect(world.written()).toBe(true);
  });
});

describe("--check-credentials", () => {
  const all = Object.fromEntries(REQUIRED.map((name) => [name, `value-of-${name}`]));

  it("prints ok or missing per name, never a value, and exits 1 when a required name is missing", async () => {
    const { AUDIT_AGENT_KEY: _gone, ...rest } = all;
    const world = setup({}, { ...rest, AUDIT_AGENT_KEY: undefined });
    expect(await world.run(["--check-credentials"])).toBe(1);
    expect(world.lines).toHaveLength(REQUIRED.length + OPTIONAL.length);
    expect(world.lines).toContain("AUDIT_AGENT_KEY: missing");
    expect(world.lines).toContain("PSI_API_KEY: ok");
    expect(world.lines.join("\n")).not.toContain("value-of-");
  });

  it("exits 0 when only SENTRY_AUTH_TOKEN is missing", async () => {
    const world = setup({}, { ...all, SENTRY_ORG: "mop", BING_WEBMASTER_API_KEY: "b" });
    expect(await world.run(["--check-credentials"])).toBe(0);
    expect(world.lines).toContain("SENTRY_AUTH_TOKEN: missing");
  });
});

describe("--from-data", () => {
  const recorded = readFileSync(
    new URL("../../../../workspace/audits/tools/fixtures/data-sidecar.json", import.meta.url),
    "utf8",
  );

  it("skips the vendor collectors, keeps their numbers, and still runs the rest", async () => {
    const world = setup();
    const vendor = collector("psi", true, "value");
    const ours = collector("ours", false, "value");
    const gitCalls: string[][] = [];
    const git = (args: string[]) => {
      gitCalls.push(args);
      return args[0] === "show" ? recorded : "";
    };
    expect(
      await world.run(["--from-data", "audit/2026-10-03-data"], {
        git,
        collectors: [vendor.entry, ours.entry],
      }),
    ).toBe(0);
    expect(gitCalls).toEqual([
      ["fetch", "origin", "audit/2026-10-03-data"],
      ["show", "origin/audit/2026-10-03-data:workspace/audits/data/2026-10-03.json"],
    ]);
    expect(vendor.calls).toEqual([]);
    expect(ours.calls).toEqual(["ours"]);
    expect(world.sidecar()).toMatchObject({
      psi: { strategy: "mobile", pages: [{ path: "/", score: 91 }] },
      ours: { from: "collector" },
    });
  });

  it("records from_data under not_measured and runs the vendor collectors when the branch is missing", async () => {
    const world = setup();
    const vendor = collector("psi", true, "value");
    const git = () => {
      throw new Error("couldn't find remote ref audit/none");
    };
    await world.run(["--from-data", "audit/none"], { git, collectors: [vendor.entry] });
    expect(vendor.calls).toEqual(["psi"]);
    expect(world.sidecar()).toMatchObject({
      not_measured: { from_data: "audit/none: couldn't find remote ref audit/none" },
    });
  });
});

describe("the lists the lint and the credential check read", () => {
  it("keep every collector key unique and the secret names out of the public ids", () => {
    const keys = COLLECTORS.flatMap((entry) => entry.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const publicId of [
      "SITE_URL",
      "CF_ACCOUNT_ID",
      "CF_ZONE_ID",
      "GA4_PROPERTY_ID",
      "SENTRY_ORG",
    ]) {
      expect(SECRET_NAMES).not.toContain(publicId);
    }
    expect(SECRET_NAMES).toContain("OPS_HEALTH_TOKEN");
  });
});
