import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import {
  checkConfig,
  collect,
  loadExpected,
  monitorRows,
  parseUptime,
  redactUrl,
} from "../../../../workspace/audits/tools/uptime.mjs";

const TOKEN = "FIXTURE-OPS-TOKEN-0001";
const CLI = new URL("../../../../workspace/audits/tools/uptime.mjs", import.meta.url);

function recorded(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../../workspace/audits/tools/fixtures/uptime-ok.json", import.meta.url),
      "utf8",
    ),
  );
}

function context(env: Record<string, string | undefined>, answer: () => Response) {
  const requests: { url: string; body: string }[] = [];
  const ctx = makeContext({
    env,
    fetchImpl: (url, init) => {
      requests.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      return Promise.resolve(answer());
    },
  });
  return { ctx, requests };
}

const red = (rows: { status: string; check: string }[]) =>
  rows.filter((row) => row.status === "red").map((row) => row.check);

describe("parseUptime", () => {
  it("gives the three monitors with interval_s 300 and uptime_30d", () => {
    const monitors = parseUptime(recorded());
    expect(monitors.map((monitor) => [monitor.interval_s, monitor.uptime_30d])).toEqual([
      [300, 99.98],
      [300, 100],
      [300, 99.9],
    ]);
    expect(monitors.map((monitor) => monitor.url)).toEqual([
      "https://matterofplace.com/",
      "https://matterofplace.com/api/public/markets",
      "https://matterofplace.com/api/hooks/ops-health/<redacted>",
    ]);
  });

  it("redacts the segment after /ops-health/ only", () => {
    expect(redactUrl("https://x.test/api/hooks/ops-health/abc123?x=1")).toBe(
      "https://x.test/api/hooks/ops-health/<redacted>?x=1",
    );
  });
});

describe("monitorRows against monitoring/uptime.json", () => {
  const expected = loadExpected();

  it("expects three monitors and finds them all in the recorded answer", () => {
    expect(expected.map((monitor) => monitor.name)).toEqual([
      "Home",
      "Public markets",
      "Ops health",
    ]);
    expect(monitorRows(parseUptime(recorded()), expected).map((row) => row.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("gives a red row for a paused monitor", () => {
    const monitors = parseUptime(recorded()).map((monitor, index) =>
      index === 0 ? { ...monitor, status: 0 } : monitor,
    );
    const rows = monitorRows(monitors, expected);
    expect(red(rows)).toEqual(["Home"]);
  });

  it("gives a red row for a 600 second interval", () => {
    const monitors = parseUptime(recorded()).map((monitor) => ({ ...monitor, interval_s: 600 }));
    expect(red(monitorRows(monitors, expected))).toEqual(["Home", "Public markets", "Ops health"]);
  });

  it("gives a red row for a missing /api/public/markets monitor", () => {
    const monitors = parseUptime(recorded()).filter(
      (monitor) => !monitor.url.endsWith("/api/public/markets"),
    );
    expect(red(monitorRows(monitors, expected))).toEqual(["Public markets"]);
  });

  it("gives a red row for a missing or non-keyword ops-health monitor", () => {
    const monitors = parseUptime(recorded());
    const missing = monitors.filter((monitor) => !monitor.url.includes("/ops-health/"));
    const plain = monitors.map((monitor) =>
      monitor.url.includes("/ops-health/") ? { ...monitor, type: 1, keyword_value: null } : monitor,
    );
    expect(red(monitorRows(missing, expected))).toEqual(["Ops health"]);
    expect(red(monitorRows(plain, expected))).toEqual(["Ops health"]);
  });
});

describe("uptime collect", () => {
  it("writes the ops-health URL redacted and its token nowhere in the result", async () => {
    const { ctx, requests } = context({ UPTIME_API_KEY: "uptime-key-for-test" }, () =>
      Response.json(recorded()),
    );
    const collected = await collect(ctx);
    expect(JSON.stringify(collected)).toContain("/api/hooks/ops-health/<redacted>");
    expect(JSON.stringify(collected)).not.toContain(TOKEN);
    expect(requests[0]?.url).toBe("https://api.uptimerobot.com/v2/getMonitors");
    expect(requests[0]?.body).toBe(
      "api_key=uptime-key-for-test&format=json&custom_uptime_ratios=30",
    );
  });

  it("records uptime under not_measured for a stat fail answer", async () => {
    const { ctx } = context({ UPTIME_API_KEY: "uptime-key-for-test" }, () =>
      Response.json({ stat: "fail", error: { type: "invalid_parameter" } }),
    );
    expect(await collect(ctx)).toEqual({
      uptime: { notMeasured: "uptime monitor answered stat fail" },
    });
  });

  it("makes no request and records not_measured while UPTIME_API_KEY is unset", async () => {
    const { ctx, requests } = context({}, () => Response.json(recorded()));
    expect(await collect(ctx)).toEqual({ uptime: { notMeasured: "UPTIME_API_KEY unset" } });
    expect(requests).toEqual([]);
  });
});

describe("uptime --check-config", () => {
  const env = { UPTIME_API_KEY: "uptime-key-for-test" };

  it("exits 0 with three ok rows for the recorded answer", async () => {
    const { ctx } = context(env, () => Response.json(recorded()));
    const { code, lines } = await checkConfig(ctx);
    expect(code).toBe(0);
    expect(lines.map((line) => line.split("  ")[0])).toEqual(["ok", "ok", "ok"]);
  });

  it("exits 1 and names the monitor when one is paused in the vendor UI", async () => {
    const paused = JSON.stringify(recorded()).replace('"status":2', '"status":0');
    const { ctx } = context(env, () => new Response(paused));
    const { code, lines } = await checkConfig(ctx);
    expect(code).toBe(1);
    expect(lines[0]).toBe("red  Home  monitor is paused");
  });

  it("exits 1 on the command line while the key is unset, with the flag accepted", () => {
    const run = spawnSync("node", [fileURLToPath(CLI), "--check-config"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(run.stdout).toBe("Not measured: uptime (UPTIME_API_KEY unset)\n");
    expect(run.status).toBe(1);
  });
});
